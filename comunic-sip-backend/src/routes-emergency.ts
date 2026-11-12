// Login de emergência do painel (SUPER_ADMIN): usuário + senha + código TOTP.
// Para quando o Comunic Chat ou a extensão estiverem fora. Contas criadas só
// por script no servidor (scripts/criar-admin-emergencia.mjs).
//
// Proteções: erro genérico; bloqueio da conta após 5 falhas (15 min); limite por
// IP (10 tentativas / 15 min); código TOTP não pode ser reutilizado; sessão de 1 h;
// toda tentativa vai para o audit_log.
import type { FastifyInstance } from 'fastify';
import { verify as verifyPassword, hash as hashPassword } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { verifyTotp } from './totp.js';
import type { PanelToken } from './auth.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX = 10;
const SESSION = '1h';
const GENERIC = 'usuário, senha ou código inválidos';

// Hash de uma senha aleatória: gasta o mesmo tempo quando o usuário não existe
// (evita descobrir usuários válidos pelo tempo de resposta).
const dummyHash = hashPassword(randomBytes(24).toString('hex'));

const ipHits = new Map<string, number[]>();
function ipLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > IP_MAX;
}

export async function registerEmergencyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/panel/emergency-login', async (req, reply) => {
    const ip = req.ip;
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown; code?: unknown };
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const code = typeof b.code === 'string' ? b.code.replace(/\s+/g, '') : '';

    const log = (action: string, extra: object = {}) =>
      prisma.auditLog.create({ data: { companyId: null, actor: `emergency:${username || '?'}`, action, payload: { ip, ...extra } } });

    if (ipLimited(ip)) {
      await log('emergency_login_ratelimited');
      return reply.code(429).send({ error: 'muitas tentativas; aguarde 15 minutos' });
    }
    if (!username || !password || !code) return reply.code(400).send({ error: 'informe usuário, senha e código' });

    const acc = await prisma.emergencyAdmin.findUnique({ where: { username } });
    if (!acc || acc.disabled) {
      await verifyPassword(await dummyHash, password).catch(() => false);
      await log('emergency_login_fail', { reason: acc ? 'disabled' : 'unknown_user' });
      return reply.code(401).send({ error: GENERIC });
    }
    if (acc.lockedUntil && acc.lockedUntil > new Date()) {
      await log('emergency_login_fail', { reason: 'locked' });
      return reply.code(423).send({ error: 'conta bloqueada temporariamente por tentativas erradas; tente mais tarde' });
    }

    const passOk = await verifyPassword(acc.passwordHash, password).catch(() => false);
    const step = passOk ? verifyTotp(decryptSecret(acc.totpSecretEnc), code) : null;
    const reused = step !== null && acc.lastTotpStep !== null && step <= acc.lastTotpStep;

    if (!passOk || step === null || reused) {
      const fails = acc.failedCount + 1;
      await prisma.emergencyAdmin.update({
        where: { id: acc.id },
        data: { failedCount: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MS) : null },
      });
      await log('emergency_login_fail', { reason: !passOk ? 'password' : reused ? 'code_reused' : 'code', fails });
      return reply.code(401).send({ error: GENERIC });
    }

    await prisma.emergencyAdmin.update({
      where: { id: acc.id },
      data: { failedCount: 0, lockedUntil: null, lastTotpStep: step, lastLoginAt: new Date() },
    });
    const company = await prisma.company.findUnique({ where: { id: acc.companyId } });
    const payload: PanelToken & { emergency: true } = {
      userId: `emergency:${acc.username}`,
      companyId: acc.companyId,
      partnerId: null,
      role: 'SUPER_ADMIN',
      deptIds: [],
      emergency: true,
    };
    const token = app.jwt.sign(payload, { expiresIn: SESSION });
    await log('emergency_login_ok');
    return {
      token,
      role: 'SUPER_ADMIN',
      emergency: true,
      scope: { companyId: acc.companyId, partnerId: null, departmentIds: [] },
      company: { id: acc.companyId, name: company?.name ?? '—' },
    };
  });
}
