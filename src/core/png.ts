// Pure-Node PNG codec, resizer, spritesheet stitcher, pixel-diff, and optional 256-color quantizer.
// Zero native addons and zero Python/Pillow dependencies.

import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface RgbaImage {
  width: number;
  height: number;
  /** Tightly packed RGBA bytes (length === width * height * 4). */
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crc32(buf: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reads width and height directly from a PNG header without decompressing pixels. */
export function readPngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Missing PNG IHDR chunk');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

/** Decodes an 8-bit non-interlaced PNG (Grayscale, RGB, Indexed+PLTE, Gray+Alpha, RGBA) into RGBA. */
export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatParts: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) throw new Error(`Truncated PNG chunk '${type}'`);
    const chunk = buf.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
      if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (expected 8)`);
      if (interlace !== 0) throw new Error('Interlaced PNG is not supported');
    } else if (type === 'PLTE') {
      plte = chunk;
    } else if (type === 'tRNS') {
      trns = chunk;
    } else if (type === 'IDAT') {
      idatParts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (width <= 0 || height <= 0) throw new Error('Invalid PNG dimensions');

  let bpp: number;
  switch (colorType) {
    case 0: bpp = 1; break; // Grayscale
    case 2: bpp = 3; break; // RGB
    case 3: bpp = 1; break; // Indexed
    case 4: bpp = 2; break; // Grayscale + Alpha
    case 6: bpp = 4; break; // RGBA
    default: throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = width * bpp;
  const expectedLen = height * (1 + stride);
  if (raw.length < expectedLen) {
    throw new Error(`PNG decompressed length mismatch: got ${raw.length}, expected ${expectedLen}`);
  }

  const recon = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (1 + stride)];
    const srcOff = y * (1 + stride) + 1;
    const dstOff = y * stride;
    const prevOff = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const byte = raw[srcOff + x];
      const a = x >= bpp ? recon[dstOff + x - bpp] : 0;
      const b = y > 0 ? recon[prevOff + x] : 0;
      const c = (x >= bpp && y > 0) ? recon[prevOff + x - bpp] : 0;

      let val: number;
      if (filter === 0) val = byte;
      else if (filter === 1) val = (byte + a) & 0xff;
      else if (filter === 2) val = (byte + b) & 0xff;
      else if (filter === 3) val = (byte + ((a + b) >>> 1)) & 0xff;
      else if (filter === 4) val = (byte + paethPredictor(a, b, c)) & 0xff;
      else throw new Error(`Unsupported PNG filter type: ${filter}`);

      recon[dstOff + x] = val;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  if (colorType === 6) {
    rgba.set(recon);
  } else if (colorType === 2) {
    for (let i = 0, p = 0; i < recon.length; i += 3, p += 4) {
      rgba[p] = recon[i];
      rgba[p + 1] = recon[i + 1];
      rgba[p + 2] = recon[i + 2];
      rgba[p + 3] = 255;
    }
  } else if (colorType === 0) {
    for (let i = 0, p = 0; i < recon.length; i++, p += 4) {
      const g = recon[i];
      rgba[p] = g;
      rgba[p + 1] = g;
      rgba[p + 2] = g;
      rgba[p + 3] = 255;
    }
  } else if (colorType === 4) {
    for (let i = 0, p = 0; i < recon.length; i += 2, p += 4) {
      const g = recon[i];
      rgba[p] = g;
      rgba[p + 1] = g;
      rgba[p + 2] = g;
      rgba[p + 3] = recon[i + 1];
    }
  } else if (colorType === 3) {
    if (!plte) throw new Error('Indexed PNG missing PLTE chunk');
    for (let i = 0, p = 0; i < recon.length; i++, p += 4) {
      const idx = recon[i];
      rgba[p] = plte[idx * 3] ?? 0;
      rgba[p + 1] = plte[idx * 3 + 1] ?? 0;
      rgba[p + 2] = plte[idx * 3 + 2] ?? 0;
      rgba[p + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }

  return { width, height, data: rgba };
}

function isFullyOpaque(img: RgbaImage): boolean {
  const { data } = img;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return false;
  }
  return true;
}

/** Encodes raw scanlines with per-row adaptive PNG filtering (Sub/Up/Paeth heuristic) for small file sizes. */
function encodeFilteredScanlines(pixels: Uint8Array, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.allocUnsafe(height * (1 + stride));
  const candSub = new Uint8Array(stride);
  const candUp = new Uint8Array(stride);
  const candPaeth = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    const prevOff = (y - 1) * stride;
    const outRow = y * (1 + stride);

    let sumNone = 0;
    let sumSub = 0;
    let sumUp = 0;
    let sumPaeth = 0;

    for (let x = 0; x < stride; x++) {
      const cur = pixels[rowOff + x];
      const a = x >= bpp ? pixels[rowOff + x - bpp] : 0;
      const b = y > 0 ? pixels[prevOff + x] : 0;
      const c = (x >= bpp && y > 0) ? pixels[prevOff + x - bpp] : 0;

      const s = (cur - a) & 0xff;
      const u = (cur - b) & 0xff;
      const p = (cur - paethPredictor(a, b, c)) & 0xff;

      candSub[x] = s;
      candUp[x] = u;
      candPaeth[x] = p;

      sumNone += cur < 128 ? cur : 256 - cur;
      sumSub += s < 128 ? s : 256 - s;
      sumUp += u < 128 ? u : 256 - u;
      sumPaeth += p < 128 ? p : 256 - p;
    }

    let bestFilter = 0;
    let bestSum = sumNone;
    let bestBuf: Uint8Array = pixels.subarray(rowOff, rowOff + stride);

    if (sumSub < bestSum) {
      bestFilter = 1;
      bestSum = sumSub;
      bestBuf = candSub;
    }
    if (sumUp < bestSum) {
      bestFilter = 2;
      bestSum = sumUp;
      bestBuf = candUp;
    }
    if (sumPaeth < bestSum) {
      bestFilter = 4;
      bestBuf = candPaeth;
    }

    out[outRow] = bestFilter;
    out.set(bestBuf, outRow + 1);
  }

  return out;
}

/** Encodes an RGBA image to a PNG buffer (automatically uses RGB colorType=2 if opaque). */
export function encodeRgbaPng(img: RgbaImage, opts: { level?: number; forceRgba?: boolean } = {}): Buffer {
  const { width, height, data } = img;
  const level = opts.level ?? 6;
  const opaque = !opts.forceRgba && isFullyOpaque(img);
  const colorType = opaque ? 2 : 6;
  const bpp = opaque ? 3 : 4;

  let pixels: Uint8Array;
  if (opaque) {
    pixels = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      pixels[j] = data[i];
      pixels[j + 1] = data[i + 1];
      pixels[j + 2] = data[i + 2];
    }
  } else {
    pixels = data;
  }

  const raw = encodeFilteredScanlines(pixels, width, height, bpp);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;

  const idat = zlib.deflateSync(raw, { level });
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Procedural PNG generator helper for small UI/9-slice textures. */
export function makeRgbaPng(
  width: number,
  height: number,
  pixelFn: (x: number, y: number, w: number, h: number) => [number, number, number, number],
): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const off = (y * width + x) * 4;
      data[off] = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = a;
    }
  }
  return encodeRgbaPng({ width, height, data }, { level: 9, forceRgba: true });
}

/** Resizes an RGBA image using bilinear / area-averaged box sampling (for flip_book downscaling). */
export function resizeRgba(img: RgbaImage, targetW: number, targetH: number): RgbaImage {
  if (img.width === targetW && img.height === targetH) return img;
  const out = new Uint8Array(targetW * targetH * 4);
  const xRatio = img.width / targetW;
  const yRatio = img.height / targetH;

  if (xRatio >= 1 && yRatio >= 1) {
    // Area averaging for clean downscaling without aliasing
    for (let ty = 0; ty < targetH; ty++) {
      const y0 = ty * yRatio;
      const y1 = Math.min(img.height, (ty + 1) * yRatio);
      const iy0 = Math.floor(y0);
      const iy1 = Math.max(iy0 + 1, Math.ceil(y1));
      for (let tx = 0; tx < targetW; tx++) {
        const x0 = tx * xRatio;
        const x1 = Math.min(img.width, (tx + 1) * xRatio);
        const ix0 = Math.floor(x0);
        const ix1 = Math.max(ix0 + 1, Math.ceil(x1));

        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let weightSum = 0;

        for (let sy = iy0; sy < iy1 && sy < img.height; sy++) {
          const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
          if (wy <= 0) continue;
          for (let sx = ix0; sx < ix1 && sx < img.width; sx++) {
            const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
            if (wx <= 0) continue;
            const w = wx * wy;
            const off = (sy * img.width + sx) * 4;
            const alpha = img.data[off + 3];
            r += img.data[off] * alpha * w;
            g += img.data[off + 1] * alpha * w;
            b += img.data[off + 2] * alpha * w;
            a += alpha * w;
            weightSum += w;
          }
        }

        const dst = (ty * targetW + tx) * 4;
        if (weightSum > 0 && a > 0) {
          out[dst] = Math.round(r / a);
          out[dst + 1] = Math.round(g / a);
          out[dst + 2] = Math.round(b / a);
          out[dst + 3] = Math.round(a / weightSum);
        }
      }
    }
    return { width: targetW, height: targetH, data: out };
  }

  // Bilinear interpolation for upscaling or mixed ratios
  for (let ty = 0; ty < targetH; ty++) {
    const gy = ((ty + 0.5) * yRatio) - 0.5;
    const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(gy)));
    const y1 = Math.max(0, Math.min(img.height - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, gy - y0));

    for (let tx = 0; tx < targetW; tx++) {
      const gx = ((tx + 0.5) * xRatio) - 0.5;
      const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(gx)));
      const x1 = Math.max(0, Math.min(img.width - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, gx - x0));

      const o00 = (y0 * img.width + x0) * 4;
      const o10 = (y0 * img.width + x1) * 4;
      const o01 = (y1 * img.width + x0) * 4;
      const o11 = (y1 * img.width + x1) * 4;
      const dst = (ty * targetW + tx) * 4;

      for (let c = 0; c < 4; c++) {
        const top = img.data[o00 + c] * (1 - fx) + img.data[o10 + c] * fx;
        const bot = img.data[o01 + c] * (1 - fx) + img.data[o11 + c] * fx;
        out[dst + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/** Returns true if two RGBA images have identical dimensions and identical pixel bytes. */
export function imagesPixelEqual(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** Stitches equal-sized RGBA frames horizontally into a single flip_book spritesheet. */
export function stitchHorizontal(frames: RgbaImage[]): RgbaImage {
  if (frames.length === 0) throw new Error('Cannot stitch empty frame list');
  const fw = frames[0].width;
  const fh = frames[0].height;
  const sheetW = fw * frames.length;
  const data = new Uint8Array(sheetW * fh * 4);

  for (let f = 0; f < frames.length; f++) {
    const im = frames[f].width === fw && frames[f].height === fh
      ? frames[f]
      : resizeRgba(frames[f], fw, fh);
    for (let y = 0; y < fh; y++) {
      const srcOff = y * fw * 4;
      const dstOff = (y * sheetW + f * fw) * 4;
      data.set(im.data.subarray(srcOff, srcOff + fw * 4), dstOff);
    }
  }
  return { width: sheetW, height: fh, data };
}

interface ColorBucket {
  entries: Array<{ r: number; g: number; b: number; count: number }>;
  total: number;
  rMin: number; rMax: number;
  gMin: number; gMax: number;
  bMin: number; bMax: number;
}

function makeBucket(entries: Array<{ r: number; g: number; b: number; count: number }>): ColorBucket {
  let total = 0;
  let rMin = 255; let rMax = 0;
  let gMin = 255; let gMax = 0;
  let bMin = 255; let bMax = 0;
  for (const e of entries) {
    total += e.count;
    if (e.r < rMin) rMin = e.r;
    if (e.r > rMax) rMax = e.r;
    if (e.g < gMin) gMin = e.g;
    if (e.g > gMax) gMax = e.g;
    if (e.b < bMin) bMin = e.b;
    if (e.b > bMax) bMax = e.b;
  }
  return { entries, total, rMin, rMax, gMin, gMax, bMin, bMax };
}

/**
 * Pure-JS 256-color median-cut PNG quantizer for opaque UI screenshots.
 * Significantly shrinks Bedrock resource pack texture payloads without Python/Pillow.
 * Images containing transparency fall back to lossless adaptive-filtered RGBA PNG.
 */
export function optimizePngBuffer(buf: Buffer, quantize = true): Buffer {
  const img = decodePng(buf);
  const opaque = isFullyOpaque(img);
  if (!quantize || !opaque) {
    const reencoded = encodeRgbaPng(img, { level: 7 });
    return reencoded.length < buf.length ? reencoded : buf;
  }

  // Build 15-bit RGB histogram (5 bits/channel) for fast median-cut clustering
  const hist = new Map<number, { rSum: number; gSum: number; bSum: number; count: number }>();
  const { width, height, data } = img;
  const pixelCount = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cell = hist.get(key);
    if (cell) {
      cell.rSum += r;
      cell.gSum += g;
      cell.bSum += b;
      cell.count += 1;
    } else {
      hist.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
    }
  }

  const entries = [...hist.values()].map((c) => ({
    r: Math.round(c.rSum / c.count),
    g: Math.round(c.gSum / c.count),
    b: Math.round(c.bSum / c.count),
    count: c.count,
  }));

  const buckets: ColorBucket[] = [makeBucket(entries)];
  while (buckets.length < 256) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < buckets.length; i++) {
      const bk = buckets[i];
      if (bk.entries.length < 2) continue;
      const span = Math.max(bk.rMax - bk.rMin, bk.gMax - bk.gMin, bk.bMax - bk.bMin);
      const score = span * Math.sqrt(bk.total);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    const bk = buckets[bestIdx];
    const rRange = bk.rMax - bk.rMin;
    const gRange = bk.gMax - bk.gMin;
    const bRange = bk.bMax - bk.bMin;
    if (rRange >= gRange && rRange >= bRange) bk.entries.sort((a, b) => a.r - b.r);
    else if (gRange >= bRange) bk.entries.sort((a, b) => a.g - b.g);
    else bk.entries.sort((a, b) => a.b - b.b);

    const half = bk.total / 2;
    let acc = 0;
    let split = 1;
    for (let i = 0; i < bk.entries.length - 1; i++) {
      acc += bk.entries[i].count;
      split = i + 1;
      if (acc >= half) break;
    }
    const left = makeBucket(bk.entries.slice(0, split));
    const right = makeBucket(bk.entries.slice(split));
    buckets.splice(bestIdx, 1, left, right);
  }

  const paletteSize = buckets.length;
  const palR = new Uint8Array(paletteSize);
  const palG = new Uint8Array(paletteSize);
  const palB = new Uint8Array(paletteSize);
  const plte = Buffer.allocUnsafe(paletteSize * 3);

  for (let i = 0; i < paletteSize; i++) {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let total = 0;
    for (const e of buckets[i].entries) {
      rSum += e.r * e.count;
      gSum += e.g * e.count;
      bSum += e.b * e.count;
      total += e.count;
    }
    const r = Math.round(rSum / total);
    const g = Math.round(gSum / total);
    const b = Math.round(bSum / total);
    palR[i] = r;
    palG[i] = g;
    palB[i] = b;
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  }

  // Cache 15-bit RGB -> nearest palette index for O(1) pixel mapping
  const lut = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = lut[key];
    if (cached >= 0) return cached;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < paletteSize; i++) {
      const dr = r - palR[i];
      const dg = g - palG[i];
      const db = b - palB[i];
      const d = dr * dr * 2 + dg * dg * 4 + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    lut[key] = best;
    return best;
  };

  const indexed = new Uint8Array(pixelCount);
  for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
    indexed[p] = nearest(data[i], data[i + 1], data[i + 2]);
  }

  const raw = encodeFilteredScanlines(indexed, width, height, 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // Indexed-color

  const idat = zlib.deflateSync(raw, { level: 8 });
  const quantized = Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('PLTE', plte),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return quantized.length < buf.length ? quantized : buf;
}
