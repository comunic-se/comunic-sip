// Coleta de CDR (histórico de chamadas) pela OpenAPI do Yeastar.
// A cada CDR_SYNC_INTERVAL_S, para cada PBX com Client ID/Secret da API:
//   lê v1.0/cdr/list do mais novo para o mais antigo até passar do MARCADOR
//   (horário da chamada mais nova já lida, menos uma margem) — ou até CDR_BACKFILL_DAYS
//   na primeira vez. Não dá para parar em "achei uma conhecida": num PBX movimentado a
//   lista anda enquanto paginamos e as páginas se sobrepõem.
// Cada chamada é associada à EMPRESA (faixa de ramais do PBX, ou DID em did_route) e ao
// ATENDENTE vinculado ao ramal naquele momento. Idempotente por (pbx_id, uid).
// MINIMIZAÇÃO (LGPD): o PBX pode ser compartilhado por vários clientes; chamadas sem
// empresa cadastrada NÃO são gravadas (CDR_STORE_UNASSIGNED=true muda isso).
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from './db.js';
import { decryptSecret } from './crypto.js';
import { openapiGet, type PbxCreds } from './yeastar.js';

const INTERVAL_S = Math.max(30, Number(process.env.CDR_SYNC_INTERVAL_S ?? 120) || 120);
const BACKFILL_DAYS = Math.max(1, Number(process.env.CDR_BACKFILL_DAYS ?? 30) || 30);
// Fuso do relógio do PBX, usado só quando o CDR não traz timestamp (ex.: -03:00)
const PBX_TZ = process.env.PBX_TIMEZONE_OFFSET ?? '-03:00';
// Ordem da data no texto do CDR quando ambígua (12/11): DMY (padrão, Brasil) ou MDY
const DATE_ORDER = (process.env.PBX_DATE_ORDER ?? 'DMY').toUpperCase() === 'MDY' ? 'MDY' : 'DMY';
const PAGE_SIZE = 100;
const MAX_PAGES_BACKFILL = 2000; // 200 mil chamadas no histórico inicial
const MAX_PAGES_INCREMENTAL = 100;
const OVERLAP_MS = 15 * 60_000;  // relê 15 min antes do marcador (chamadas longas entram no CDR ao terminar)
const STORE_UNASSIGNED = (process.env.CDR_STORE_UNASSIGNED ?? 'false').toLowerCase() === 'true';

const running = new Set<string>();

/** Converte o horário do CDR em Date. Prefere timestamp (epoch s); senão interpreta o texto no fuso do PBX. */
export function parseCdrTime(item: any): Date | null {
  const ts = Number(item?.timestamp);
  if (Number.isFinite(ts) && ts > 1e9) return new Date(ts * 1000);
  const t = String(item?.time ?? '').trim();
  const m = t.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const d = new Date(t); return isNaN(+d) ? null : d; }
  let [, a, b, c, hh, mi, ss] = m;
  let y: string, mo: string, d: string;
  if (a.length === 4) { y = a; mo = b; d = c; }              // YYYY/MM/DD
  else if (Number(a) > 12) { d = a; mo = b; y = c; }          // DD/MM/YYYY (sem ambiguidade)
  else if (Number(b) > 12) { mo = a; d = b; y = c; }          // MM/DD/YYYY (sem ambiguidade)
  else if (DATE_ORDER === 'MDY') { mo = a; d = b; y = c; }
  else { d = a; mo = b; y = c; }                              // DD/MM/YYYY (como o PBX da Comunic exibe)
  const iso = `${y.padStart(4, '20')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:${ss ?? '00'}${PBX_TZ}`;
  const dt = new Date(iso);
  return isNaN(+dt) ? null : dt;
}

interface CompanyMap {
  ranges: { companyId: string; from: string; to: string }[];
  links: Map<string, string>; // `${companyId}|${ext}` -> helenaUserId
  dids: Map<string, string>;  // did -> companyId
}

async function loadMap(pbxId: string): Promise<CompanyMap> {
  const companies = await prisma.company.findMany({ where: { pbxId }, include: { ranges: true, links: true } });
  const dids = await prisma.didRoute.findMany({ where: { pbxId } });
  const ranges: CompanyMap['ranges'] = [];
  const links = new Map<string, string>();
  for (const c of companies) {
    for (const r of c.ranges) ranges.push({ companyId: c.id, from: r.fromExt, to: r.toExt });
    for (const l of c.links) links.set(`${c.id}|${l.extensionNumber}`, l.helenaUserId);
  }
  return { ranges, links, dids: new Map(dids.map((d) => [d.didNumber, d.companyId])) };
}

