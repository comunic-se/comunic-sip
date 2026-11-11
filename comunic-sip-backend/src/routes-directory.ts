// Diretório de ramais da empresa (usado na transferência da extensão).
// Fonte: vínculos atendente → ramal do Comunic.SIP + nomes vindos do Helena.
// Qualquer usuário autenticado vê só a própria empresa.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { requireAuth, type PanelToken } from './auth.js';
import { listAgents, type HelenaAgent } from './helena-admin.js';

const TTL_MS = 5 * 60_000; // nomes mudam pouco: evita bater no Helena a cada transferência
const agentCache = new Map<string, { at: number; agents: HelenaAgent[] }>();

async function agentsOf(companyId: string, tokenEnc: string): Promise<HelenaAgent[]> {
  const hit = agentCache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.agents;
  const agents = await listAgents(decryptSecret(tokenEnc));
  agentCache.set(companyId, { at: Date.now(), agents });
  return agents;
}

export async function registerDirectoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/directory', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as PanelToken;
    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) return reply.code(404).send({ error: 'empresa não encontrada' });

    const links = await prisma.extensionLink.findMany({ where: { companyId: company.id } });
    let names = new Map<string, { name?: string; email?: string }>();
    if (company.helenaApiTokenEnc) {
      try {
        const agents = await agentsOf(company.id, company.helenaApiTokenEnc);
        names = new Map(agents.map((a) => [a.userId, { name: a.name, email: a.email }]));
      } catch (e) {
        req.log.warn(e, 'diretório: falha ao buscar nomes no Helena; seguindo só com ramais');
      }
    }
    const items = links
      .map((l) => ({
        extension: l.extensionNumber,
        name: names.get(l.helenaUserId)?.name || `Ramal ${l.extensionNumber}`,
        me: l.helenaUserId === user.userId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return { items };
  });
}
