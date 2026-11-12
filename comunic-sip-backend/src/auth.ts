// Autenticação SSO via Helena + JWT do painel + preHandler de permissão.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { config } from './config.js';
import { prisma } from './db.js';
import { validateHelenaToken, type HelenaIdentity } from './helena.js';
import { resolveScope, effectiveScope, type Permission, type Scope } from './rbac.js';

export interface PanelToken {
  userId: string;
  companyId: string;
  partnerId?: string | null;
  role: Scope['role'];
  deptIds: string[];
  /** Sessão do acesso de emergência (senha + TOTP). */
  emergency?: boolean;
}

interface CompanyLite {
  id: string;
  name: string;
  pbxId: string;
  partnerId: string | null;
  active: boolean;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, { secret: config.extensionJwtSecret || 'dev-inseguro-troque-me' });
}

/**
 * Valida o token do Comunic Chat, aplica o gate de provisionamento (empresa
 * existe e ativa), resolve o escopo e emite o JWT do painel. Lança { code, msg }.
 */
export async function openSession(
  helenaToken: string,
  signJwt: (p: PanelToken) => string,
): Promise<{ scope: Scope; company: CompanyLite; identity: HelenaIdentity; token: string }> {
  const id = await validateHelenaToken(helenaToken);
  if (!id) throw { code: 401, msg: 'token do Comunic Chat inválido' };

  const company = await prisma.company.findUnique({ where: { id: id.companyId } });
  if (!company || !company.active) throw { code: 403, msg: 'empresa não habilitada no Comunic.SIP' };

  const scope = await resolveScope(id);
  const token = signJwt({
    userId: scope.userId,
    companyId: scope.companyId,
    partnerId: scope.partnerId ?? null,
    role: scope.role,
    deptIds: scope.departmentIds,
  });
  return { scope, company, identity: id, token };
}

/** preHandler: exige JWT válido e, opcionalmente, uma permissão. */
export function requireAuth(perm?: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'não autenticado' });
    }
    const u = req.user as PanelToken;
    // O JWT vale 12 h, mas o que ele afirma é revalidado no banco a cada pedido:
    // papel removido, empresa desativada ou conta de emergência desativada
    // derrubam a sessão na hora (sem esperar o token expirar).
    const stale = await sessionRevoked(u);
    if (stale) return reply.code(401).send({ error: stale });
    // Papel + concessões explícitas (consultadas no banco a cada pedido).
    if (perm && !(await effectiveScope(u, perm))) {
      return reply.code(403).send({ error: 'você não tem permissão para esta ação' });
    }
  };
}

/** Devolve o motivo se a sessão não vale mais (null = ok). */
async function sessionRevoked(u: PanelToken): Promise<string | null> {
  if (u.emergency) {
    const username = u.userId.replace(/^emergency:/, '');
    const acc = await prisma.emergencyAdmin.findUnique({ where: { username } });
    return !acc || acc.disabled ? 'conta de emergência desativada' : null;
  }
  if (u.role === 'SUPER_ADMIN' || u.role === 'PARTNER_ADMIN') {
    const pr = await prisma.platformRole.findFirst({ where: { helenaUserId: u.userId, role: u.role } });
    if (!pr) return 'seu papel mudou; entre de novo';
  }
  const company = await prisma.company.findUnique({ where: { id: u.companyId }, select: { active: true } });
  return company?.active ? null : 'empresa não habilitada no Comunic.SIP';
}