function companyOfExt(map: CompanyMap, num?: string | null): string | null {
  const n = String(num ?? '').trim();
  if (!/^\d{2,6}$/.test(n)) return null;
  const r = map.ranges.find((x) => x.from.length === n.length && n >= x.from && n <= x.to);
  return r ? r.companyId : null;
}

/** Traduz um item do CDR para a linha de `calls`, com empresa e atendente. */
export function mapCdr(pbxId: string, item: any, map: CompanyMap) {
  const type = String(item.call_type ?? '').trim();          // Inbound | Outbound | Internal
  const from = String(item.call_from_number ?? item.call_from ?? '').trim() || null;
  const to = String(item.call_to_number ?? item.call_to ?? '').trim() || null;
  const fromCo = companyOfExt(map, from), toCo = companyOfExt(map, to);

  let owner: string | null = null, other: string | null = null;
  if (type === 'Inbound') owner = toCo ? to : null;
  else if (type === 'Outbound') owner = fromCo ? from : null;
  else { owner = fromCo ? from : toCo ? to : null; other = owner === from && toCo ? to : owner === to && fromCo ? from : null; }
  if (!owner) owner = fromCo ? from : toCo ? to : null;

  const did = String(item.did_number ?? item.did ?? '').trim() || null; // o PBX manda `did`
  const companyId = companyOfExt(map, owner) ?? companyOfExt(map, other) ?? (did ? map.dids.get(did) ?? null : null);
  const userOf = (ext: string | null) => (ext ? map.links.get(`${companyOfExt(map, ext)}|${ext}`) ?? null : null);
  const clean = (s: unknown) => { const v = String(s ?? '').trim(); return v || null; };

  return {
    pbxId,
    uid: String(item.uid ?? item.id),
    callId: clean(item.call_id),
    startedAt: parseCdrTime(item),
    direction: type || null,
    status: clean(item.disposition),                          // ANSWERED | NO ANSWER | BUSY | FAILED | VOICEMAIL
    fromNumber: from, fromName: clean(item.call_from_name),
    toNumber: to, toName: clean(item.call_to_name),
    extensionNumber: owner, helenaUserId: userOf(owner),
    otherExtension: other, otherUserId: userOf(other),
    companyId,
    callDuration: Number.isFinite(Number(item.duration)) ? Number(item.duration) : null,
    ringDuration: Number.isFinite(Number(item.ring_duration)) ? Number(item.ring_duration) : null,
    talkDuration: Number.isFinite(Number(item.talk_duration)) ? Number(item.talk_duration) : null,
    trunk: clean(item.src_trunk) ?? clean(item.dst_trunk),
    did,
    recordingFile: clean(item.record_file ?? item.recording),
    raw: item,
  };
}

const REC_ID_MARGIN = 1000; // relê as últimas N gravações: a gravação pode aparecer antes do CDR ser coletado

/**
 * Liga gravações do PBX (recording/list) às chamadas já gravadas, pelo `uid` do CDR.
 * Só chamadas das empresas cadastradas existem em `calls`, então gravações de outros
 * clientes do PBX são ignoradas. O áudio não é baixado aqui.
 */
async function syncRecordings(pbx: { id: string; recCursorId: number | null }, creds: PbxCreds): Promise<number> {
  const cursor = pbx.recCursorId ?? 0;
  const backfill = !cursor;
  const stopAt = Date.now() - BACKFILL_DAYS * 86_400_000;
  const maxPages = backfill ? MAX_PAGES_BACKFILL : Math.ceil(REC_ID_MARGIN / PAGE_SIZE) + MAX_PAGES_INCREMENTAL;
  let maxId = cursor, linked = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await openapiGet(creds, 'v1.0/recording/list', { page, page_size: PAGE_SIZE, sort_by: 'id', order_by: 'desc' });
    const items: any[] = Array.isArray(res.data) ? res.data : [];
    if (!items.length) break;
    for (const it of items) if (Number(it.id) > maxId) maxId = Number(it.id);
    const byUid = new Map(items.filter((it) => it.uid).map((it) => [String(it.uid), it]));
    const pending = await prisma.call.findMany({
      where: { pbxId: pbx.id, uid: { in: [...byUid.keys()] }, recordingId: null },
      select: { id: true, uid: true },
    });
    for (const c of pending) {
      const it = byUid.get(String(c.uid))!;
      await prisma.call.update({
        where: { id: c.id },
        data: { recordingId: Number(it.id), recordingFile: String(it.file ?? '') || null, recordingSize: Number(it.size) || null },
      });
      linked++;
    }
    const minId = Math.min(...items.map((it) => Number(it.id)));
    if (!backfill && minId <= cursor - REC_ID_MARGIN) break;
    if (backfill && items.some((it) => { const t = parseCdrTime({ time: it.time }); return t && +t < stopAt; })) break;
    if (items.length < PAGE_SIZE) break;
  }
  if (maxId > cursor) await prisma.pbx.update({ where: { id: pbx.id }, data: { recCursorId: maxId } });
  return linked;
}

