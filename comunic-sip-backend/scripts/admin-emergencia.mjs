// Gerencia contas de ACESSO DE EMERGÊNCIA ao painel (SUPER_ADMIN com senha + TOTP).
// Rode no servidor (ou no container: docker compose exec api node scripts/admin-emergencia.mjs ...).
//
//   criar   <usuario> <companyId>   cria a conta (pede a senha, gera o autenticador)
//   resetar <usuario>               nova senha e novo autenticador; desbloqueia
//   desativar <usuario>             bloqueia a conta (não apaga)
//   ativar  <usuario>               reativa
//   listar                          mostra contas (sem segredos)
//
// A senha é digitada sem eco e nunca aparece no histórico do shell. O segredo do
// autenticador é mostrado UMA vez: cadastre no app (Vaultwarden, Google
// Authenticator, Authy...) e guarde a senha no cofre.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { createCipheriv, randomBytes } from 'node:crypto';
import readline from 'node:readline';

const prisma = new PrismaClient();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MIN_LEN = 14;

function enc(plain) {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY inválida (32 bytes base64)');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), e].map((b) => b.toString('base64')).join('.');
}

function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Lê uma linha sem mostrar o que é digitado. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function askPassword() {
  for (;;) {
    const p1 = await askHidden('Senha (mín. ' + MIN_LEN + ' caracteres): ');
    if (p1.length < MIN_LEN) { console.log('  Muito curta.'); continue; }
    if (!/[a-z]/.test(p1) || !/[A-Z]/.test(p1) || !/\d/.test(p1)) { console.log('  Use letras maiúsculas, minúsculas e números.'); continue; }
    const p2 = await askHidden('Repita a senha: ');
    if (p1 !== p2) { console.log('  As senhas não conferem.'); continue; }
    return p1;
  }
}

function showTotp(username, secret) {
  const issuer = 'Comunic.SIP';
  const uri = `otpauth://totp/${encodeURIComponent(issuer + ':' + username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  console.log('\n=== Autenticador (mostrado só agora) ===');
  console.log('Chave (cole no app autenticador / campo TOTP do Vaultwarden):');
  console.log('  ' + secret.match(/.{1,4}/g).join(' '));
  console.log('Ou o link otpauth:');
  console.log('  ' + uri);
  console.log('=======================================\n');
}

const [, , cmd, a1, a2] = process.argv;
const username = (a1 ?? '').trim().toLowerCase();

try {
  if (cmd === 'listar') {
    const rows = await prisma.emergencyAdmin.findMany({ orderBy: { username: 'asc' } });
    if (!rows.length) console.log('Nenhuma conta de emergência.');
    for (const r of rows) {
      console.log(`${r.username}  empresa=${r.companyId}  ${r.disabled ? 'DESATIVADA' : 'ativa'}  último login=${r.lastLoginAt?.toISOString() ?? '—'}${r.lockedUntil && r.lockedUntil > new Date() ? '  BLOQUEADA até ' + r.lockedUntil.toISOString() : ''}`);
    }
  } else if (cmd === 'criar') {
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || !a2) {
      console.error('uso: node scripts/admin-emergencia.mjs criar <usuario> <companyId>\n(usuário: 3–40 caracteres a-z 0-9 . _ -)');
      process.exit(1);
    }
    if (!(await prisma.company.findUnique({ where: { id: a2 } }))) throw new Error('empresa não encontrada: ' + a2);
    if (await prisma.emergencyAdmin.findUnique({ where: { username } })) throw new Error('usuário já existe (use "resetar")');
    const password = await askPassword();
    const secret = base32(randomBytes(20));
    await prisma.emergencyAdmin.create({
      data: { username, passwordHash: await hash(password), totpSecretEnc: enc(secret), companyId: a2 },
    });
    await prisma.auditLog.create({ data: { actor: 'script', action: 'emergency_admin_create', payload: { username } } });
    console.log(`Conta de emergência "${username}" criada.`);
    showTotp(username, secret);
  } else if (cmd === 'resetar') {
    if (!(await prisma.emergencyAdmin.findUnique({ where: { username } }))) throw new Error('usuário não encontrado');
    const password = await askPassword();
    const secret = base32(randomBytes(20));
    await prisma.emergencyAdmin.update({
      where: { username },
      data: { passwordHash: await hash(password), totpSecretEnc: enc(secret), failedCount: 0, lockedUntil: null, lastTotpStep: null },
    });
    await prisma.auditLog.create({ data: { actor: 'script', action: 'emergency_admin_reset', payload: { username } } });
    console.log(`Senha e autenticador de "${username}" trocados; conta desbloqueada. Apague o autenticador antigo do app.`);
    showTotp(username, secret);
  } else if (cmd === 'desativar' || cmd === 'ativar') {
    await prisma.emergencyAdmin.update({ where: { username }, data: { disabled: cmd === 'desativar' } });
    await prisma.auditLog.create({ data: { actor: 'script', action: 'emergency_admin_' + cmd, payload: { username } } });
    console.log(`Conta "${username}" ${cmd === 'desativar' ? 'desativada' : 'ativada'}.`);
  } else {
    console.log('uso: node scripts/admin-emergencia.mjs <criar|resetar|desativar|ativar|listar> ...');
    process.exit(1);
  }
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
