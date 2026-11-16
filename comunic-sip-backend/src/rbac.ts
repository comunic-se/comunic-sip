// Controle de acesso (RBAC) com MÍNIMO PRIVILÉGIO.
// Ver docs/painel-gestao-rbac.md.
//
// Papel efetivo (resolveScope): platform_role > role_override > perfil do Helena.
//   Helena "Super Administrador" -> COMPANY_ADMIN  (altera na própria empresa e concede permissões)
//   Helena "Administrador"       -> COMPANY_VIEWER (só visualiza a empresa)
//   Helena "Atendente"/"Restrito"-> AGENT          (só o próprio)
//
// Ajustes (tabela access_rule), o MAIS ESPECÍFICO VENCE:
//   usuário  >  grupo (setor do Comunic Chat)  >  função (perfil do Comunic Chat)  >  papel
// - Grupo: se a pessoa está em vários setores e algum libera, vale liberado.
// - Regras de grupo/função não alcançam COMPANY_ADMIN (só o master ajusta um admin, e
//   individualmente). MASTER (SUPER_ADMIN, e PARTNER_ADMIN no seu parceiro) nunca é restringido.
// - O próprio usuário sempre vê os PRÓPRIOS dados (escopo 'self' não é negado).
//
// Visibilidade (tabela user_visibility): grupos cujos dados a pessoa enxerga. Sem registro,
// vale o padrão do escopo (setor = os setores dela; empresa = todos).
import { prisma } from './db.js';
import type { HelenaIdentity } from './helena.js';

export type Role = 'SUPER_ADMIN' | 'PARTNER_ADMIN' | 'COMPANY_ADMIN' | 'COMPANY_VIEWER' | 'SUPERVISOR' | 'AGENT';

export interface Scope {
  role: Role;
  userId: string;
  companyId: string;
  partnerId?: string | null;
  departmentIds: string[];
}

export type Permission =
  | 'provision_company' | 'manage_pbx' | 'manage_branding' | 'manage_roles' | 'manage_access'
  | 'view_extensions' | 'manage_extensions'
  | 'view_dashboard' | 'view_cdr' | 'export_cdr' | 'play_recording' | 'download_recording';

export type DataScope = 'all' | 'partner' | 'company' | 'department' | 'self';

const MATRIX: Record<Role, Partial<Record<Permission, DataScope>>> = {
  SUPER_ADMIN: {
    provision_company: 'all', manage_pbx: 'all', manage_branding: 'all', manage_roles: 'all', manage_access: 'all',
    view_extensions: 'all', manage_extensions: 'all',
    view_dashboard: 'all', view_cdr: 'all', export_cdr: 'all', play_recording: 'all', download_recording: 'all',
  },
  PARTNER_ADMIN: {
    provision_company: 'partner', manage_branding: 'partner', manage_roles: 'partner', manage_access: 'partner',
    view_extensions: 'partner', manage_extensions: 'partner',
    view_dashboard: 'partner', view_cdr: 'partner', export_cdr: 'partner', play_recording: 'partner', download_recording: 'partner',
  },
  COMPANY_ADMIN: {
    manage_access: 'company', view_extensions: 'company', manage_extensions: 'company',
    view_dashboard: 'company', view_cdr: 'company', export_cdr: 'company', play_recording: 'company', download_recording: 'company',
  },
  COMPANY_VIEWER: {
    view_extensions: 'company', view_dashboard: 'company', view_cdr: 'company',
  },
  SUPERVISOR: {
    view_extensions: 'department', view_dashboard: 'department', view_cdr: 'department', play_recording: 'department',
  },
  AGENT: {
    view_extensions: 'self', view_dashboard: 'self', view_cdr: 'self', play_recording: 'self',
  },
};

/** Permissões ajustáveis por usuário (escopo da empresa). */
export const GRANTABLE: Permission[] = [
  'view_extensions', 'manage_extensions', 'view_dashboard', 'view_cdr', 'export_cdr', 'play_recording', 'download_recording', 'manage_access',
];
/** Só o master (escopo all/partner em manage_access) mexe nestas. */
export const MASTER_ONLY: Permission[] = ['manage_access'];

