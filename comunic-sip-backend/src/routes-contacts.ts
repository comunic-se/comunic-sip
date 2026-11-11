// Contatos via backend: usa o token PERMANENTE da empresa (não expira) e é
// server-to-server. Autenticado pelo JWT do painel/extensão. NUNCA remove.
import type { FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { requireAuth, type PanelToken } from './auth.js';
import { filterContacts, createContact, updateContact, type ContactRec } from './helena-admin.js';

async function companyToken(companyId: string): Promise<string | null> {
  const c = await prisma.company.findUnique({ where: { id: companyId } });
  if (!c?.helenaApiTokenEnc) return null;
  return decryptSecret(c.helenaApiTokenEnc);
}

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/contacts', { preHandler: requireAuth() }, async (req, reply) => {
    const u = req.user as PanelToken;
    const tok = await companyToken(u.companyId);
    if (!tok) return reply.code(400).send({ error: 'token da API Helena não configurado para esta empresa' });
    try {
      return { items: await filterContacts(tok, String((req.query as any).query ?? '')) };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: 'falha ao buscar contatos' });
    }
  });

  app.post('/v1/contacts', { preHandler: requireAuth() }, async (req, reply) => {
    const u = req.user as PanelToken;
    const tok = await companyToken(u.companyId);
    if (!tok) return reply.code(400).send({ error: 'token da API Helena não configurado' });
    const b = (req.body ?? {}) as ContactRec;
    if (!b.name || !b.phoneNumber) return reply.code(400).send({ error: 'nome e telefone são obrigatórios' });
    try {
      return { ok: true, contact: await createContact(tok, b) };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: 'falha ao criar contato' });
    }
  });

  app.put('/v1/contacts/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const u = req.user as PanelToken;
    const tok = await companyToken(u.companyId);
    if (!tok) return reply.code(400).send({ error: 'token da API Helena não configurado' });
    const id = String((req.params as any).id);
    try {
      return { ok: true, contact: await updateContact(tok, id, (req.body ?? {}) as ContactRec) };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: 'falha ao atualizar contato' });
    }
  });
}
