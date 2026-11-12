// Módulo Acessos: quem pode o quê, e concessão de permissões extras.
// - GET  /v1/panel/me      : papel e permissões efetivas de quem está logado
// - GET  /v1/panel/access  : usuários da empresa, papel e permissões extras (manage_access)
// - PUT  /v1/panel/access/:helenaUserId : concede/revoga uma permissão (manage_access)
// Regras: só permissões da lista GRANTABLE; ninguém altera as próprias permissões;
// tudo vai para o audit_log.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { requireAuth, type PanelToken } from './auth.js';
import { listAgents } from './helena-admin.js';
import { effectiveScope, effectivePermissions, permissionScope, roleFromProfile, GRANTABLE, type Permission, type Role } from './rbac.js';

const LABELS: Record<string, string> = {
  view_extensions: 'Ver ramais da empresa',
  manage_extensions: 'Alterar ramais (vincular/desvincular)',
  view_dashboard: 'Ver dashboard da empresa',
  view_cdr: 'Ver chamadas da empresa',
  export_cdr: 'Exportar chamadas',
  play_recording: 'Ouvir gravações da empresa',
};

async function targetCompany(user: PanelToken, requested?: string): Promise<string | null> {
  const scope = await effectiveScope(user, 'manage_access');
  if (!scope) return null;
  if (scope === 'all') return requested || user.companyId;
  if (scope === 'partner') {
    const target = requested || user.companyId;
    const c = await prisma.company.findUnique({ where: { id: target } });
    return c && c.partnerId === user.partnerId ? target : null;
  }
  return !requested || requested === user.companyId ? user.companyId : null;
}

export async function registerAccessRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/panel/me', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as PanelToken;
    const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { id: true, name: true } });
    return {
      userId: user.userId,
      role: user.role,
      emergency: Boolean(user.emergency),
      company,
      permissions: await effectivePermissions(user),
    };
  });

  app.get('/v1/panel/access', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const companyId = await targetCompany(user, (req.query as any).companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.code(404).send({ error: 'empresa não encontrada' });
    if (!company.helenaApiTokenEnc) return reply.code(400).send({ error: 'token da API Helena não configurado para esta empresa' });

    let agents;
    try { agents = await listAgents(decryptSecret(company.helenaApiTokenEnc)); }
    catch (e) { req.log.error(e); return reply.code(502).send({ error: 'falha ao consultar usuários no Comunic Chat' }); }

    const ids = agents.map((a) => a.userId);
    const [platform, overrides, grants] = await Promise.all([
      prisma.platformRole.findMany({ where: { helenaUserId: { in: ids } } }),
      prisma.roleOverride.findMany({ where: { companyId, helenaUserId: { in: ids } } }),
      prisma.permissionGrant.findMany({ where: { companyId, helenaUserId: { in: ids } } }),
    ]);
    const roleOf = (uid: string, profile?: string): Role => {
      const p = platform.find((r) => r.helenaUserId === uid);
      if (p) return p.role as Role;
      const o = overrides.find((r) => r.helenaUserId === uid);
      if (o) return o.role as Role;
      return roleFromProfile(profile);
    };
    // O que o papel já dá na empresa inteira (não precisa de concessão).
    const included = (role: Role) =>
      GRANTABLE.filter((p) => ['company', 'partner', 'all'].includes(permissionScope(role, p) ?? ''));
    return {
      grantable: GRANTABLE.map((p) => ({ permission: p, label: LABELS[p] ?? p })),
      users: agents.map((a) => ({
        userId: a.userId,
        name: a.name,
        email: a.email,
        profile: a.profile,
        role: roleOf(a.userId, a.profile),
        included: included(roleOf(a.userId, a.profile)),
        self: a.userId === user.userId,
        grants: grants.filter((g) => g.helenaUserId === a.userId).map((g) => ({ permission: g.permission, grantedBy: g.grantedBy, at: g.createdAt })),
      })),
    };
  });

  app.put('/v1/panel/access/:helenaUserId', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const target = String((req.params as any).helenaUserId);
    const b = (req.body ?? {}) as { permission?: string; granted?: boolean; companyId?: string };
    const companyId = await targetCompany(user, b.companyId);
    if (!companyId) return reply.code(403).send({ error: 'fora do seu escopo' });
    if (!b.permission || !GRANTABLE.includes(b.permission as Permission)) return reply.code(400).send({ error: 'permissão não pode ser concedida' });
    if (typeof b.granted !== 'boolean') return reply.code(400).send({ error: 'informe granted (true/false)' });
    if (target === user.userId) return reply.code(403).send({ error: 'você não pode alterar as suas próprias permissões' });
    if (!/^[0-9a-f-]{36}$/i.test(target)) return reply.code(400).send({ error: 'usuário inválido' });

    const key = { companyId_helenaUserId_permission: { companyId, helenaUserId: target, permission: b.permission } };
    if (b.granted) {
      await prisma.permissionGrant.upsert({ where: key, update: {}, create: { companyId, helenaUserId: target, permission: b.permission, grantedBy: user.userId } });
    } else {
      await prisma.permissionGrant.deleteMany({ where: { companyId, helenaUserId: target, permission: b.permission } });
    }
    await prisma.auditLog.create({
      data: { companyId, actor: user.userId, action: b.granted ? 'permission_grant' : 'permission_revoke', payload: { helenaUserId: target, permission: b.permission } },
    });
    return { ok: true };
  });
}
