// Diagnóstico da coleta de chamadas (somente leitura; não mostra segredos).
// Uso: node scripts/diagnostico-cdr.mjs [--testar-api]
//   --testar-api  também chama a OpenAPI do PBX (cdr/list, 1 página de 5) para ver se responde
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';

const prisma = new PrismaClient();
const testar = process.argv.includes('--testar-api');
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Comunic.SIP-diagnostico/1.0' };

function dec(blob) {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const [iv, tag, enc] = blob.split('.');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
const fmt = (d) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

try {
  console.log('\n=== PBX ===');
  const pbxs = await prisma.pbx.findMany({ include: { companies: { select: { name: true } } } });
  for (const p of pbxs) {
    console.log(`\n• ${p.name}  (${p.baseUrl})`);
    console.log(`  empresas: ${p.companies.map((c) => c.name).join(', ') || '—'}`);
    console.log(`  API configurada: ${p.clientIdEnc && p.clientSecretEnc ? 'sim' : 'NÃO'}`);
    console.log(`  última coleta: ${fmt(p.cdrSyncedAt)}`);
    console.log(`  erro da coleta: ${p.cdrSyncError ?? 'nenhum'}`);

    if (testar && p.clientIdEnc && p.clientSecretEnc) {
      try {
        const tr = await fetch(`${p.baseUrl}/openapi/v1.0/get_token`, {
          method: 'POST', headers: UA,
          body: JSON.stringify({ username: dec(p.clientIdEnc), password: dec(p.clientSecretEnc) }),
        });
        const tj = await tr.json().catch(() => null);
        if (!tj?.access_token) { console.log(`  teste da API: FALHOU no get_token (HTTP ${tr.status}, errcode ${tj?.errcode}, ${tj?.errmsg})`); continue; }
        const r = await fetch(`${p.baseUrl}/openapi/v1.0/cdr/list?page=1&page_size=5&sort_by=id&order_by=desc&access_token=${encodeURIComponent(tj.access_token)}`, { headers: UA });
        const j = await r.json().catch(() => null);
        if (j?.errcode !== 0) { console.log(`  teste da API: cdr/list FALHOU (errcode ${j?.errcode}, ${j?.errmsg})`); continue; }
        console.log(`  teste da API: OK — total no PBX: ${j.total_number ?? '?'}; amostra das mais recentes:`);
        for (const it of j.data ?? []) {
          console.log(`    ${it.time ?? it.timestamp}  ${it.call_type}  ${it.call_from_number} -> ${it.call_to_number}  ${it.disposition}`);
        }
        // Campos disponíveis (para conferir o mapeamento), sem valores
        if (j.data?.[0]) console.log(`  campos do CDR: ${Object.keys(j.data[0]).join(', ')}`);
        await fetch(`${p.baseUrl}/openapi/v1.0/del_token?access_token=${encodeURIComponent(tj.access_token)}`, { headers: UA }).catch(() => {});
      } catch (e) {
        console.log(`  teste da API: erro de rede — ${e.message}`);
      }
    }
  }

  console.log('\n=== Chamadas gravadas ===');
  const total = await prisma.call.count();
  console.log(`total: ${total}`);
  const porEmpresa = await prisma.call.groupBy({ by: ['companyId'], _count: { _all: true } });
  const nomes = new Map((await prisma.company.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  for (const g of porEmpresa) console.log(`  ${g.companyId ? nomes.get(g.companyId) ?? g.companyId : '(sem empresa)'}: ${g._count._all}`);
  const semAtendente = await prisma.call.count({ where: { companyId: { not: null }, helenaUserId: null } });
  console.log(`  com empresa mas sem atendente (fila, ramal sem vínculo): ${semAtendente}`);
  const ult = await prisma.call.findFirst({ orderBy: { startedAt: 'desc' } });
  const pri = await prisma.call.findFirst({ orderBy: { startedAt: 'asc' } });
  console.log(`  mais antiga: ${fmt(pri?.startedAt)} · mais recente: ${fmt(ult?.startedAt)}`);
  const semData = await prisma.call.count({ where: { startedAt: null } });
  if (semData) console.log(`  ATENÇÃO: ${semData} chamada(s) sem data/hora reconhecida`);
  const semEmpresa = await prisma.call.findMany({ where: { companyId: null }, take: 5, orderBy: { startedAt: 'desc' } });
  if (semEmpresa.length) {
    console.log('  exemplos sem empresa (verifique faixas de ramal / DIDs):');
    for (const c of semEmpresa) console.log(`    ${fmt(c.startedAt)}  ${c.direction}  ${c.fromNumber} -> ${c.toNumber}  DID=${c.did ?? '—'}`);
  }
} catch (e) {
  console.error('Erro:', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
