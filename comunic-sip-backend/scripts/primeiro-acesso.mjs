// PRIMEIRO ACESSO em um banco novo (produção): cadastra o PBX e a empresa Comunic.se
// para que a conta de emergência e o painel tenham onde se apoiar. Depois disso,
// todo o resto (outras empresas, faixas, vínculos, Client ID/Secret) é feito pelo painel.
//
//   docker compose exec api node scripts/primeiro-acesso.mjs
//
// - Pede os segredos SEM ECO: nada vai para o histórico do shell nem para o .env.
// - Testa as credenciais do Linkus SDK no PBX antes de gravar.
// - Grava tudo cifrado com a ENCRYPTION_KEY. Idempotente: rodar de novo atualiza.
// - Não concede papéis de plataforma (mínimo privilégio).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';
import readline from 'node:readline';

const prisma = new PrismaClient();
const PBX_ID = 'pbx-comunic';
const COMPANY_ID = 'f0c2a7d8-9e22-42f5-8c39-19ff41688409'; // id da Comunic.se no Comunic Chat
const PARTNER_ID = '288a453c-aea3-4a13-8207-53c106d7c343';
const RANGE = ['4000', '4099'];
const HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'OpenAPI' };

function enc(plain) {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY inválida (32 bytes base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), e].map((b) => b.toString('base64')).join('.');
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

async function testOpenApi(baseUrl, username, password, label) {
  try {
    const res = await fetch(`${baseUrl}/openapi/v1.0/get_token`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ username, password }) });
    const j = await res.json().catch(() => ({}));
    if (j.access_token) {
      await fetch(`${baseUrl}/openapi/v1.0/del_token?access_token=${encodeURIComponent(j.access_token)}`, { headers: HEADERS }).catch(() => {});
      console.log(`  ✔ ${label}: credenciais aceitas pelo PBX`);
      return true;
    }
    console.log(`  ✘ ${label}: PBX recusou (errcode ${j.errcode ?? res.status} ${j.errmsg ?? ''})`);
  } catch (e) {
    console.log(`  ✘ ${label}: não consegui falar com o PBX (${e.cause?.code ?? e.message})`);
  }
  return false;
}

try {
  if (!process.stdin.isTTY) throw new Error('rode em terminal interativo: docker compose exec api node scripts/primeiro-acesso.mjs');
  const atual = await prisma.pbx.findUnique({ where: { id: PBX_ID } });
  console.log(atual ? `PBX já cadastrado (${atual.baseUrl}). Os dados digitados vão SUBSTITUIR os atuais.\n` : 'Banco novo: vamos cadastrar o PBX e a Comunic.se.\n');

  const baseUrl = (await ask(`URL do PBX [${atual?.baseUrl ?? 'https://comunic.ras.yeastar.com'}]: `) || atual?.baseUrl || 'https://comunic.ras.yeastar.com').replace(/\/+$/, '');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('a URL do PBX precisa começar com https://');

  console.log('\nLinkus SDK (PBX > Integrations > Linkus SDK):');
  const sdkId = await ask('  AccessID: ');
  const sdkKey = await ask('  AccessKey (não aparece): ', true);
  if (!sdkId || !sdkKey) throw new Error('AccessID e AccessKey são obrigatórios');
  if (!(await testOpenApi(baseUrl, sdkId, sdkKey, 'Linkus SDK'))) throw new Error('corrija as credenciais do SDK (ou a IP Restriction do PBX) e rode de novo. Nada foi gravado.');

  console.log('\nAPI do PBX para chamadas/gravações (Integrations > API). Enter para pular e cadastrar depois no painel:');
  const apiId = await ask('  Client ID: ');
  let apiSecret = '';
  if (apiId) {
    apiSecret = await ask('  Client Secret (não aparece): ', true);
    if (!(await testOpenApi(baseUrl, apiId, apiSecret, 'API'))) throw new Error('corrija o Client ID/Secret (ou deixe em branco) e rode de novo. Nada foi gravado.');
  }

  console.log('\nToken PERMANENTE da API do Comunic Chat da Comunic.se (pn_...). Enter para pular e colar depois no painel:');
  const helena = await ask('  Token (não aparece): ', true);

  const pbxData = {
    name: 'PBX Comunic', baseUrl, sdkAccessId: sdkId, sdkAccessKeyEnc: enc(sdkKey),
    ...(apiId ? { clientIdEnc: enc(apiId), clientSecretEnc: enc(apiSecret), cdrSyncError: null } : {}),
  };
  await prisma.pbx.upsert({ where: { id: PBX_ID }, update: pbxData, create: { id: PBX_ID, ...pbxData } });
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: { active: true, pbxId: PBX_ID, ...(helena ? { helenaApiTokenEnc: enc(helena) } : {}) },
    create: { id: COMPANY_ID, name: 'Comunic.se', pbxId: PBX_ID, partnerId: PARTNER_ID, active: true, ...(helena ? { helenaApiTokenEnc: enc(helena) } : {}) },
  });
  if (!(await prisma.extensionRange.findFirst({ where: { companyId: COMPANY_ID } }))) {
    await prisma.extensionRange.create({ data: { companyId: COMPANY_ID, fromExt: RANGE[0], toExt: RANGE[1] } });
  }
  await prisma.auditLog.create({ data: { actor: 'script', action: 'bootstrap', companyId: COMPANY_ID, payload: { pbx: baseUrl, api: Boolean(apiId), helenaToken: Boolean(helena) } } });

  console.log(`\nPronto: PBX + Comunic.se (empresa ${COMPANY_ID}), faixa ${RANGE[0]}–${RANGE[1]}.`);
  console.log(`Próximo: docker compose exec api node scripts/admin-emergencia.mjs criar <usuario> ${COMPANY_ID}`);
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
