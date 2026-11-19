// Pure-Node zero-dependency ZIP writer (POSIX forward slashes, Deflate compression)
// for packaging cross-platform Minecraft Bedrock .mcpack and .mcaddon archives.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInputEntry {
  /** POSIX path inside the ZIP archive (e.g. 'bp/manifest.json'). */
  name: string;
  data: Buffer;
}

/** Encodes an array of entries into a standard Deflate ZIP buffer with POSIX '/' paths. */
export function buildZipBuffer(entries: readonly ZipInputEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  // Fixed DOS timestamp (2025-01-01 00:00:00) for deterministic builds
  const dosTime = 0;
  const dosDate = ((2025 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const raw = entry.data;
    const crc = crc32(raw);

    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const comp = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;

    // Local file header (30 bytes + name)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, comp);

    // Central directory header (46 bytes + name)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8); // UTF-8 flag
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra len
    ch.writeUInt16LE(0, 32); // comment len
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);

    centralParts.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** Recursively collects files under `dirPath` into ZIP entries prefixed by `zipPrefix`. */
export function collectDirZipEntries(
  dirPath: string,
  zipPrefix: string,
  shouldInclude?: (relPosix: string) => boolean,
): ZipInputEntry[] {
  const out: ZipInputEntry[] = [];
  const walk = (absDir: string, relBase: string): void => {
    const items = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      const abs = path.join(absDir, item.name);
      const rel = relBase ? `${relBase}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (shouldInclude && !shouldInclude(`${rel}/`)) continue;
        walk(abs, rel);
      } else if (item.isFile()) {
        if (shouldInclude && !shouldInclude(rel)) continue;
        const name = zipPrefix ? `${zipPrefix}/${rel}` : rel;
        out.push({ name, data: fs.readFileSync(abs) });
      }
    }
  };
  walk(dirPath, '');
  return out;
}
