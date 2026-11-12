// Consultas administrativas na Helena usando o token PERMANENTE da empresa
// (pn_...). Diferente do helena.ts, que valida a sessão do usuário (agent/me).
import { config } from './config.js';
import { decryptSecret } from './crypto.js';

export interface HelenaAgent {
  userId: string;
  name?: string;
  email?: string;
  profile?: string;
  departments: { departmentId: string; isAgent?: boolean; isSupervisor?: boolean }[];
}

/** Confere se o token permanente funciona (lista 1 agente). Não lança. */
export async function checkHelenaToken(companyApiToken: string): Promise<boolean> {
  try {
    const res = await hfetch(`${config.helenaBase}/core/v1/agent?pageNumber=1&pageSize=1`, {
      headers: { Authorization: `Bearer ${companyApiToken}`, 'Content-Type': 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Lista os agentes/usuários da empresa (paginado). */
export async function listAgents(companyApiToken: string): Promise<HelenaAgent[]> {
  const out: HelenaAgent[] = [];
  let page = 1;
  for (;;) {
    const res = await hfetch(`${config.helenaBase}/core/v1/agent?pageNumber=${page}&pageSize=100`, {
      headers: { Authorization: `Bearer ${companyApiToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`GET /v1/agent falhou (HTTP ${res.status})`);
    const j: any = await res.json().catch(() => null);
    const items: any[] = j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);
    for (const a of items) {
      out.push({
        userId: a.userId ?? a.id,
        name: a.name,
        email: a.email,
        profile: a.profile,
        departments: Array.isArray(a.departments) ? a.departments : [],
      });
    }
    const hasMore = j?.hasMorePages ?? (j?.totalPages ? page < j.totalPages : false);
    if (!hasMore || items.length === 0) break;
    page += 1;
    if (page > 50) break; // trava de segurança
  }
  return out;
}


/** Formato esperado pela Helena: DDI+DDD+número (ex.: 5511999999999). */
export function normalizePhone(p?: string): string | undefined {
  if (!p) return undefined;
  const raw = p.includes('|') ? (p.split('|').pop() || '') : p;
  const d = raw.replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

/** fetch com retry/backoff em 429 (rate limit Helena: 1.000 req / 5 min por conta). */
async function hfetch(url: string, init: RequestInit): Promise<Response> {
  const waits = [500, 1000, 2000];
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429 || i >= waits.length) return res;
    await new Promise((r) => setTimeout(r, waits[i]));
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export interface ContactRec {
  id?: string;
  name?: string;
  phoneNumber?: string;
  phoneNumberFormatted?: string;
  email?: string;
  annotation?: string;
}

/** Busca contatos (por nome, ou por telefone se a query tiver dígitos). */
export async function filterContacts(token: string, query: string): Promise<ContactRec[]> {
  const q = (query || '').trim();
  const body: any = { pageNumber: 1, pageSize: 30 };
  if (q) {
    if (/\d/.test(q)) body.phoneNumber = q.replace(/\D/g, '');
    else body.name = q;
  }
  const res = await hfetch(`${config.helenaBase}/core/v1/contact/filter`, {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`contact/filter ${res.status}`);
  const j: any = await res.json().catch(() => null);
  const items: any[] = j?.items ?? [];
  return items.map((c) => ({
    id: c.id, name: c.name, phoneNumber: c.phoneNumber,
    phoneNumberFormatted: c.phoneNumberFormatted, email: c.email,
  }));
}

export async function createContact(token: string, c: ContactRec): Promise<any> {
  const res = await hfetch(`${config.helenaBase}/core/v1/contact`, {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ name: c.name, phoneNumber: normalizePhone(c.phoneNumber), email: c.email, options: { upsert: true, getIfExists: true } }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`contact create ${res.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

export async function updateContact(token: string, id: string, c: ContactRec): Promise<any> {
  const res = await hfetch(`${config.helenaBase}/core/v2/contact/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: authHeaders(token),
    body: JSON.stringify({ name: c.name, phoneNumber: normalizePhone(c.phoneNumber), email: c.email, fields: ['Name', 'PhoneNumber', 'Email'] }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`contact update ${res.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}


// Cache curto dos agentes por empresa (nomes/perfis mudam pouco): evita bater no
// Helena a cada abertura de tela. Usado no diretório e no módulo Acessos.
const AGENTS_TTL_MS = 5 * 60_000;
const agentCache = new Map<string, { at: number; agents: HelenaAgent[] }>();

export async function listAgentsCached(companyId: string, tokenEnc: string, fresh = false): Promise<HelenaAgent[]> {
  const hit = agentCache.get(companyId);
  if (!fresh && hit && Date.now() - hit.at < AGENTS_TTL_MS) return hit.agents;
  const agents = await listAgents(decryptSecret(tokenEnc));
  agentCache.set(companyId, { at: Date.now(), agents });
  return agents;
}
