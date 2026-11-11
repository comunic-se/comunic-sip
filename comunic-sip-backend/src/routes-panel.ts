// Rotas do painel de gestão. Tudo protegido por requireAuth + escopo.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { requireAuth, type PanelToken } from './auth.js';
import { listAgents } from './helena-admin.js';
import { permissionScope } from './rbac.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Resolve em qual empresa o chamador pode operar manage_extensions.
async function resolveTargetCompany(user: PanelToken, requested?: string): Promise<string | null> {
  const scope = permissionScope(user.role, 'manage_extensions');
  if (!scope) return null;
  if (scope === 'all') return requested || user.companyId;
  if (scope === 'partner') {
    const target = requested || user.companyId;
    const c = await prisma.company.findUnique({ where: { id: target } });
    if (!c || c.partnerId !== user.partnerId) return null;
    return target;
  }
  // company/department/self: sempre a própria empresa
  return user.companyId;
}

function extInRanges(ext: string, ranges: { fromExt: string; toExt: string }[]): boolean {
  return ranges.some(
    (r) => ext.length === r.fromExt.length && ext >= r.fromExt && ext <= r.toExt,
  );
}

export async function registerPanelRoutes(app: FastifyInstance): Promise<void> {
  // Página do painel (dev): servida pelo próprio backend.
  app.get('/painel', async (_req, reply) => {
    const html = await readFile(resolve(process.cwd(), 'public/painel.html'), 'utf8');
    // O painel é exibido como "Página interna" (iframe) do Comunic Chat.
    // Só os domínios do Helena podem embutir esta página; qualquer outro site é bloqueado.
    const ancestors = process.env.PANEL_FRAME_ANCESTORS
      || "'self' https://*.wts.chat https://*.flw.chat";
    return reply
      .header('Content-Security-Policy', `frame-ancestors ${ancestors}`)
      .type('text/html')
      .send(html);
  });

  app.get('/logo-comunic.svg', async (_req, reply) => {
    const svg = await readFile(resolve(process.cwd(), 'public/logo-comunic.svg'), 'utf8');
    return reply.type('image/svg+xml').send(svg);
  });

  // Usuários da empresa (Helena) + ramal vinculado (se houver).
  app.get('/v1/panel/users', { preHandler: requireAuth('manage_extensions') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as { companyId?: string };
    const companyId = await resolveTargetCompany(user, q.companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.code(404).send({ error: 'empresa não encontrada' });
    if (!company.helenaApiTokenEnc) {
      return reply.code(400).send({ error: 'token da API Helena não configurado para esta empresa' });
    }

    let agents;
    try {
      agents = await listAgents(decryptSecret(company.helenaApiTokenEnc));
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: 'falha ao consultar usuários na Helena' });
    }

    const links = await prisma.extensionLink.findMany({ where: { companyId } });
    const byUser = new Map(links.map((l) => [l.helenaUserId, l.extensionNumber]));
    return agents.map((a) => ({
      userId: a.userId,
      name: a.name,
      email: a.email,
      profile: a.profile,
      departmentIds: a.departments.map((d) => d.departmentId),
      extension: byUser.get(a.userId) ?? null,
    }));
  });

  // Faixas de ramais da empresa.
  app.get('/v1/panel/ranges', { preHandler: requireAuth('manage_extensions') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const q = req.query as { companyId?: string };
    const companyId = await resolveTargetCompany(user, q.companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });
    const ranges = await prisma.extensionRange.findMany({ where: { companyId } });
    return ranges.map((r) => ({ from: r.fromExt, to: r.toExt }));
  });

  // Vincula/atualiza o ramal de um usuário.
  app.post('/v1/panel/extensions', { preHandler: requireAuth('manage_extensions') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const body = (req.body ?? {}) as { helenaUserId?: string; extension?: string; companyId?: string };
    if (!body.helenaUserId || !body.extension) {
      return reply.code(400).send({ error: 'helenaUserId e extension são obrigatórios' });
    }
    const companyId = await resolveTargetCompany(user, body.companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });

    const ext = body.extension.trim();
    const ranges = await prisma.extensionRange.findMany({ where: { companyId } });
    if (!extInRanges(ext, ranges)) return reply.code(400).send({ error: 'ramal fora da faixa da empresa' });

    const link = await prisma.extensionLink.upsert({
      where: { companyId_helenaUserId: { companyId, helenaUserId: body.helenaUserId } },
      update: { extensionNumber: ext },
      create: { companyId, helenaUserId: body.helenaUserId, extensionNumber: ext, createdBy: user.userId },
    });
    await prisma.auditLog.create({
      data: { companyId, actor: user.userId, action: 'extension_link', payload: { helenaUserId: body.helenaUserId, extension: ext } },
    });
    return { ok: true, extension: link.extensionNumber };
  });

  // Remove o vínculo de um usuário.
  app.delete('/v1/panel/extensions/:helenaUserId', { preHandler: requireAuth('manage_extensions') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const params = req.params as { helenaUserId: string };
    const q = req.query as { companyId?: string };
    const companyId = await resolveTargetCompany(user, q.companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });
    await prisma.extensionLink.deleteMany({ where: { companyId, helenaUserId: params.helenaUserId } });
    await prisma.auditLog.create({
      data: { companyId, actor: user.userId, action: 'extension_unlink', payload: { helenaUserId: params.helenaUserId } },
    });
    return { ok: true };
  });
}
