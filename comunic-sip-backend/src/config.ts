import 'dotenv/config';

function parseMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn('[config] EXTENSION_MAP inválido; ignorando.');
    return {};
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  pbxBaseUrl: (process.env.PBX_BASE_URL ?? '').replace(/\/+$/, ''),
  sdkAccessId: process.env.SDK_ACCESS_ID ?? '',
  sdkAccessKey: process.env.SDK_ACCESS_KEY ?? '',
  helenaBase: (process.env.HELENA_BASE ?? 'https://api.wts.chat').replace(/\/+$/, ''),
  defaultExtension: process.env.DEFAULT_EXTENSION ?? '',
  extensionMap: parseMap(process.env.EXTENSION_MAP),
};

export function assertConfig(): void {
  const missing: string[] = [];
  if (!config.pbxBaseUrl) missing.push('PBX_BASE_URL');
  if (!config.sdkAccessId) missing.push('SDK_ACCESS_ID');
  if (!config.sdkAccessKey) missing.push('SDK_ACCESS_KEY');
  if (missing.length) {
    console.warn(`[config] Faltando no .env: ${missing.join(', ')} — endpoints de assinatura vão falhar.`);
  }
}
