// Salva (cifrado) o token PERMANENTE da API Helena de uma empresa.
// Uso: node scripts/set-helena-token.mjs <companyId> <token pn_...>
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
function enc(plain) {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY inválida (32 bytes base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const t = c.getAuthTag();
  return [iv, t, e].map((b) => b.toString('base64')).join('.');
}

const [, , companyId, token] = process.argv;
if (!companyId || !token) {
  console.error('uso: node scripts/set-helena-token.mjs <companyId> <token pn_...>');
  process.exit(1);
}
await prisma.company.update({ where: { id: companyId }, data: { helenaApiTokenEnc: enc(token) } });
console.log('Token da API Helena salvo (cifrado) para a empresa', companyId);
await prisma.$disconnect();