export function isMaster(role: Role): boolean {
  return role === 'SUPER_ADMIN' || role === 'PARTNER_ADMIN';
}

/** O papel já liga esta permissão na empresa inteira? (padrão do interruptor) */
export function roleDefaultOn(role: Role, perm: Permission): boolean {
  return ['company', 'partner', 'all'].includes(permissionScope(role, perm) ?? '');
}

const RANK: Record<DataScope, number> = { self: 0, department: 1, company: 2, partner: 3, all: 4 };

export function permissionScope(role: Role, perm: Permission): DataScope | null {
  return MATRIX[role]?.[perm] ?? null;
}

export function can(role: Role, perm: Permission): boolean {
  return permissionScope(role, perm) !== null;
}

/** Quem está pedindo (o JWT). */
export interface Caller { role: Role; userId: string; companyId: string; deptIds?: string[]; profile?: string | null; emergency?: boolean }

/** Chave estável do perfil do Comunic Chat (ex.: "Super Admin" -> SUPERADMIN). */
export function profileKey(profile?: string | null): string {
  return (profile ?? '').toUpperCase().replace(/[^A-Z]/g, '') || 'SEMPERFIL';
}

export type RuleSource = 'master' | 'role' | 'profile' | 'group' | 'user';
type RuleRow = { subjectType: string; subjectId: string; permission: string; allowed: boolean };

/**
 * Decide uma permissão a partir das regras já carregadas. Puro (sem banco), para ser
 * usado tanto no pedido quanto na tela de acessos.
 */
export function decide(
  role: Role, perm: Permission,
  who: { userId: string; deptIds: string[]; profile?: string | null },
  rules: RuleRow[], master = false,
): { scope: DataScope | null; source: RuleSource; ruleOn: boolean | null } {
  const byRole = permissionScope(role, perm);
  if (master || byRole === 'all' || byRole === 'partner' || !GRANTABLE.includes(perm)) {
    return { scope: byRole, source: byRole === 'all' || byRole === 'partner' || master ? 'master' : 'role', ruleOn: null };
  }
  const mine = rules.filter((r) => r.permission === perm);
  const userRule = mine.find((r) => r.subjectType === 'user' && r.subjectId === who.userId);
  let allowed: boolean | null = null;
  let source: RuleSource = 'role';
  if (userRule) { allowed = userRule.allowed; source = 'user'; }
  else if (role !== 'COMPANY_ADMIN') {
    const groupRules = mine.filter((r) => r.subjectType === 'group' && who.deptIds.includes(r.subjectId));
    const profRule = mine.find((r) => r.subjectType === 'profile' && r.subjectId === profileKey(who.profile));
    if (groupRules.length) { allowed = groupRules.some((r) => r.allowed); source = 'group'; }
    else if (profRule) { allowed = profRule.allowed; source = 'profile'; }
  }
  if (allowed === null) return { scope: byRole, source: 'role', ruleOn: null };
  if (allowed) return { scope: !byRole || RANK.company > RANK[byRole] ? 'company' : byRole, source, ruleOn: true };
  // Negado: perde o nível empresa; mantém só os próprios dados ('self') ou do setor, se o papel der.
  return { scope: byRole === 'self' || byRole === 'department' ? byRole : null, source, ruleOn: false };
}

/** Regras da empresa que podem afetar esta pessoa (ela, os setores dela, o perfil dela). */
async function rulesFor(user: Caller): Promise<RuleRow[]> {
  return prisma.accessRule.findMany({
    where: {
      companyId: user.companyId,
      OR: [
        { subjectType: 'user', subjectId: user.userId },
        { subjectType: 'group', subjectId: { in: user.deptIds ?? [] } },
        { subjectType: 'profile', subjectId: profileKey(user.profile) },
      ],
    },
    select: { subjectType: true, subjectId: true, permission: true, allowed: true },
  });
}

