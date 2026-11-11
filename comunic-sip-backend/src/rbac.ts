// Resolução de papel/escopo e matriz de permissões (RBAC multinível).
// Ver claude/painel-gestao-rbac.md.
import { prisma } from './db.js';
import type { HelenaIdentity } from './helena.js';

export type Role = 'SUPER_ADMIN' | 'PARTNER_ADMIN' | 'COMPANY_ADMIN' | 'SUPERVISOR' | 'AGENT';

export interface Scope {
  role: Role;
  userId: string;
  companyId: string;
  partnerId?: string | null;
  departmentIds: string[];
}

export type Permission =
  | 'provision_company' | 'manage_pbx' | 'manage_branding' | 'manage_extensions'
  | 'view_dashboard' | 'view_cdr' | 'export_cdr' | 'play_recording' | 'manage_roles';

export type DataScope = 'all' | 'partner' | 'company' | 'department' | 'self';

const MATRIX: Record<Role, Partial<Record<Permission, DataScope>>> = {
  SUPER_ADMIN: {
    provision_company: 'all', manage_pbx: 'all', manage_branding: 'all', manage_extensions: 'all',
    view_dashboard: 'all', view_cdr: 'all', export_cdr: 'all', play_recording: 'all', manage_roles: 'all',
  },
  PARTNER_ADMIN: {
    provision_company: 'partner', manage_branding: 'partner', manage_extensions: 'partner',
    view_dashboard: 'partner', view_cdr: 'partner', export_cdr: 'partner', play_recording: 'partner', manage_roles: 'partner',
  },
  COMPANY_ADMIN: {
    manage_extensions: 'company', view_dashboard: 'company', view_cdr: 'company', export_cdr: 'company', play_recording: 'company',
  },
  SUPERVISOR: {
    view_dashboard: 'department', view_cdr: 'department', play_recording: 'department',
  },
  AGENT: {
    view_dashboard: 'self', view_cdr: 'self', play_recording: 'self',
  },
};

export function permissionScope(role: Role, perm: Permission): DataScope | null {
  return MATRIX[role]?.[perm] ?? null;
}

export function can(role: Role, perm: Permission): boolean {
  return permissionScope(role, perm) !== null;
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

  const profile = (id.profile ?? '').toUpperCase();
  const role: Role = profile.includes('ADMIN') ? 'COMPANY_ADMIN' : 'AGENT';
  return { role, userId: id.userId, companyId: id.companyId, departmentIds };
}
