// Módulo Acessos: granulação total por usuário.
// - GET /v1/panel/me      : papel e permissões efetivas de quem está logado
// - GET /v1/panel/access  : matriz usuário × permissão (manage_access)
// - PUT /v1/panel/access/:helenaUserId : liga/desliga uma permissão (manage_access)
//
// Regras:
// - Todo usuário tem todas as permissões ajustáveis; o papel é só o padrão.
// - Master (SUPER_ADMIN/PARTNER_ADMIN) não pode ser restringido.
// - Ninguém altera as próprias permissões.
// - Quem não é master não mexe em "Conceder acessos" nem em outro admin da empresa.
// - Voltar ao padrão do papel apaga o ajuste (o usuário segue o papel de novo).
// - Toda mudança vai para o audit_log.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { requireAuth, type PanelToken } from './auth.js';
import { listAgentsCached } from './helena-admin.js';
import {
  effectiveScope, effectivePermissions, roleFromProfile, roleDefaultOn, isMaster,
  GRANTABLE, MASTER_ONLY, type Permission, type Role,
} from './rbac.js';

const LABELS: Record<string, string> = {
  view_extensions: 'Ver ramais da empresa',
  manage_extensions: 'Alterar ramais (vincular/desvincular)',
  view_dashboard: 'Ver dashboard da empresa',
  view_cdr: 'Ver chamadas da empresa',
  export_cdr: 'Exportar chamadas',
  play_recording: 'Ouvir gravações da empresa',
  manage_access: 'Conceder e retirar acessos',
};

/** Empresa em que o chamador administra acessos, e se ele é master lá. */
async function accessContext(user: PanelToken, requested?: string): Promise<{ companyId: string; master: boolean } | null> {
  const scope = await effectiveScope(user, 'manage_access');
  if (!scope) return null;
  const master = scope === 'all' || scope === 'partner';
  if (scope === 'all') return { companyId: requested || user.companyId, master };
  if (scope === 'partner') {
    const target = requested || user.companyId;
    const c = await prisma.company.findUnique({ where: { id: target } });
    return c && c.partnerId === user.partnerId ? { companyId: target, master } : null;
  }
  return !requested || requested === user.companyId ? { companyId: user.companyId, master } : null;
}

async function rolesFor(companyId: string, agents: { userId: string; profile?: string }[]) {
  const ids = agents.map((a) => a.userId);
  const [platform, overrides] = await Promise.all([
    prisma.platformRole.findMany({ where: { helenaUserId: { in: ids } } }),
    prisma.roleOverride.findMany({ where: { companyId, helenaUserId: { in: ids } } }),
  ]);
  return (uid: string, profile?: string): Role => {
    const p = platform.find((r) => r.helenaUserId === uid);
    if (p) return p.role as Role;
    const o = overrides.find((r) => r.helenaUserId === uid);
    if (o) return o.role as Role;
    return roleFromProfile(profile);
  };
}

/** Por que o chamador não pode mexer nesta célula (null = pode). */
function lockReason(ctx: { master: boolean }, callerId: string, targetId: string, targetRole: Role, perm: Permission): string | null {
  if (isMaster(targetRole)) return 'Master: acesso total, não pode ser restringido';
  if (targetId === callerId) return 'Você não pode alterar as suas próprias permissões';
  if (!ctx.master && MASTER_ONLY.includes(perm)) return 'Só o master concede esta permissão';
  if (!ctx.master && targetRole === 'COMPANY_ADMIN') return 'Só o master altera outro administrador da empresa';
  return null;
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
    const ctx = await accessContext(user, (req.query as any).companyId);
    if (!ctx) return reply.code(403).send({ error: 'fora do seu escopo' });
    const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
    if (!company) return reply.code(404).send({ error: 'empresa não encontrada' });
    if (!company.helenaApiTokenEnc) return reply.code(400).send({ error: 'token da API Helena não configurado para esta empresa' });

    let agents;
    try { agents = await listAgentsCached(company.id, company.helenaApiTokenEnc, true); }
    catch (e) { req.log.error(e); return reply.code(502).send({ error: 'falha ao consultar usuários no Comunic Chat' }); }

    const roleOf = await rolesFor(company.id, agents);
    const grants = await prisma.permissionGrant.findMany({ where: { companyId: company.id, helenaUserId: { in: agents.map((a) => a.userId) } } });

    return {
      master: ctx.master,
      grantable: GRANTABLE.map((p) => ({ permission: p, label: LABELS[p] ?? p })),
      users: agents.map((a) => {
        const role = roleOf(a.userId, a.profile);
        const perms: Record<string, { on: boolean; source: 'master' | 'role' | 'granted' | 'denied' | 'none'; locked: string | null }> = {};
        for (const p of GRANTABLE) {
          const def = roleDefaultOn(role, p);
          const g = grants.find((x) => x.helenaUserId === a.userId && x.permission === p);
          const on = isMaster(role) ? true : g ? g.allowed : def;
          const source = isMaster(role) ? 'master' : g ? (g.allowed ? 'granted' : 'denied') : def ? 'role' : 'none';
          perms[p] = { on, source, locked: lockReason(ctx, user.userId, a.userId, role, p) };
        }
        return { userId: a.userId, name: a.name, email: a.email, profile: a.profile, role, self: a.userId === user.userId, perms };
      }),
    };
  });

  app.put('/v1/panel/access/:helenaUserId', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const target = String((req.params as any).helenaUserId);
    const b = (req.body ?? {}) as { permission?: string; granted?: boolean; companyId?: string };
    const ctx = await accessContext(user, b.companyId);
    if (!ctx) return reply.code(403).send({ error: 'fora do seu escopo' });
    const perm = b.permission as Permission;
    if (!perm || !GRANTABLE.includes(perm)) return reply.code(400).send({ error: 'permissão inválida' });
    if (typeof b.granted !== 'boolean') return reply.code(400).send({ error: 'informe granted (true/false)' });

    // O alvo precisa ser usuário desta empresa (lista do Comunic Chat).
    const company = await prisma.company.findUnique({ where: { id: ctx.companyId } });
    if (!company?.helenaApiTokenEnc) return reply.code(400).send({ error: 'token da API Helena não configurado para esta empresa' });
    const agents = await listAgentsCached(company.id, company.helenaApiTokenEnc);
    const agent = agents.find((a) => a.userId === target);
    if (!agent) return reply.code(404).send({ error: 'usuário não pertence a esta empresa' });
    const role = (await rolesFor(company.id, [agent]))(agent.userId, agent.profile);

    const lock = lockReason(ctx, user.userId, target, role, perm);
    if (lock) return reply.code(403).send({ error: lock });

    const where = { companyId_helenaUserId_permission: { companyId: company.id, helenaUserId: target, permission: perm } };
    if (b.granted === roleDefaultOn(role, perm)) {
      // Igual ao padrão do papel: remove o ajuste (volta a seguir o papel).
      await prisma.permissionGrant.deleteMany({ where: { companyId: company.id, helenaUserId: target, permission: perm } });
    } else {
      await prisma.permissionGrant.upsert({
        where,
        update: { allowed: b.granted, grantedBy: user.userId },
        create: { companyId: company.id, helenaUserId: target, permission: perm, allowed: b.granted, grantedBy: user.userId },
      });
    }
    await prisma.auditLog.create({
      data: {
        companyId: company.id, actor: user.userId,
        action: b.granted ? 'permission_grant' : 'permission_revoke',
        payload: { helenaUserId: target, name: agent.name ?? null, permission: perm, role },
      },
    });
    return { ok: true };
  });
}
