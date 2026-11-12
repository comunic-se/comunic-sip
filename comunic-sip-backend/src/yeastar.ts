// Emissão da assinatura (sign) do Linkus SDK. Recebe as credenciais do PBX do
// tenant (decifradas pelo chamador). Os segredos ficam só no backend/banco.
//
// IMPORTANTE (Yeastar): no máximo 8 access tokens válidos por aplicação.
// access_token vale 30 min e refresh_token 24 h. Por isso o token é CACHEADO
// por PBX e renovado com refresh_token — nunca pedimos get_token a cada login.

export interface PbxCreds {
  baseUrl: string;
  accessId: string;
  accessKey: string;
}

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Comunic.SIP-backend/0.1', // obrigatório: sem User-Agent o PBX não responde
};

interface TokenEntry { access: string; accessExp: number; refresh?: string; refreshExp: number }
const cache = new Map<string, TokenEntry>();
const MARGIN_MS = 60_000; // renova 1 min antes de expirar

function key(pbx: PbxCreds): string { return `${pbx.baseUrl}|${pbx.accessId}`; }

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function store(pbx: PbxCreds, j: any): string {
  const access = j?.access_token ?? j?.data?.access_token;
  if (!access) return '';
  const now = Date.now();
  const accessTtl = Number(j?.access_token_expire_time ?? 1800) * 1000;
  const refreshTtl = Number(j?.refresh_token_expire_time ?? 86400) * 1000;
  cache.set(key(pbx), {
    access,
    accessExp: now + accessTtl,
    refresh: j?.refresh_token ?? j?.data?.refresh_token,
    refreshExp: now + refreshTtl,
  });
  return access as string;
}

async function newToken(pbx: PbxCreds): Promise<string> {
  const res = await fetch(`${pbx.baseUrl}/openapi/v1.0/get_token`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ username: pbx.accessId, password: pbx.accessKey }),
  });
  const text = await res.text();
  const token = store(pbx, safeJson(text));
  if (!token) throw new Error(`get_token sem access_token (HTTP ${res.status}): ${text}`);
  return token;
}

async function refreshToken(pbx: PbxCreds, refresh: string): Promise<string> {
  const res = await fetch(`${pbx.baseUrl}/openapi/v1.0/refresh_token`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ refresh_token: refresh }),
  });
  return store(pbx, safeJson(await res.text()));
}

/** Token válido do cache; renova por refresh_token ou, em último caso, get_token. */
export async function getToken(pbx: PbxCreds, force = false): Promise<string> {
  const e = cache.get(key(pbx));
  const now = Date.now();
  if (!force && e && now < e.accessExp - MARGIN_MS) return e.access;
  if (e?.refresh && now < e.refreshExp - MARGIN_MS) {
    const t = await refreshToken(pbx, e.refresh).catch(() => '');
    if (t) return t;
  }
  cache.delete(key(pbx));
  return newToken(pbx);
}

/** Testa as credenciais do PBX pedindo um token novo. Não lança. */
export async function checkPbx(pbx: PbxCreds): Promise<boolean> {
  try {
    return Boolean(await getToken(pbx, true));
  } catch {
    return false;
  }
}

async function signOnce(pbx: PbxCreds, token: string, extension: string, expireTime: number): Promise<{ sign?: string; text: string; status: number }> {
  const res = await fetch(
    `${pbx.baseUrl}/openapi/v1.0/sign/create?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: HEADERS, body: JSON.stringify({ username: extension, sign_type: 'sdk', expire_time: expireTime }) },
  );
  const text = await res.text();
  const json = safeJson(text);
  return { sign: json?.data?.sign ?? json?.sign, text, status: res.status };
}

/**
 * Gera a assinatura do Linkus SDK para o ramal.
 * @param expireTime instante de expiração em epoch (segundos). Obrigatório:
 *   0 criaria uma assinatura que nunca expira — não usar.
 */
export async function createSignature(pbx: PbxCreds, extension: string, expireTime: number): Promise<string> {
  if (!Number.isFinite(expireTime) || expireTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('expireTime precisa ser um instante futuro (epoch em segundos)');
  }
  let r = await signOnce(pbx, await getToken(pbx), extension, expireTime);
  if (!r.sign) {
    // token pode ter sido revogado/expirado no PBX: força um novo e tenta uma vez.
    r = await signOnce(pbx, await getToken(pbx, true), extension, expireTime);
  }
  if (!r.sign) throw new Error(`sign/create sem sign (HTTP ${r.status}): ${r.text}`);
  return r.sign;
}


/**
 * GET na OpenAPI do PBX (ex.: 'v1.0/cdr/list'). Usa o token em cache e, se o PBX
 * disser que o token expirou/é inválido, pede outro uma vez. Lança em erro.
 */
export async function openapiGet(pbx: PbxCreds, path: string, query: Record<string, string | number> = {}): Promise<any> {
  const call = async (token: string) => {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])), access_token: token });
    const res = await fetch(`${pbx.baseUrl}/openapi/${path}?${qs}`, { headers: HEADERS });
    const text = await res.text();
    return { status: res.status, json: safeJson(text), text };
  };
  let r = await call(await getToken(pbx));
  if (r.json && r.json.errcode && r.json.errcode !== 0) {
    r = await call(await getToken(pbx, true)); // token expirado/revogado: tenta uma vez com token novo
  }
  if (!r.json || r.json.errcode !== 0) {
    throw new Error(`OpenAPI ${path}: ${r.json?.errmsg ?? 'HTTP ' + r.status} (errcode ${r.json?.errcode ?? '?'})`);
  }
  return r.json;
}
