// Limite de requisições (anti-abuso). Chave:
//   - com sessão (Authorization: Bearer) -> por usuário/sessão
//   - com helenaToken no corpo (login)    -> por sessão do Comunic Chat
//   - sem nada                             -> por IP
// Por usuário e não só por IP porque, num escritório, dezenas de atendentes saem
// pelo MESMO IP; um limite por IP bloquearia gente legítima.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash } from 'node:crypto';

const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

export function rateKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return `s:${h(auth.slice(7))}`;
  const t = (req.body as any)?.helenaToken;
  if (typeof t === 'string' && t) return `t:${h(t)}`;
  return `ip:${req.ip}`;
}

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',                 // depois do parse do corpo (precisa do helenaToken)
    max: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    timeWindow: '1 minute',
    keyGenerator: rateKey,
    allowList: (req) => req.url === '/health',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: `muitas requisições; tente de novo em ${Math.ceil(ctx.ttl / 1000)} s`,
    }),
  });
}

/** Limites mais apertados para rotas sensíveis (por minuto). */
export const LIMITS = {
  login: { rateLimit: { max: 20, timeWindow: '1 minute' } },          // login integrado / sessão do painel
  emergency: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (r: FastifyRequest) => `ip:${r.ip}` } },
  presence: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  export: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  sync: { rateLimit: { max: 6, timeWindow: '1 minute' } },
};
