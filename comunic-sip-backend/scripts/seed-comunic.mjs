// Seed do piloto: registra o PBX (credenciais do .env, cifradas), provisiona a
// Comunic.se, cria a faixa de ramais, vincula o usuário ao ramal 4004 e marca
// o Pedro como SUPER_ADMIN. Idempotente. Rode: node scripts/seed-comunic.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function enc(plain) {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY inválida (precisa 32 bytes base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const t = c.getAuthTag();
  return [iv, t, e].map((b) => b.toString('base64')).join('.');
}

const COMPANY_ID = 'f0c2a7d8-9e22-42f5-8c39-19ff41688409';
const PARTNER_ID = '288a453c-aea3-4a13-8207-53c106d7c343';
const USER_ID = '140dbcf4-1703-4f69-9a91-c16f5e3b4d27';
const RAMAL = '4004';

const pbx = await prisma.pbx.upsert({
  where: { id: 'pbx-comunic' },
  update: {
    baseUrl: (process.env.PBX_BASE_URL ?? '').replace(/\/+$/, ''),
    sdkAccessId: process.env.SDK_ACCESS_ID ?? '',
    sdkAccessKeyEnc: enc(process.env.SDK_ACCESS_KEY ?? ''),
  },
  create: {
    id: 'pbx-comunic',
    name: 'PBX Comunic',
    baseUrl: (process.env.PBX_BASE_URL ?? '').replace(/\/+$/, ''),
    sdkAccessId: process.env.SDK_ACCESS_ID ?? '',
    sdkAccessKeyEnc: enc(process.env.SDK_ACCESS_KEY ?? ''),
  },
});

await prisma.company.upsert({
  where: { id: COMPANY_ID },
  update: { active: true, pbxId: pbx.id, partnerId: PARTNER_ID, name: 'Comunic.se' },
  create: { id: COMPANY_ID, name: 'Comunic.se', pbxId: pbx.id, partnerId: PARTNER_ID, active: true },
});

const hasRange = await prisma.extensionRange.findFirst({ where: { companyId: COMPANY_ID } });
if (!hasRange) {
  await prisma.extensionRange.create({ data: { companyId: COMPANY_ID, fromExt: '4000', toExt: '4099' } });
}

await prisma.extensionLink.upsert({
  where: { companyId_helenaUserId: { companyId: COMPANY_ID, helenaUserId: USER_ID } },
  update: { extensionNumber: RAMAL },
  create: { companyId: COMPANY_ID, helenaUserId: USER_ID, extensionNumber: RAMAL, createdBy: 'seed' },
});

const sa = await prisma.platformRole.findFirst({ where: { helenaUserId: USER_ID, role: 'SUPER_ADMIN' } });
if (!sa) {
  await prisma.platformRole.create({ data: { helenaUserId: USER_ID, role: 'SUPER_ADMIN', createdBy: 'seed' } });
}

console.log('Seed OK: PBX, Comunic.se (ativa), faixa 4000-4099, ramal 4004 -> Pedro, SUPER_ADMIN.');
await prisma.$disconnect();
