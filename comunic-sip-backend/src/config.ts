import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  trustProxy: (process.env.TRUST_PROXY ?? 'false').toLowerCase() === 'true',
  helenaBase: (process.env.HELENA_BASE ?? 'https://api.wts.chat').replace(/\/+$/, ''),
  extensionJwtSecret: process.env.EXTENSION_JWT_SECRET ?? '',
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
