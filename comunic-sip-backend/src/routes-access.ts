// Acessos: granulação por USUÁRIO, por GRUPO (setor do Comunic Chat) e por FUNÇÃO
// (perfil do Comunic Chat), mais os GRUPOS VISÍVEIS de cada pessoa. A edição fica na
// tela Ramais (abas Usuários | Grupos | Funções).
// - GET /v1/panel/me                         papel e permissões efetivas de quem está logado
// - GET /v1/panel/groups                     setores da empresa (filtros em todas as telas)
// - GET /v1/panel/access                     usuários × permissões + regras de grupo/função
// - PUT /v1/panel/access/rule                liga / desliga / volta a herdar uma permissão
// - PUT /v1/panel/access/visibility/:userId  grupos cujos dados a pessoa enxerga
//
// Precedência (o mais específico vence): usuário > grupo > função > papel. Ver rbac.ts.
// Regras:
// - Master (SUPER_ADMIN/PARTNER_ADMIN) não pode ser restringido.
// - Ninguém altera as próprias permissões nem a própria visibilidade.
// - Quem não é master não mexe em "Conceder acessos" nem em outro admin da empresa.
// - Regras de grupo/função não alcançam administradores da empresa.
// - Toda mudança vai para o audit_log.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { requireAuth, type PanelToken } from './auth.js';
import { listAgentsCached, listDepartmentsCached, type HelenaAgent } from './helena-admin.js';
import {
  effectiveScope, effectivePermissions, roleFromProfile, isMaster, decide, profileKey,
  GRANTABLE, MASTER_ONLY, type Permission, type Role,
} from './rbac.js';

const LABELS: Record<string, string> = {
  view_extensions: 'Ver ramais',
  manage_extensions: 'Alterar ramais (vincular/desvincular)',
  view_dashboard: 'Ver dashboard',
  view_cdr: 'Ver chamadas',
  export_cdr: 'Exportar chamadas',
  play_recording: 'Ouvir gravações',
  download_recording: 'Baixar gravações',
  manage_access: 'Conceder e retirar acessos',
};

const PROFILE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super Administrador', SUPERADMINISTRADOR: 'Super Administrador', OWNER: 'Proprietário',
  ADMIN: 'Administrador', ADMINISTRADOR: 'Administrador',
  AGENT: 'Atendente', ATENDENTE: 'Atendente',
  RESTRICTEDAGENT: 'Atendente restrito', SEMPERFIL: 'Sem perfil',
};

type Ctx = { companyId: string; master: boolean };

