// Gera a assinatura (sign) do Linkus SDK para um ramal do Yeastar.
//
// Uso:
//   node gerar-assinatura.mjs <pbxURL> <accessID> <accessKey> <ramal> [expireTime]
//
// Exemplo:
//   node gerar-assinatura.mjs https://pbx.cliente.com.br:443 AbC123 xYz789 201
//
// expireTime: timestamp Unix (segundos) de expiração. 0 ou vazio = sem limite.
//
// Requer Node 18+ (fetch nativo). O PBX precisa de HTTPS com certificado válido;
// se o certificado for autoassinado (teste local), rode com:
//   $env:NODE_TLS_REJECT_UNAUTHORIZED=0 ; node gerar-assinatura.mjs ...

const [, , pbxURL, accessID, accessKey, ramal, expireArg] = process.argv;

if (!pbxURL || !accessID || !accessKey || !ramal) {
  console.error('Uso: node gerar-assinatura.mjs <pbxURL> <accessID> <accessKey> <ramal> [expireTime]');
  process.exit(1);
}

const base = pbxURL.replace(/\/+$/, '');
const headers = {
  'Content-Type': 'application/json',
  // O Yeastar exige um User-Agent em toda requisição.
  'User-Agent': 'Comunic.SIP/0.1 (gerador-de-assinatura)',
};

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} em ${path}: ${text}`);
  }
  return json;
}

try {
  // 1) Token a partir do AccessID/AccessKey do Linkus SDK.
  const tokenResp = await post('/openapi/v1.0/get_token', {
    username: accessID,
    password: accessKey,
  });

  const accessToken = tokenResp.access_token ?? tokenResp.data?.access_token;
  if (!accessToken) {
    throw new Error(`Não veio access_token. Resposta: ${JSON.stringify(tokenResp)}`);
  }
  console.log('Token obtido.');

  // 2) Assinatura do ramal (sign_type: sdk).
  const expireTime = expireArg ? Number(expireArg) : 0;
  const signResp = await post(
    `/openapi/v1.0/sign/create?access_token=${encodeURIComponent(accessToken)}`,
    { username: ramal, sign_type: 'sdk', expire_time: expireTime },
  );

  const sign = signResp.data?.sign ?? signResp.sign;
  if (!sign) {
    throw new Error(`Não veio a assinatura. Resposta: ${JSON.stringify(signResp)}`);
  }

  console.log('\n=== Assinatura (cole nos Ajustes do ramal na extensão) ===\n');
  console.log(sign);
  console.log('\nRamal:', ramal, '| expire_time:', expireTime || '0 (sem limite)');
} catch (err) {
  console.error('\nFalhou:', err.message);
  process.exit(1);
}
