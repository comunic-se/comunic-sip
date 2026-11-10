// Emissão da assinatura (sign) do Linkus SDK. Os segredos (AccessID/AccessKey)
// ficam só aqui no backend; o frontend nunca os vê.
import { config } from './config.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Comunic.SIP-backend/0.1',
};

async function getToken(): Promise<string> {
  const res = await fetch(`${config.pbxBaseUrl}/openapi/v1.0/get_token`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ username: config.sdkAccessId, password: config.sdkAccessKey }),
  });
  const text = await res.text();
  const json = safeJson(text);
  const token = json?.access_token ?? json?.data?.access_token;
  if (!token) throw new Error(`get_token sem access_token (HTTP ${res.status}): ${text}`);
  return token as string;
}

export async function createSignature(extension: string, expireTime = 0): Promise<string> {
  const token = await getToken();
  const res = await fetch(
    `${config.pbxBaseUrl}/openapi/v1.0/sign/create?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username: extension, sign_type: 'sdk', expire_time: expireTime }),
    },
  );
  const text = await res.text();
  const json = safeJson(text);
  const sign = json?.data?.sign ?? json?.sign;
  if (!sign) throw new Error(`sign/create sem sign (HTTP ${res.status}): ${text}`);
  return sign as string;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}