/** Empresa em que o chamador administra acessos, e se ele é master lá. */
async function accessContext(user: PanelToken, requested?: string): Promise<Ctx | null> {
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

/** Por que o chamador não pode mexer nesta pessoa/permissão (null = pode). */
function userLock(ctx: Ctx, callerId: string, targetId: string, targetRole: Role, perm?: Permission): string | null {
  if (isMaster(targetRole)) return 'Master: acesso total, não pode ser restringido';
  if (targetId === callerId) return 'Você não pode alterar os seus próprios acessos';
  if (perm && !ctx.master && MASTER_ONLY.includes(perm)) return 'Só o master concede esta permissão';
  if (!ctx.master && targetRole === 'COMPANY_ADMIN') return 'Só o master altera outro administrador da empresa';
  return null;
}

/** Por que não dá para mexer numa regra de grupo/função (null = pode). */
function ruleLock(ctx: Ctx, perm: Permission): string | null {
  return !ctx.master && MASTER_ONLY.includes(perm) ? 'Só o master concede esta permissão' : null;
}

/** Perfis que viram administrador da empresa: regra por função não vale para eles. */
const profileIsAdmin = (profile?: string) => roleFromProfile(profile) === 'COMPANY_ADMIN';

async function companyAgents(companyId: string, fresh = false): Promise<{ agents: HelenaAgent[]; tokenEnc: string } | { error: string; code: number }> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: 'empresa não encontrada', code: 404 };
  if (!company.helenaApiTokenEnc) return { error: 'token da API Helena não configurado para esta empresa', code: 400 };
  try {
    return { agents: await listAgentsCached(company.id, company.helenaApiTokenEnc, fresh), tokenEnc: company.helenaApiTokenEnc };
  } catch {
    return { error: 'falha ao consultar usuários no Comunic Chat', code: 502 };
  }
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
      deptIds: user.deptIds ?? [],
      permissions: await effectivePermissions(user),
    };
  });

  // Setores da empresa (para filtros). Qualquer pessoa do painel vê os nomes da própria
  // empresa; outra empresa só quem tem escopo master.
  app.get('/v1/panel/groups', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as PanelToken;
    const requested = (req.query as any).companyId as string | undefined;
    let companyId = user.companyId;
    if (requested && requested !== user.companyId) {
      const s = await effectiveScope(user, 'view_cdr');
      if (s === 'all') companyId = requested;
      else if (s === 'partner') {
        const c = await prisma.company.findUnique({ where: { id: requested } });
        if (!c || c.partnerId !== user.partnerId) return reply.code(403).send({ error: 'fora do seu escopo' });
        companyId = requested;
      } else return reply.code(403).send({ error: 'fora do seu escopo' });
    }
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company?.helenaApiTokenEnc) return { items: [] };
    try {
      return { items: await listDepartmentsCached(company.id, company.helenaApiTokenEnc) };
    } catch (e) {
      req.log.warn(e, 'grupos: falha ao consultar setores no Comunic Chat');
      return { items: [] };
    }
  });

  app.get('/v1/panel/access', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const ctx = await accessContext(user, (req.query as any).companyId);
    if (!ctx) return reply.code(403).send({ error: 'fora do seu escopo' });
    const ca = await companyAgents(ctx.companyId, true);
    if ('error' in ca) return reply.code(ca.code).send({ error: ca.error });
    const { agents } = ca;
    const groups = await listDepartmentsCached(ctx.companyId, ca.tokenEnc).catch(() => []);

    const roleOf = await rolesFor(ctx.companyId, agents);
    const [rules, visibility] = await Promise.all([
      prisma.accessRule.findMany({ where: { companyId: ctx.companyId } }),
      prisma.userVisibility.findMany({ where: { companyId: ctx.companyId } }),
    ]);

    // Regras de grupo e de função, como mapas { id: { permissão: true|false } }.
    const groupRules: Record<string, Record<string, boolean>> = {};
    const profileRules: Record<string, Record<string, boolean>> = {};
    for (const r of rules) {
      if (r.subjectType === 'group') (groupRules[r.subjectId] ??= {})[r.permission] = r.allowed;
      if (r.subjectType === 'profile') (profileRules[r.subjectId] ??= {})[r.permission] = r.allowed;
    }

    // Funções = perfis que existem de fato na empresa.
    const profiles = new Map<string, { key: string; label: string; members: number; admin: boolean }>();
    for (const a of agents) {
      const key = profileKey(a.profile);
      const p = profiles.get(key) ?? { key, label: PROFILE_LABEL[key] ?? a.profile ?? key, members: 0, admin: profileIsAdmin(a.profile) };
      p.members++;
      profiles.set(key, p);
    }

    return {
      master: ctx.master,
      grantable: GRANTABLE.map((p) => ({ permission: p, label: LABELS[p] ?? p, masterOnly: MASTER_ONLY.includes(p) && !ctx.master })),
      groups: groups.map((g) => ({
        ...g, members: agents.filter((a) => a.departments.some((d) => d.departmentId === g.id)).length,
      })),
      profiles: [...profiles.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      rules: { group: groupRules, profile: profileRules },
      users: agents.map((a) => {
        const role = roleOf(a.userId, a.profile);
        const who = { userId: a.userId, deptIds: a.departments.map((d) => d.departmentId), profile: a.profile };
        const perms: Record<string, { on: boolean; source: string; explicit: boolean; inherited: { on: boolean; source: string }; locked: string | null }> = {};
        // O que valeria sem a regra individual (mostrado como "Herda: …" na tela).
        const withoutMine = rules.filter((r) => !(r.subjectType === 'user' && r.subjectId === a.userId));
        for (const p of GRANTABLE) {
          const d = decide(role, p, who, rules, isMaster(role));
          const inh = decide(role, p, who, withoutMine, isMaster(role));
          perms[p] = {
            on: Boolean(d.scope),
            source: d.source,
            explicit: d.source === 'user',
            inherited: { on: Boolean(inh.scope), source: inh.source },
            locked: userLock(ctx, user.userId, a.userId, role, p),
          };
        }
        const v = visibility.find((x) => x.helenaUserId === a.userId);
        return {
          userId: a.userId, name: a.name, email: a.email, profile: a.profile, profileKey: profileKey(a.profile),
          role, departmentIds: who.deptIds, self: a.userId === user.userId, perms,
          visibility: { custom: Boolean(v), departmentIds: v?.departmentIds ?? null, locked: userLock(ctx, user.userId, a.userId, role) },
        };
      }),
    };
  });

  // Liga (true), desliga (false) ou volta a herdar (null) uma permissão para um usuário,
  // um grupo ou uma função.
  app.put('/v1/panel/access/rule', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const b = (req.body ?? {}) as { companyId?: string; subjectType?: string; subjectId?: string; permission?: string; value?: boolean | null };
    const ctx = await accessContext(user, b.companyId);
    if (!ctx) return reply.code(403).send({ error: 'fora do seu escopo' });
    const perm = b.permission as Permission;
    if (!perm || !GRANTABLE.includes(perm)) return reply.code(400).send({ error: 'permissão inválida' });
    if (!['user', 'group', 'profile'].includes(b.subjectType ?? '')) return reply.code(400).send({ error: 'subjectType inválido' });
    if (!b.subjectId) return reply.code(400).send({ error: 'informe subjectId' });
    if (b.value !== null && typeof b.value !== 'boolean') return reply.code(400).send({ error: 'value deve ser true, false ou null' });
    const subjectType = b.subjectType as 'user' | 'group' | 'profile';
    const subjectId = String(b.subjectId);

    const ca = await companyAgents(ctx.companyId);
    if ('error' in ca) return reply.code(ca.code).send({ error: ca.error });
    let label: string | null = null;

    if (subjectType === 'user') {
      const agent = ca.agents.find((a) => a.userId === subjectId);
      if (!agent) return reply.code(404).send({ error: 'usuário não pertence a esta empresa' });
      const role = (await rolesFor(ctx.companyId, [agent]))(agent.userId, agent.profile);
      const lock = userLock(ctx, user.userId, subjectId, role, perm);
      if (lock) return reply.code(403).send({ error: lock });
      label = agent.name ?? null;
    } else if (subjectType === 'group') {
      const groups = await listDepartmentsCached(ctx.companyId, ca.tokenEnc).catch(() => []);
      const g = groups.find((x) => x.id === subjectId);
      if (!g) return reply.code(404).send({ error: 'grupo não encontrado no Comunic Chat' });
      const lock = ruleLock(ctx, perm);
      if (lock) return reply.code(403).send({ error: lock });
      label = g.name;
    } else {
      const agent = ca.agents.find((a) => profileKey(a.profile) === subjectId);
      if (!agent) return reply.code(404).send({ error: 'função não encontrada nesta empresa' });
      if (profileIsAdmin(agent.profile)) return reply.code(400).send({ error: 'regras por função não valem para administradores; ajuste a pessoa individualmente' });
      const lock = ruleLock(ctx, perm);
      if (lock) return reply.code(403).send({ error: lock });
      label = PROFILE_LABEL[subjectId] ?? agent.profile ?? subjectId;
    }

    const key = { companyId: ctx.companyId, subjectType, subjectId, permission: perm };
    if (b.value === null) {
      await prisma.accessRule.deleteMany({ where: key });
    } else {
      await prisma.accessRule.upsert({
        where: { companyId_subjectType_subjectId_permission: key },
        update: { allowed: b.value, updatedBy: user.userId },
        create: { ...key, allowed: b.value, updatedBy: user.userId },
      });
    }
    await prisma.auditLog.create({
      data: {
        companyId: ctx.companyId, actor: user.userId,
        action: b.value === null ? 'access_rule_inherit' : b.value ? 'access_rule_allow' : 'access_rule_deny',
        payload: { subjectType, subjectId, label, permission: perm },
      },
    });
    return { ok: true };
  });

  // Grupos cujos dados a pessoa enxerga. null = volta ao padrão.
  app.put('/v1/panel/access/visibility/:helenaUserId', { preHandler: requireAuth('manage_access') }, async (req, reply) => {
    const user = req.user as PanelToken;
    const target = String((req.params as any).helenaUserId);
    const b = (req.body ?? {}) as { companyId?: string; departmentIds?: string[] | null };
    const ctx = await accessContext(user, b.companyId);
    if (!ctx) return reply.code(403).send({ error: 'fora do seu escopo' });
    const ca = await companyAgents(ctx.companyId);
    if ('error' in ca) return reply.code(ca.code).send({ error: ca.error });
    const agent = ca.agents.find((a) => a.userId === target);
    if (!agent) return reply.code(404).send({ error: 'usuário não pertence a esta empresa' });
    const role = (await rolesFor(ctx.companyId, [agent]))(agent.userId, agent.profile);
    const lock = userLock(ctx, user.userId, target, role);
    if (lock) return reply.code(403).send({ error: lock });

    if (b.departmentIds === null) {
      await prisma.userVisibility.deleteMany({ where: { companyId: ctx.companyId, helenaUserId: target } });
    } else {
      if (!Array.isArray(b.departmentIds)) return reply.code(400).send({ error: 'departmentIds deve ser uma lista (ou null)' });
      const groups = await listDepartmentsCached(ctx.companyId, ca.tokenEnc).catch(() => []);
      const valid = new Set(groups.map((g) => g.id));
      const ids = [...new Set(b.departmentIds.map(String))];
      if (ids.some((id) => !valid.has(id))) return reply.code(400).send({ error: 'grupo inválido' });
      await prisma.userVisibility.upsert({
        where: { companyId_helenaUserId: { companyId: ctx.companyId, helenaUserId: target } },
        update: { departmentIds: ids, updatedBy: user.userId },
        create: { companyId: ctx.companyId, helenaUserId: target, departmentIds: ids, updatedBy: user.userId },
      });
    }
    await prisma.auditLog.create({
      data: {
        companyId: ctx.companyId, actor: user.userId, action: 'access_visibility',
        payload: { helenaUserId: target, name: agent.name ?? null, departmentIds: b.departmentIds ?? null },
      },
    });
    return { ok: true };
  });
}
