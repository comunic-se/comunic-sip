// Empacota dist/ num .zip pronto para distribuir (rode depois do build):
//
//   npm run pack         → release/comunic-chat-<versão>.zip   (instalação manual, ID fixo pela "key")
//   npm run pack:store   → release/comunic-chat-<versão>-loja.zip (sem "key": a Chrome Web Store recusa esse campo)
//
// Ficam de fora os mapas de depuração (*.map). Sem dependências: zip escrito à mão (deflate do Node).
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const store = process.argv.includes('--store');
const dist = 'dist';

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
if (store) delete manifest.key;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (!p.endsWith('.map')) out.push(p);
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

const files = (await walk(dist)).sort();
const locals = [], centrals = [];
let offset = 0;
for (const f of files) {
  const name = relative(dist, f).split('\\').join('/');
  const data = name === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : await readFile(f);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const { time, date } = dosTime((await stat(f)).mtime);
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
  head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
  locals.push(head, nameBuf, comp);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(offset, 42);
  centrals.push(cen, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cdSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);

await mkdir('release', { recursive: true });
const out = join('release', `comunic-chat-${manifest.version}${store ? '-loja' : ''}.zip`);
await writeFile(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`Pacote: ${out} (${files.length} arquivos)`);
console.log(store
  ? 'Envie este arquivo no painel da Chrome Web Store / Edge Add-ons.'
  : 'Mande este .zip: descompactar → chrome://extensions → Modo do desenvolvedor → Carregar sem compactação.');
