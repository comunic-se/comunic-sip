import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, assertConfig } from './config.js';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { createSignature } from './yeastar.js';
import { registerAuth, openSession, requireAuth, type PanelToken } from './auth.js';
import { registerPanelRoutes } from './routes-panel.js';
import { registerContactRoutes } from './routes-contacts.js';
import { registerCompanyRoutes } from './routes-companies.js';
import { registerDirectoryRoutes } from './routes-directory.js';
import { registerEmergencyRoutes } from './routes-emergency.js';
import { registerAccessRoutes } from './routes-access.js';

const app = Fastify({ logger: true, trustProxy: config.trustProxy });

// CORS restrito: só as origens em ALLOWED_ORIGINS (vazio = nega cross-origin).
await app.register(cors, { origin: config.allowedOrigins.length ? config.allowedOrigins : false });
await registerAuth(app);
await registerPanelRoutes(app);
await registerContactRoutes(app);
await registerCompanyRoutes(app);
await registerDirectoryRoutes(app);
await registerEmergencyRoutes(app);
await registerAccessRoutes(app);

app.get('/health', async () => ({ ok: true }));

// NOTA DE SEGURANÇA: o antigo POST /v1/sip/signature (sem autenticação) foi
// REMOVIDO. A assinatura só é emitida pelo caminho autenticado + provisionado
// abaixo. Ver auditoria OWASP (OWASP-A07-001).

// Login integrado da extensão: valida a sessão do Comunic Chat, aplica o gate de
// provisionamento, acha o ramal vinculado e devolve a assinatura do SDK + token.
app.post('/v1/auth/extension', async (req, reply) => {
  const { helenaToken } = (req.body ?? {}) as { helenaToken?: string };
  if (!helenaToken) return reply.code(400).send({ error: 'helenaToken é obrigatório' });
  try {
    const { scope, company, identity, token } = await openSession(
      helenaToken,
      (p) => app.jwt.sign(p, { expiresIn: '12h' }),
    );
    const link = await prisma.extensionLink.findUnique({
      where: { companyId_helenaUserId: { companyId: scope.companyId, helenaUserId: scope.userId } },
    });
    if (!link) return reply.code(404).send({ error: 'nenhum ramal vinculado a este usuário' });

    const pbx = await prisma.pbx.findUnique({ where: { id: company.pbxId } });
    if (!pbx) return reply.code(500).send({ error: 'PBX da empresa não configurado' });

    const baseUrl = pbx.baseUrl.replace(/\/+$/, '');
    // expire_time do Yeastar é um TIMESTAMP (epoch em segundos), não uma duração.
    const signExpiresAt = Math.floor(Date.now() / 1000) + config.signTtlSeconds;
    const sign = await createSignature(
      { baseUrl, accessId: pbx.sdkAccessId, accessKey: decryptSecret(pbx.sdkAccessKeyEnc) },
      link.extensionNumber,
      signExpiresAt,
    );

    return {
      token,
      role: scope.role,
      user: { userId: scope.userId, companyId: scope.companyId, name: identity.name },
      extension: link.extensionNumber,
      pbxUrl: baseUrl,
      sign,
      signExpiresAt,
    };
  } catch (e: any) {
    if (e?.code && e?.msg) return reply.code(e.code).send({ error: e.msg });
    req.log.error(e);
    return reply.code(502).send({ error: 'falha ao gerar a assinatura' });
  }
});

// Sessão do painel: mesma validação + gate; devolve papel e escopo (sem ramal).
app.post('/v1/panel/session', async (req, reply) => {
  const { helenaToken } = (req.body ?? {}) as { helenaToken?: string };
  if (!helenaToken) return reply.code(400).send({ error: 'helenaToken é obrigatório' });
  try {
    const { scope, company, token } = await openSession(
      helenaToken,
      (p) => app.jwt.sign(p, { expiresIn: '12h' }),
    );
    return {
      token,
      role: scope.role,
      scope: { companyId: scope.companyId, partnerId: scope.partnerId, departmentIds: scope.departmentIds },
      company: { id: company.id, name: company.name },
    };
  } catch (e: any) {
    if (e?.code && e?.msg) return reply.code(e.code).send({ error: e.msg });
    req.log.error(e);
    return reply.code(500).send({ error: 'falha ao abrir a sessão' });
  }
});

// Identidade do token atual (rota protegida de exemplo; Stage 3 adiciona as reais).
app.get('/v1/me', { preHandler: requireAuth() }, async (req) => ({ user: req.user as PanelToken }));

assertConfig();
app.listen({ port: config.port, host: config.host })
  .then(() => app.log.info(`Comunic.SIP backend em http://${config.host}:${config.port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
