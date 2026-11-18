// Bundles packs/bp/src/main.ts -> packs/bp/scripts/main.js, creates pack_icon.png,
// and writes ready-to-import guild_codex_rp.mcpack, guild_codex_bp.mcpack, and guild_codex.mcaddon.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { makeRgbaPng } from '../../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const bpDir = path.join(__dirname, 'packs', 'bp');
const rpDir = path.join(__dirname, 'packs', 'rp');
const outDir = path.join(__dirname, 'dist');

// 1. Generate crisp 128x128 Aetherium pack_icon.png (#0b0e0a + #b4f055 crosshair badge)
function makePackIcon() {
  return makeRgbaPng(128, 128, (x, y) => {
    const cx = 63.5;
    const cy = 63.5;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);

    // Outer 2px border frame
    if (x < 2 || y < 2 || x >= 126 || y >= 126) return [36, 48, 32, 255];

    // Centered rounded lime badge (72x72, radius 16)
    const bx = Math.abs(dx) - 20;
    const by = Math.abs(dy) - 20;
    const roundDist = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
    const inBadge = roundDist <= 16;

    if (inBadge) {
      // Dark crosshair icon inside badge
      const onRing = Math.abs(dist - 19) <= 2.4;
      const onH = Math.abs(dy) <= 2.2 && Math.abs(dx) >= 10 && Math.abs(dx) <= 25;
      const onV = Math.abs(dx) <= 2.2 && Math.abs(dy) >= 10 && Math.abs(dy) <= 25;
      if (onRing || onH || onV) return [11, 14, 10, 255];
      return [180, 240, 85, 255];
    }

    // Subtle ambient lime radial glow behind badge
    const glow = Math.max(0, 1 - dist / 64);
    const r = Math.round(11 + glow * glow * 26);
    const g = Math.round(14 + glow * glow * 42);
    const b = Math.round(10 + glow * glow * 14);
    return [r, g, b, 255];
  });
}

// 2. Minimal pure-Node ZIP builder (deflate compression, clean forward-slash paths for Bedrock)
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useStore = compressed.length >= data.length;
    const payload = useStore ? data : compressed;
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
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

function walkFiles(dir, prefix = '', excludeDirs = new Set()) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (excludeDirs.has(ent.name)) continue;
      out.push(...walkFiles(path.join(dir, ent.name), prefix ? `${prefix}/${ent.name}` : ent.name, excludeDirs));
    } else {
      out.push({
        name: prefix ? `${prefix}/${ent.name}` : ent.name,
        data: fs.readFileSync(path.join(dir, ent.name)),
      });
    }
  }
  return out;
}

async function main() {
  const iconPng = makePackIcon();
  fs.writeFileSync(path.join(bpDir, 'pack_icon.png'), iconPng);
  fs.writeFileSync(path.join(rpDir, 'pack_icon.png'), iconPng);

  // Bundle BP TypeScript -> packs/bp/scripts/main.js
  fs.mkdirSync(path.join(bpDir, 'scripts'), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(bpDir, 'src', 'main.ts')],
    outfile: path.join(bpDir, 'scripts', 'main.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    external: ['@minecraft/server', '@minecraft/server-ui'],
    alias: {
      'bedrock-baked-ui/runtime': path.join(repoRoot, 'dist', 'runtime', 'index.js'),
    },
  });

  fs.mkdirSync(outDir, { recursive: true });

  const rpFiles = walkFiles(rpDir);
  const bpFiles = walkFiles(bpDir, '', new Set(['src']));

  const rpPackPath = path.join(outDir, 'guild_codex_rp.mcpack');
  const bpPackPath = path.join(outDir, 'guild_codex_bp.mcpack');
  const addonPath = path.join(outDir, 'guild_codex.mcaddon');

  fs.writeFileSync(rpPackPath, buildZip(rpFiles));
  fs.writeFileSync(bpPackPath, buildZip(bpFiles));
  fs.writeFileSync(
    addonPath,
    buildZip([
      ...rpFiles.map((f) => ({ name: `guild_codex_rp/${f.name}`, data: f.data })),
      ...bpFiles.map((f) => ({ name: `guild_codex_bp/${f.name}`, data: f.data })),
    ]),
  );

  for (const p of [rpPackPath, bpPackPath, addonPath]) {
    const kb = (fs.statSync(p).size / 1024).toFixed(1);
    console.log(`[mcpack] wrote ${path.basename(p)} (${kb} KB) -> ${p}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
