// Módulo Empresas do painel: provisionamento de tenants, PBX e faixas de ramal.
// Substitui os scripts de seed. Permissões (src/rbac.ts):
//   provision_company — SUPER_ADMIN (all) e PARTNER_ADMIN (partner)
//   manage_pbx        — só SUPER_ADMIN
// Segredos (chave do Linkus SDK, token do Helena) entram cifrados e nunca voltam
// nas respostas: a API só informa se estão configurados.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from './db.js';
import { encryptSecret } from './crypto.js';
import { requireAuth, type PanelToken } from './auth.js';
import { permissionScope } from './rbac.js';
import { checkPbx } from './yeastar.js';
import { checkHelenaToken } from './helena-admin.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT = /^\d{2,6}$/;

const bad = (reply: FastifyReply, msg: string) => reply.code(400).send({ error: msg });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function audit(companyId: string | null, actor: string, action: string, payload: object): Promise<void> {
  await prisma.auditLog.create({ data: { companyId, actor, action, payload } });
}

/** Empresas que o chamador pode ver/alterar (null = todas). */
function companyFilter(user: PanelToken): { partnerId?: string } | null | false {
  const scope = permissionScope(user.role, 'provision_company');
  if (scope === 'all') return null;
  if (scope === 'partner' && user.partnerId) return { partnerId: user.partnerId };
  return false;
}

async function loadCompanyInScope(user: PanelToken, id: string) {
  const f = companyFilter(user);
  if (f === false) return null;
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) return null;
  if (f && c.partnerId !== f.partnerId) return null;
  return c;
}

/** PBXs que o chamador pode atribuir: SUPER = todos; PARTNER = os já usados pelas empresas do parceiro. */
async function allowedPbxIds(user: PanelToken): Promise<string[] | null> {
  const f = companyFilter(user);
  if (f === null) return null;
  if (f === false) return [];
  const rows = await prisma.company.findMany({ where: { partnerId: f.partnerId }, select: { pbxId: true } });
  return [...new Set(rows.map((r) => r.pbxId))];
}

function parseRange(from: unknown, to: unknown): { fromExt: string; toExt: string } | string {
  const a = str(from), b = str(to);
  if (!EXT.test(a) || !EXT.test(b)) return 'ramais da faixa devem ter de 2 a 6 dígitos';
  if (a.length !== b.length) return 'início e fim da faixa precisam ter o mesmo número de dígitos';
  if (a > b) return 'o início da faixa precisa ser menor ou igual ao fim';
  return { fromExt: a, toExt: b };
}

/** Outra empresa do mesmo PBX já usa parte da faixa? Devolve o nome dela. */
async function overlapsOtherCompany(pbxId: string, companyId: string, r: { fromExt: string; toExt: string }): Promise<string | null> {
  const others = await prisma.extensionRange.findMany({
    where: { company: { pbxId }, NOT: { companyId } },
    include: { company: { select: { name: true } } },
  });
  const hit = others.find((o) => o.fromExt.length === r.fromExt.length && !(r.toExt < o.fromExt || r.fromExt > o.toExt));
  return hit ? hit.company.name : null;
}

