// ZIP mínimo em modo STORE (sem compressão), escrito em fluxo.
// Gravações já são áudio comprimido (mp3) ou PCM que pouco comprime, então empacotar
// sem compressão é o certo: rápido e sem dependência nova. Cada arquivo é lido
// inteiro na memória (uma gravação por vez), escrito e descartado.
// Limites do formato sem ZIP64: até 65.535 arquivos e 4 GB no total — o chamador
// limita bem abaixo disso.
import { PassThrough } from 'node:stream';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato MS-DOS usado pelo ZIP. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export const ZIP_MAX_BYTES = 0xfffffffe;

export class ZipWriter {
  readonly stream = new PassThrough();
  private offset = 0;
  private central: Buffer[] = [];
  private count = 0;
  private names = new Set<string>();

  /** Nome único dentro do ZIP (acrescenta -2, -3… se repetir). */
  private unique(name: string): string {
    const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'arquivo';
    if (!this.names.has(clean)) { this.names.add(clean); return clean; }
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
    for (let i = 2; ; i++) {
      const n = `${base}-${i}${ext}`;
      if (!this.names.has(n)) { this.names.add(n); return n; }
    }
  }

  private write(b: Buffer): Promise<void> {
    this.offset += b.length;
    if (this.offset > ZIP_MAX_BYTES) throw new Error('ZIP passou de 4 GB');
    return new Promise((resolve) => { if (this.stream.write(b)) resolve(); else this.stream.once('drain', resolve); });
  }

  async add(name: string, data: Uint8Array, when = new Date()): Promise<void> {
    const fname = Buffer.from(this.unique(name), 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(when);
    const start = this.offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versão necessária
    local.writeUInt16LE(0x0800, 6);      // bit 11: nome em UTF-8
    local.writeUInt16LE(0, 8);           // método: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(0, 28);
    await this.write(local);
    await this.write(fname);
    await this.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // feito por
    cd.writeUInt16LE(20, 6);             // versão necessária
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(fname.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comentário
    cd.writeUInt16LE(0, 34);             // disco
    cd.writeUInt16LE(0, 36);             // atributos internos
    cd.writeUInt32LE(0, 38);             // atributos externos
    cd.writeUInt32LE(start, 42);
    this.central.push(cd, fname);
    this.count++;
  }

  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const b of this.central) await this.write(b);
    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    await this.write(end);
    this.stream.end();
  }
}
