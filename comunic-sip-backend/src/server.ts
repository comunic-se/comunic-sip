import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config, assertConfig } from './config.js';
import { createSignature } from './yeastar.js';
import { validateHelenaToken } from './helena.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true, pbx: config.pbxBaseUrl }));

// Gera a assinatura do SDK para um ramal. Substitui o script manual.
app.post('/v1/sip/signature', async (req, reply) => {
  const { extension } = (req.body ?? {}) as { extension?: string };
  const ext = extension || config.defaultExtension;
  if (!ext) return reply.code(400).send({ error: 'extension é obrigatório' });
  try {
    const sign = await createSignature(ext);
    return { extension: ext, pbxUrl: config.pbxBaseUrl, sign };
  } catch (e: any) {
    req.log.error(e);
    return reply.code(502).send({ error: String(e?.message ?? e) });
  }
});

// Login integrado: valida o token da sessão do Comunic Chat e devolve a
// configuração do ramal vinculado (ramal + assinatura + PBX).
app.post('/v1/auth/extension', async (req, reply) => {
  const { helenaToken } = (req.body ?? {}) as { helenaToken?: string };
  if (!helenaToken) return reply.code(400).send({ error: 'helenaToken é obrigatório' });

  const id = await validateHelenaToken(helenaToken);
  if (!id) return reply.code(401).send({ error: 'token do Comunic Chat inválido' });

  const ext = config.extensionMap[id.userId] || config.defaultExtension;
  if (!ext) return reply.code(404).send({ error: 'nenhum ramal vinculado a este usuário' });

  try {
    const sign = await createSignature(ext);
    return {
      user: { userId: id.userId, companyId: id.companyId, name: id.name },
      extension: ext,
      pbxUrl: config.pbxBaseUrl,
      sign,
    };
  } catch (e: any) {
    req.log.error(e);
    return reply.code(502).send({ error: String(e?.message ?? e) });
  }
});

assertConfig();
app.listen({ port: config.port, host: '127.0.0.1' })
  .then(() => app.log.info(`Comunic.SIP backend em http://127.0.0.1:${config.port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