function normalizeBaseUrl(v: unknown): string | null {
  const s = str(v).replace(/\/+$/, '');
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

/** Valida e cifra Client ID/Secret da OpenAPI (Integrations > API). null = não informado. */
async function apiCreds(baseUrl: string, b: Record<string, unknown>): Promise<{ clientIdEnc: string; clientSecretEnc: string } | null | string> {
  const id = str(b.apiClientId), secret = str(b.apiClientSecret);
  if (!id && !secret) return null;
  if (!id || !secret) return 'informe Client ID e Client Secret da API juntos';
  if (!(await checkPbx({ baseUrl, accessId: id, accessKey: secret }))) {
    return 'não consegui autenticar na API do PBX com esse Client ID/Secret (confira Integrations > API, acesso remoto pela FQDN e restrição de IP)';
  }
  return { clientIdEnc: encryptSecret(id), clientSecretEnc: encryptSecret(secret) };
}

export async function registerCompanyRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- PBX (só SUPER_ADMIN) ----------------
  app.get('/v1/panel/pbx', { preHandler: requireAuth('provision_company') }, async (req) => {
    const user = req.user as PanelToken;
    const ids = await allowedPbxIds(user);
    const list = await prisma.pbx.findMany({
      where: ids ? { id: { in: ids } } : undefined,
      orderBy: { name: 'asc' },
      include: { _count: { select: { companies: true } } },
    });
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      sdkAccessId: user.role === 'SUPER_ADMIN' ? p.sdkAccessId : undefined,
      companies: p._count.companies,
      // OpenAPI (CDR/gravações): só informa se está configurada, nunca devolve as chaves
      apiConfigured: Boolean(p.clientIdEnc && p.clientSecretEnc),
      cdrSyncedAt: p.cdrSyncedAt,
      cdrSyncError: user.role === 'SUPER_ADMIN' ? p.cdrSyncError : undefined,
    }));
  });

  app.post('/v1/panel/pbx', { preHandler: requireAuth('manage_pbx') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = str(b.name), accessId = str(b.sdkAccessId), accessKey = str(b.sdkAccessKey);
    const baseUrl = normalizeBaseUrl(b.baseUrl);
    if (!name) return bad(reply, 'informe o nome do PBX');
    if (!baseUrl) return bad(reply, 'URL do PBX inválida (use https://endereco:porta)');
    if (!accessId || !accessKey) return bad(reply, 'informe AccessID e AccessKey do Linkus SDK');
    if (!(await checkPbx({ baseUrl, accessId, accessKey }))) {
      return bad(reply, 'não consegui autenticar no PBX com essas credenciais (confira URL, AccessID/AccessKey, Linkus SDK ativo e IP Restriction)');
    }
    const api = await apiCreds(baseUrl, b);
    if (typeof api === 'string') return bad(reply, api);
    const pbx = await prisma.pbx.create({
      data: { name, baseUrl, sdkAccessId: accessId, sdkAccessKeyEnc: encryptSecret(accessKey), ...(api ?? {}) },
    });
    await audit(null, user.userId, 'pbx_create', { pbxId: pbx.id, name, baseUrl, api: Boolean(api) });
    return { ok: true, id: pbx.id };
  });

  app.patch('/v1/panel/pbx/:id', { preHandler: requireAuth('manage_pbx') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const id = String((req.params as any).id);
    const cur = await prisma.pbx.findUnique({ where: { id } });
    if (!cur) return reply.code(404).send({ error: 'PBX não encontrado' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, string | null> = {};
    if (b.name !== undefined) { if (!str(b.name)) return bad(reply, 'nome vazio'); data.name = str(b.name); }
    if (b.baseUrl !== undefined) { const u = normalizeBaseUrl(b.baseUrl); if (!u) return bad(reply, 'URL do PBX inválida'); data.baseUrl = u; }
    if (b.sdkAccessId !== undefined) { if (!str(b.sdkAccessId)) return bad(reply, 'AccessID vazio'); data.sdkAccessId = str(b.sdkAccessId); }
    const newKey = str(b.sdkAccessKey);
    const credsChanged = data.baseUrl || data.sdkAccessId || newKey;
    if (credsChanged) {
      if (!newKey) return bad(reply, 'para alterar URL ou AccessID, informe também o AccessKey');
      const ok = await checkPbx({ baseUrl: data.baseUrl ?? cur.baseUrl, accessId: data.sdkAccessId ?? cur.sdkAccessId, accessKey: newKey });
      if (!ok) return bad(reply, 'não consegui autenticar no PBX com essas credenciais');
      data.sdkAccessKeyEnc = encryptSecret(newKey);
    }
    const api = await apiCreds(data.baseUrl ?? cur.baseUrl, b);
    if (typeof api === 'string') return bad(reply, api);
    if (api) Object.assign(data, api, { cdrSyncError: null });
    await prisma.pbx.update({ where: { id }, data });
    await audit(null, user.userId, 'pbx_update', {
      pbxId: id, fields: Object.keys(data).filter((k) => !k.endsWith('Enc') && k !== 'cdrSyncError'),
      keyChanged: Boolean(newKey), apiChanged: Boolean(api),
    });
    return { ok: true };
  });

  // ---------------- Empresas ----------------
  app.get('/v1/panel/companies', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const f = companyFilter(user);
    if (f === false) return reply.code(403).send({ error: 'fora do seu escopo' });
    const list = await prisma.company.findMany({
      where: f ?? undefined,
      orderBy: { name: 'asc' },
      include: { pbx: { select: { id: true, name: true } }, ranges: true, _count: { select: { links: true } } },
    });
    return list.map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active,
      partnerId: c.partnerId,
      pbx: c.pbx,
      ranges: c.ranges.map((r) => ({ id: r.id, from: r.fromExt, to: r.toExt })),
      linkedUsers: c._count.links,
      helenaTokenSet: Boolean(c.helenaApiTokenEnc),
      createdAt: c.createdAt,
    }));
  });

  app.post('/v1/panel/companies', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const f = companyFilter(user);
    if (f === false) return reply.code(403).send({ error: 'fora do seu escopo' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = str(b.id).toLowerCase(), name = str(b.name), pbxId = str(b.pbxId);
    if (!UUID.test(id)) return bad(reply, 'ID da empresa inválido (é o UUID da conta no Comunic Chat)');
    if (!name) return bad(reply, 'informe o nome da empresa');
    if (await prisma.company.findUnique({ where: { id } })) return reply.code(409).send({ error: 'empresa já cadastrada' });

    const allowed = await allowedPbxIds(user);
    if (!pbxId || (allowed && !allowed.includes(pbxId))) return bad(reply, 'escolha um PBX válido');
    if (!(await prisma.pbx.findUnique({ where: { id: pbxId } }))) return bad(reply, 'PBX não encontrado');

    // PARTNER_ADMIN só cria empresas do próprio parceiro.
    const partnerId = f ? f.partnerId! : (str(b.partnerId) || null);
    if (partnerId && !UUID.test(partnerId)) return bad(reply, 'ID do parceiro inválido');

    const range = b.rangeFrom || b.rangeTo ? parseRange(b.rangeFrom, b.rangeTo) : null;
    if (typeof range === 'string') return bad(reply, range);
    if (range) {
      const other = await overlapsOtherCompany(pbxId, id, range);
      if (other) return bad(reply, `a faixa se sobrepõe à de "${other}" neste PBX`);
    }

    const token = str(b.helenaToken);
    if (token && !(await checkHelenaToken(token))) return bad(reply, 'o token do Helena não funcionou (confira se é o token permanente da empresa)');

    await prisma.company.create({
      data: {
        id, name, pbxId, partnerId,
        active: b.active === undefined ? true : Boolean(b.active),
        helenaApiTokenEnc: token ? encryptSecret(token) : null,
        ranges: range ? { create: [range] } : undefined,
      },
    });
    await audit(id, user.userId, 'company_create', { name, pbxId, partnerId, range, helenaToken: Boolean(token) });
    return { ok: true, id };
  });

  app.patch('/v1/panel/companies/:id', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const c = await loadCompanyInScope(user, String((req.params as any).id));
    if (!c) return reply.code(404).send({ error: 'empresa não encontrada' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const data: { name?: string; active?: boolean; pbxId?: string } = {};
    if (b.name !== undefined) { if (!str(b.name)) return bad(reply, 'nome vazio'); data.name = str(b.name); }
    if (b.active !== undefined) {
      data.active = Boolean(b.active);
      if (!data.active && c.id === user.companyId) return bad(reply, 'você não pode desativar a sua própria empresa');
    }
    if (b.pbxId !== undefined && str(b.pbxId) !== c.pbxId) {
      const pbxId = str(b.pbxId);
      const allowed = await allowedPbxIds(user);
      if (allowed && !allowed.includes(pbxId)) return bad(reply, 'escolha um PBX válido');
      if (!(await prisma.pbx.findUnique({ where: { id: pbxId } }))) return bad(reply, 'PBX não encontrado');
      for (const r of await prisma.extensionRange.findMany({ where: { companyId: c.id } })) {
        const other = await overlapsOtherCompany(pbxId, c.id, r);
        if (other) return bad(reply, `no novo PBX, a faixa ${r.fromExt}–${r.toExt} se sobrepõe à de "${other}"`);
      }
      data.pbxId = pbxId;
    }
    await prisma.company.update({ where: { id: c.id }, data });
    await audit(c.id, user.userId, 'company_update', data);
    return { ok: true };
  });

  // Token permanente do Helena (pn_...). Nunca é devolvido.
  app.put('/v1/panel/companies/:id/helena-token', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const c = await loadCompanyInScope(user, String((req.params as any).id));
    if (!c) return reply.code(404).send({ error: 'empresa não encontrada' });
    const token = str((req.body as any)?.token);
    if (!token) return bad(reply, 'informe o token');
    if (!(await checkHelenaToken(token))) return bad(reply, 'o token do Helena não funcionou (confira se é o token permanente da empresa)');
    await prisma.company.update({ where: { id: c.id }, data: { helenaApiTokenEnc: encryptSecret(token) } });
    await audit(c.id, user.userId, 'company_helena_token', { set: true });
    return { ok: true };
  });

  // ---------------- Faixas de ramal ----------------
  app.post('/v1/panel/companies/:id/ranges', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const c = await loadCompanyInScope(user, String((req.params as any).id));
    if (!c) return reply.code(404).send({ error: 'empresa não encontrada' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const range = parseRange(b.from, b.to);
    if (typeof range === 'string') return bad(reply, range);
    const own = await prisma.extensionRange.findMany({ where: { companyId: c.id } });
    if (own.some((o) => o.fromExt.length === range.fromExt.length && !(range.toExt < o.fromExt || range.fromExt > o.toExt))) {
      return bad(reply, 'a faixa se sobrepõe a outra faixa desta empresa');
    }
    const other = await overlapsOtherCompany(c.pbxId, c.id, range);
    if (other) return bad(reply, `a faixa se sobrepõe à de "${other}" neste PBX`);
    const r = await prisma.extensionRange.create({ data: { companyId: c.id, ...range } });
    await audit(c.id, user.userId, 'range_create', range);
    return { ok: true, id: r.id };
  });

  app.delete('/v1/panel/companies/:id/ranges/:rangeId', { preHandler: requireAuth('provision_company') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const params = req.params as { id: string; rangeId: string };
    const c = await loadCompanyInScope(user, params.id);
    if (!c) return reply.code(404).send({ error: 'empresa não encontrada' });
    const ranges = await prisma.extensionRange.findMany({ where: { companyId: c.id } });
    const target = ranges.find((r) => r.id === params.rangeId);
    if (!target) return reply.code(404).send({ error: 'faixa não encontrada' });
    // Não deixa órfão um ramal já vinculado.
    const rest = ranges.filter((r) => r.id !== target.id);
    const inUse = (await prisma.extensionLink.findMany({ where: { companyId: c.id } })).filter(
      (l) =>
        l.extensionNumber.length === target.fromExt.length &&
        l.extensionNumber >= target.fromExt && l.extensionNumber <= target.toExt &&
        !rest.some((r) => l.extensionNumber.length === r.fromExt.length && l.extensionNumber >= r.fromExt && l.extensionNumber <= r.toExt),
    );
    if (inUse.length) {
      return bad(reply, `há ${inUse.length} ramal(is) vinculado(s) nesta faixa (ex.: ${inUse[0].extensionNumber}); desvincule antes de remover`);
    }
    await prisma.extensionRange.delete({ where: { id: target.id } });
    await audit(c.id, user.userId, 'range_delete', { from: target.fromExt, to: target.toExt });
    return { ok: true };
  });
}