/**
 * Escopo efetivo de uma permissão. Consulta o banco a cada chamada, então qualquer
 * ajuste vale na hora, sem esperar o JWT expirar.
 */
export async function effectiveScope(user: Caller, perm: Permission): Promise<DataScope | null> {
  const byRole = permissionScope(user.role, perm);
  if (byRole === 'all' || byRole === 'partner' || user.emergency || !GRANTABLE.includes(perm)) return byRole;
  return decide(user.role, perm, { userId: user.userId, deptIds: user.deptIds ?? [], profile: user.profile }, await rulesFor(user)).scope;
}

/**
 * Grupos cujos dados a pessoa enxerga, dado o escopo efetivo da permissão:
 *   null      -> sem recorte por grupo (empresa inteira, parceiro, tudo)
 *   string[]  -> só esses setores (+ sempre os próprios dados)
 *   'self'    -> só os próprios dados
 * A visibilidade ajustada (user_visibility) substitui o padrão para quem não é master.
 */
export async function visibleGroups(user: Caller, scope: DataScope): Promise<string[] | null | 'self'> {
  if (scope === 'all' || scope === 'partner' || user.emergency) return null;
  const v = await prisma.userVisibility.findUnique({
    where: { companyId_helenaUserId: { companyId: user.companyId, helenaUserId: user.userId } },
  });
  if (v) return v.departmentIds;
  if (scope === 'company') return null;
  if (scope === 'department') return user.deptIds ?? [];
  return 'self';
}

/** Mapa permissão -> escopo efetivo (para o painel esconder o que não pode). */
export async function effectivePermissions(user: Caller): Promise<Partial<Record<Permission, DataScope>>> {
  const all: Permission[] = [
    'provision_company', 'manage_pbx', 'manage_branding', 'manage_roles', 'manage_access',
    'view_extensions', 'manage_extensions', 'view_dashboard', 'view_cdr', 'export_cdr', 'play_recording', 'download_recording',
  ];
  const out: Partial<Record<Permission, DataScope>> = {};
  for (const p of all) {
    const s = await effectiveScope(user, p);
    if (s) out[p] = s;
  }
  return out;
}

/** Papel derivado só do perfil do Helena (sem platform_role/override). */
export function roleFromProfile(profile?: string | null): Role {
  const p = (profile ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (p === 'SUPERADMIN' || p === 'SUPERADMINISTRADOR' || p === 'SUPERADMINISTRATOR' || p === 'OWNER') return 'COMPANY_ADMIN';
  if (p === 'ADMIN' || p === 'ADMINISTRADOR' || p === 'ADMINISTRATOR') return 'COMPANY_VIEWER';
  return 'AGENT';
}

/** Resolve o papel efetivo: platform_role > role_override > derivado do perfil Helena. */
export async function resolveScope(id: HelenaIdentity): Promise<Scope> {
  const departmentIds = Array.isArray(id.departments)
    ? (id.departments as any[]).map((d) => d?.departmentId).filter(Boolean)
    : [];

  const platform = await prisma.platformRole.findFirst({ where: { helenaUserId: id.userId } });
  if (platform?.role === 'SUPER_ADMIN') {
    return { role: 'SUPER_ADMIN', userId: id.userId, companyId: id.companyId, partnerId: null, departmentIds };
  }
  if (platform?.role === 'PARTNER_ADMIN') {
    return { role: 'PARTNER_ADMIN', userId: id.userId, companyId: id.companyId, partnerId: platform.partnerId, departmentIds };
  }

  const override = await prisma.roleOverride.findUnique({
    where: { companyId_helenaUserId: { companyId: id.companyId, helenaUserId: id.userId } },
  });
  if (override) {
    return { role: override.role as Role, userId: id.userId, companyId: id.companyId, departmentIds };
  }

  return { role: roleFromProfile(id.profile), userId: id.userId, companyId: id.companyId, departmentIds };
}