export async function syncPbx(pbxId: string, log: FastifyBaseLogger): Promise<number> {
  if (running.has(pbxId)) return 0;
  running.add(pbxId);
  let inserted = 0;
  try {
    const pbx = await prisma.pbx.findUnique({ where: { id: pbxId } });
    if (!pbx?.clientIdEnc || !pbx.clientSecretEnc) return 0;
    const creds: PbxCreds = { baseUrl: pbx.baseUrl, accessId: decryptSecret(pbx.clientIdEnc), accessKey: decryptSecret(pbx.clientSecretEnc) };
    const map = await loadMap(pbxId);
    const backfill = !pbx.cdrCursorAt;
    const stopAt = backfill ? Date.now() - BACKFILL_DAYS * 86_400_000 : +pbx.cdrCursorAt! - OVERLAP_MS;
    const maxPages = backfill ? MAX_PAGES_BACKFILL : MAX_PAGES_INCREMENTAL;
    let newest = pbx.cdrCursorAt ? +pbx.cdrCursorAt : 0;

    for (let page = 1; page <= maxPages; page++) {
      const res = await openapiGet(creds, 'v1.0/cdr/list', { page, page_size: PAGE_SIZE, sort_by: 'id', order_by: 'desc' });
      const items: any[] = Array.isArray(res.data) ? res.data : [];
      if (!items.length) break;
      const rows = items.map((it) => mapCdr(pbxId, it, map)).filter((r) => r.uid && r.uid !== 'undefined');
      for (const r of rows) if (r.startedAt && +r.startedAt > newest && +r.startedAt <= Date.now() + 60_000) newest = +r.startedAt;
      const keep = rows.filter((r) => (STORE_UNASSIGNED || r.companyId) && (!r.startedAt || +r.startedAt >= stopAt));
      if (keep.length) {
        const out = await prisma.call.createMany({ data: keep, skipDuplicates: true }); // sobreposição de páginas: ignora repetidas
        inserted += out.count;
      }
      // Passou do marcador nesta página (lista em ordem decrescente) -> terminou.
      if (rows.some((r) => r.startedAt && +r.startedAt < stopAt) || items.length < PAGE_SIZE) break;
    }
    if (newest) await prisma.pbx.update({ where: { id: pbxId }, data: { cdrCursorAt: new Date(newest) } });
    const recs = await syncRecordings(pbx, creds);
    if (recs) log.info({ pbxId, recs }, 'gravações vinculadas');
    await prisma.pbx.update({ where: { id: pbxId }, data: { cdrSyncedAt: new Date(), cdrSyncError: null } });
    if (inserted) log.info({ pbxId, inserted }, 'CDR sincronizado');
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500);
    log.warn({ pbxId, err: msg }, 'falha na coleta de CDR');
    await prisma.pbx.update({ where: { id: pbxId }, data: { cdrSyncError: msg } }).catch(() => {});
  } finally {
    running.delete(pbxId);
  }
  return inserted;
}

async function syncAll(log: FastifyBaseLogger): Promise<void> {
  const pbxs = await prisma.pbx.findMany({ where: { clientIdEnc: { not: null }, clientSecretEnc: { not: null } }, select: { id: true } });
  for (const p of pbxs) await syncPbx(p.id, log);
}

export function startCdrSync(log: FastifyBaseLogger): void {
  if ((process.env.CDR_SYNC_ENABLED ?? 'true').toLowerCase() === 'false') {
    log.info('coleta de CDR desligada (CDR_SYNC_ENABLED=false)');
    return;
  }
  log.info(`coleta de CDR a cada ${INTERVAL_S}s (histórico inicial de ${BACKFILL_DAYS} dias)`);
  setTimeout(() => syncAll(log).catch(() => {}), 10_000);
  setInterval(() => syncAll(log).catch(() => {}), INTERVAL_S * 1000).unref();
}
