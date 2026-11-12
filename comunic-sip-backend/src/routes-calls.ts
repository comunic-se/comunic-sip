// Chamadas (CDR) e Dashboard do painel. Tudo filtrado pelo escopo do usuário:
//   all      -> todas (inclusive chamadas sem empresa identificada)
//   partner  -> empresas do parceiro
//   company  -> a própria empresa
//   department -> chamadas dos atendentes dos meus setores
//   self     -> só as minhas (dono ou outra ponta de chamada interna)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { requireAuth, type PanelToken } from './auth.js';
import { effectiveScope, type Permission } from './rbac.js';
import { listAgentsCached } from './helena-admin.js';
import { syncPbx } from './cdr-sync.js';
import { decryptSecret } from './crypto.js';
import { getToken, openapiGet, type PbxCreds } from './yeastar.js';
import { Readable } from 'node:stream';

const TZ = process.env.PBX_TIMEZONE_OFFSET ?? '-03:00';
const TZ_MIN = (() => { const m = TZ.match(/^([+-])(\d{2}):(\d{2})$/); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -180; })();
const MAX_ROWS = 50_000;

type Q = { from?: string; to?: string; type?: string; status?: string; q?: string; userId?: string; companyId?: string; page?: string; pageSize?: string };

/** Data local (YYYY-MM-DD) no fuso do PBX -> instante. */
function day(d: string | undefined, end: boolean): Date | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return new Date(`${d}T${end ? '23:59:59.999' : '00:00:00.000'}${TZ}`);
}
/** Instante -> data/hora local do PBX. */
function local(dt: Date): { day: string; hour: number } {
  const t = new Date(+dt + TZ_MIN * 60_000);
  return { day: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

/** Monta o filtro do Prisma conforme o escopo + filtros da tela. null = sem acesso. */
async function scopedWhere(user: PanelToken, perm: Permission, q: Q): Promise<{ where: any; companyId: string | null } | null> {
  const scope = await effectiveScope(user, perm);
  if (!scope) return null;
  const and: any[] = [];
  let companyId: string | null = user.companyId;

  if (scope === 'all') {
    companyId = q.companyId || user.companyId;
    if (q.companyId !== '*') and.push({ companyId });
    else companyId = null; // master pode pedir tudo (inclusive sem empresa)
  } else if (scope === 'partner') {
    const target = q.companyId || user.companyId;
    const c = await prisma.company.findUnique({ where: { id: target } });
    if (!c || c.partnerId !== user.partnerId) return null;
    companyId = target;
    and.push({ companyId });
  } else {
    if (q.companyId && q.companyId !== user.companyId) return null;
    and.push({ companyId: user.companyId });
    if (scope === 'self') {
      and.push({ OR: [{ helenaUserId: user.userId }, { otherUserId: user.userId }] });
    } else if (scope === 'department') {
      const company = await prisma.company.findUnique({ where: { id: user.companyId } });
      const agents = company?.helenaApiTokenEnc ? await listAgentsCached(company.id, company.helenaApiTokenEnc).catch(() => []) : [];
      const ids = agents.filter((a) => a.departments.some((d) => user.deptIds.includes(d.departmentId))).map((a) => a.userId);
      ids.push(user.userId);
      and.push({ OR: [{ helenaUserId: { in: ids } }, { otherUserId: { in: ids } }] });
    }
  }

  const from = day(q.from, false), to = day(q.to, true);
  if (from || to) and.push({ startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
  if (q.type && ['Inbound', 'Outbound', 'Internal'].includes(q.type)) and.push({ direction: q.type });
  if (q.status === 'answered') and.push({ status: 'ANSWERED' });
  if (q.status === 'missed') and.push({ status: { not: 'ANSWERED' } });
  if (q.userId) and.push({ OR: [{ helenaUserId: q.userId }, { otherUserId: q.userId }] });
  const text = (q.q ?? '').trim();
  if (text) {
    const like = { contains: text, mode: 'insensitive' as const };
    and.push({ OR: [{ fromNumber: like }, { toNumber: like }, { fromName: like }, { toName: like }] });
  }
  return { where: { AND: and }, companyId };
}

async function nameMap(companyId: string | null): Promise<Map<string, string>> {
  if (!companyId) return new Map();
  const c = await prisma.company.findUnique({ where: { id: companyId } });
  if (!c?.helenaApiTokenEnc) return new Map();
  const agents = await listAgentsCached(c.id, c.helenaApiTokenEnc).catch(() => []);
  return new Map(agents.map((a) => [a.userId, a.name ?? '']));
}

const DIR_PT: Record<string, string> = { Inbound: 'Recebida', Outbound: 'Efetuada', Internal: 'Interna' };
const STATUS_PT: Record<string, string> = { ANSWERED: 'Atendida', 'NO ANSWER': 'Não atendida', BUSY: 'Ocupado', FAILED: 'Falhou', VOICEMAIL: 'Correio de voz' };

export async function registerCallRoutes(app: FastifyInstance): Promise<void> {
  // ---- Lista de chamadas ----
  app.get('/v1/panel/calls', { preHandler: requireAuth('view_cdr') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as Q;
    const sw = await scopedWhere(user, 'view_cdr', q);
    if (!sw) return reply.code(403).send({ error: 'fora do seu escopo' });
    const pageSize = Math.min(100, Math.max(10, Number(q.pageSize) || 50));
    const page = Math.max(1, Number(q.page) || 1);
    const [total, rows, names] = await Promise.all([
      prisma.call.count({ where: sw.where }),
      prisma.call.findMany({ where: sw.where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      nameMap(sw.companyId),
    ]);
    return {
      total, page, pageSize,
      items: rows.map((c) => ({
        id: c.id, startedAt: c.startedAt, direction: c.direction, status: c.status,
        fromNumber: c.fromNumber, fromName: c.fromName, toNumber: c.toNumber, toName: c.toName,
        extension: c.extensionNumber, agent: c.helenaUserId ? names.get(c.helenaUserId) ?? null : null,
        talk: c.talkDuration, ring: c.ringDuration, did: c.did, trunk: c.trunk,
        hasRecording: c.recordingId != null,
      })),
    };
  });

  // ---- Gravações: lista (só chamadas com gravação, no escopo de play_recording) ----
  app.get('/v1/panel/recordings', { preHandler: requireAuth('play_recording') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as Q;
    const sw = await scopedWhere(user, 'play_recording', q);
    if (!sw) return reply.code(403).send({ error: 'fora do seu escopo' });
    const where = { AND: [sw.where, { recordingId: { not: null } }] };
    const pageSize = Math.min(100, Math.max(10, Number(q.pageSize) || 50));
    const page = Math.max(1, Number(q.page) || 1);
    const [total, rows, names] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      nameMap(sw.companyId),
    ]);
    return {
      total, page, pageSize,
      canDownload: Boolean(await effectiveScope(user, 'download_recording')),
      items: rows.map((c) => ({
        id: c.id, startedAt: c.startedAt, direction: c.direction, status: c.status,
        fromNumber: c.fromNumber, fromName: c.fromName, toNumber: c.toNumber, toName: c.toName,
        agent: c.helenaUserId ? names.get(c.helenaUserId) ?? null : null, talk: c.talkDuration, size: c.recordingSize,
      })),
    };
  });

  // ---- Gravações: áudio (proxy autenticado; ?download=1 baixa) ----
  // O endereço do PBX e o token nunca chegam ao navegador. Nada é guardado em disco.
  app.get('/v1/panel/calls/:id/recording', { preHandler: requireAuth('play_recording') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const id = String((req.params as any).id);
    const download = String((req.query as any).download ?? '') === '1';
    if (download && !(await effectiveScope(user, 'download_recording'))) {
      return reply.code(403).send({ error: 'você não tem permissão para baixar gravações' });
    }
    const call = await prisma.call.findUnique({ where: { id } });
    if (!call || call.recordingId == null || !call.pbxId) return reply.code(404).send({ error: 'gravação não encontrada' });

    // A pessoa precisa enxergar esta chamada no escopo de play_recording.
    const sw = await scopedWhere(user, 'play_recording', { companyId: call.companyId ?? '*' });
    if (!sw || !(await prisma.call.count({ where: { AND: [sw.where, { id }] } }))) {
      return reply.code(403).send({ error: 'fora do seu escopo' });
    }
    const pbx = await prisma.pbx.findUnique({ where: { id: call.pbxId } });
    if (!pbx?.clientIdEnc || !pbx.clientSecretEnc) return reply.code(400).send({ error: 'API do PBX não configurada' });
    const creds: PbxCreds = { baseUrl: pbx.baseUrl, accessId: decryptSecret(pbx.clientIdEnc), accessKey: decryptSecret(pbx.clientSecretEnc) };

    let upstream: Response;
    try {
      const url = await downloadUrl(creds, call.recordingId);
      upstream = await fetch(`${pbx.baseUrl}${url}?access_token=${encodeURIComponent(await getToken(creds))}`, { headers: { 'User-Agent': 'Comunic.SIP-backend/0.1' } });
      if (!upstream.ok || !upstream.body) { dlCache.delete(call.recordingId); throw new Error(`HTTP ${upstream.status}`); }
    } catch (e: any) {
      req.log.warn({ err: String(e?.message ?? e), callId: id }, 'falha ao buscar gravação no PBX');
      return reply.code(502).send({ error: 'não consegui obter a gravação no PBX' });
    }

    await auditRecording(user, call.companyId, id, download);
    const ext = (call.recordingFile?.match(/\.(wav|mp3)$/i)?.[1] ?? 'wav').toLowerCase();
    const when = call.startedAt ? new Date(+call.startedAt + TZ_MIN * 60_000).toISOString().slice(0, 16).replace(/[-:T]/g, '') : 'sem-data';
    const name = `gravacao-${when}-${(call.fromNumber ?? '').replace(/\D/g, '')}-${(call.toNumber ?? '').replace(/\D/g, '')}.${ext}`;
    reply.header('Content-Type', upstream.headers.get('content-type') ?? (ext === 'mp3' ? 'audio/mpeg' : 'audio/wav'));
    const len = upstream.headers.get('content-length');
    if (len) reply.header('Content-Length', len);
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);
    return reply.send(Readable.fromWeb(upstream.body as any));
  });

  // ---- Exportar (CSV) ----
  app.get('/v1/panel/calls/export', { preHandler: requireAuth('export_cdr') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as Q;
    // Exportar exige também enxergar as chamadas no mesmo escopo.
    const sw = await scopedWhere(user, 'view_cdr', q);
    if (!sw) return reply.code(403).send({ error: 'fora do seu escopo' });
    const rows = await prisma.call.findMany({ where: sw.where, orderBy: { startedAt: 'desc' }, take: MAX_ROWS });
    const names = await nameMap(sw.companyId);
    const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Data/hora', 'Tipo', 'Status', 'De', 'Nome de', 'Para', 'Nome para', 'Ramal', 'Atendente', 'Conversa (s)', 'Espera (s)', 'DID', 'Tronco'];
    const lines = rows.map((c) => [
      c.startedAt ? new Date(+c.startedAt + TZ_MIN * 60_000).toISOString().replace('T', ' ').slice(0, 19) : '',
      DIR_PT[c.direction ?? ''] ?? c.direction, STATUS_PT[c.status ?? ''] ?? c.status,
      c.fromNumber, c.fromName, c.toNumber, c.toName, c.extensionNumber,
      c.helenaUserId ? names.get(c.helenaUserId) ?? '' : '', c.talkDuration, c.ringDuration, c.did, c.trunk,
    ].map(cell).join(';'));
    await prisma.auditLog.create({
      data: { companyId: sw.companyId, actor: user.userId, action: 'cdr_export', payload: { filters: q as any, rows: rows.length } },
    });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="chamadas-${new Date().toISOString().slice(0, 10)}.csv"`);
    return '﻿' + [head.join(';'), ...lines].join('\r\n'); // BOM: Excel abre acentos certo
  });

  // ---- Dashboard ----
  app.get('/v1/panel/dashboard', { preHandler: requireAuth('view_dashboard') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as Q;
    const sw = await scopedWhere(user, 'view_dashboard', { ...q, type: undefined, status: undefined, q: undefined });
    if (!sw) return reply.code(403).send({ error: 'fora do seu escopo' });
    const rows = await prisma.call.findMany({
      where: sw.where, take: MAX_ROWS,
      select: { startedAt: true, direction: true, status: true, talkDuration: true, ringDuration: true, helenaUserId: true },
    });
    const names = await nameMap(sw.companyId);

    const inbound = rows.filter((r) => r.direction === 'Inbound');
    const answeredIn = inbound.filter((r) => r.status === 'ANSWERED');
    const answeredAll = rows.filter((r) => r.status === 'ANSWERED');
    const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);
    const avg = (a: (number | null)[]) => (a.length ? Math.round(sum(a) / a.length) : 0);

    const byDay = new Map<string, { day: string; inbound: number; outbound: number; internal: number; missed: number }>();
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, missed: 0 }));
    const byUser = new Map<string, { userId: string; name: string; total: number; answered: number; missed: number; talk: number }>();
    for (const r of rows) {
      if (!r.startedAt) continue;
      const { day: d, hour } = local(r.startedAt);
      const missed = r.direction === 'Inbound' && r.status !== 'ANSWERED';
      const e = byDay.get(d) ?? { day: d, inbound: 0, outbound: 0, internal: 0, missed: 0 };
      if (r.direction === 'Inbound') e.inbound++; else if (r.direction === 'Outbound') e.outbound++; else e.internal++;
      if (missed) e.missed++;
      byDay.set(d, e);
      byHour[hour].total++; if (missed) byHour[hour].missed++;
      if (r.helenaUserId) {
        const u = byUser.get(r.helenaUserId) ?? { userId: r.helenaUserId, name: names.get(r.helenaUserId) || 'Sem nome', total: 0, answered: 0, missed: 0, talk: 0 };
        u.total++; if (r.status === 'ANSWERED') u.answered++; if (missed) u.missed++; u.talk += r.talkDuration ?? 0;
        byUser.set(r.helenaUserId, u);
      }
    }
    const last = await prisma.pbx.findFirst({ where: sw.companyId ? { companies: { some: { id: sw.companyId } } } : {}, select: { cdrSyncedAt: true, clientIdEnc: true } });
    return {
      truncated: rows.length >= MAX_ROWS,
      syncedAt: last?.cdrSyncedAt ?? null,
      apiConfigured: Boolean(last?.clientIdEnc),
      kpis: {
        total: rows.length,
        inbound: inbound.length,
        outbound: rows.filter((r) => r.direction === 'Outbound').length,
        internal: rows.filter((r) => r.direction === 'Internal').length,
        answeredInbound: answeredIn.length,
        missedInbound: inbound.length - answeredIn.length,
        answerRate: inbound.length ? Math.round((answeredIn.length / inbound.length) * 1000) / 10 : null,
        avgTalk: avg(answeredAll.map((r) => r.talkDuration)),
        avgWait: avg(answeredIn.map((r) => r.ringDuration)),
        totalTalk: sum(answeredAll.map((r) => r.talkDuration)),
      },
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      byHour,
      byUser: [...byUser.values()].sort((a, b) => b.total - a.total),
    };
  });

  // ---- Sincronizar agora (master) ----
  app.post('/v1/panel/pbx/:id/sync', { preHandler: requireAuth('manage_pbx') }, async (req: FastifyRequest, reply) => {
    const user = req.user as PanelToken;
    const id = String((req.params as any).id);
    const pbx = await prisma.pbx.findUnique({ where: { id } });
    if (!pbx) return reply.code(404).send({ error: 'PBX não encontrado' });
    if (!pbx.clientIdEnc) return reply.code(400).send({ error: 'configure o Client ID/Secret da API deste PBX' });
    const inserted = await syncPbx(id, req.log);
    const after = await prisma.pbx.findUnique({ where: { id }, select: { cdrSyncedAt: true, cdrSyncError: true } });
    await prisma.auditLog.create({ data: { actor: user.userId, action: 'cdr_sync_manual', payload: { pbxId: id, inserted } } });
    if (after?.cdrSyncError) return reply.code(502).send({ error: after.cdrSyncError });
    return { ok: true, inserted, syncedAt: after?.cdrSyncedAt };
  });
}

// URL de download do PBX vale 30 min: guarda por 25 para não pedir a cada play/seek.
const dlCache = new Map<number, { url: string; exp: number }>();
async function downloadUrl(creds: PbxCreds, recordingId: number): Promise<string> {
  const hit = dlCache.get(recordingId);
  if (hit && hit.exp > Date.now()) return hit.url;
  const res = await openapiGet(creds, 'v1.0/recording/download', { id: recordingId });
  const url = String(res.download_resource_url ?? '');
  if (!url.startsWith('/')) throw new Error('PBX não devolveu a URL da gravação');
  dlCache.set(recordingId, { url, exp: Date.now() + 25 * 60_000 });
  return url;
}

// Auditoria: todo download; "ouvir" no máximo 1 registro por pessoa/chamada a cada 10 min.
const heard = new Map<string, number>();
async function auditRecording(user: PanelToken, companyId: string | null, callId: string, download: boolean): Promise<void> {
  const key = `${user.userId}|${callId}`;
  if (!download && (heard.get(key) ?? 0) > Date.now() - 10 * 60_000) return;
  if (!download) heard.set(key, Date.now());
  await prisma.auditLog.create({
    data: { companyId, actor: user.userId, action: download ? 'recording_download' : 'recording_play', payload: { callId } },
  });
}
