import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  trustProxy: (process.env.TRUST_PROXY ?? 'false').toLowerCase() === 'true',
  helenaBase: (process.env.HELENA_BASE ?? 'https://api.wts.chat').replace(/\/+$/, ''),
  extensionJwtSecret: process.env.EXTENSION_JWT_SECRET ?? '',
  // Validade da assinatura do Linkus SDK, em segundos (padrão 12 h, igual ao JWT).
  // Mínimo de 30 min: a extensão renova 15 min antes de vencer.
  signTtlSeconds: Math.max(1800, Number(process.env.SIGN_TTL_SECONDS ?? 43200) || 43200),
  // Origens permitidas no CORS (ex.: chrome-extension://<id>). Vazio = nega cross-origin.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export function assertConfig(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!config.extensionJwtSecret) missing.push('EXTENSION_JWT_SECRET');
  if (missing.length) {
    console.warn(`[config] Faltando no .env: ${missing.join(', ')} — auth/segredos vão falhar.`);
  }
}
