import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePng,
  encodeRgbaPng,
  imagesPixelEqual,
  makeRgbaPng,
  optimizePngBuffer,
  readPngDimensions,
  resizeRgba,
  stitchHorizontal,
} from '../dist/index.js';

test('PNG encode/decode round-trip preserves exact RGBA and opaque RGB pixels', () => {
  const rgbaBuf = makeRgbaPng(16, 12, (x, y) => [x * 16, y * 20, (x + y) * 7 & 255, y < 6 ? 255 : 128]);
  assert.deepEqual(readPngDimensions(rgbaBuf), { width: 16, height: 12 });

  const decoded = decodePng(rgbaBuf);
  assert.equal(decoded.width, 16);
  assert.equal(decoded.height, 12);
  assert.equal(decoded.data[0], 0);
  assert.equal(decoded.data[3], 255);
  const off = (8 * 16 + 5) * 4;
  assert.equal(decoded.data[off], 80);
  assert.equal(decoded.data[off + 1], 160);
  assert.equal(decoded.data[off + 3], 128);

  const opaqueBuf = encodeRgbaPng({
    width: 8,
    height: 8,
    data: new Uint8Array(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 13) & 255)),
  });
  const decOpaque = decodePng(opaqueBuf);
  assert.equal(decOpaque.width, 8);
  assert.equal(decOpaque.height, 8);
  assert.equal(decOpaque.data[3], 255);
});

test('resizeRgba downscales cleanly and stitchHorizontal produces expected spritesheet', () => {
  const mkSolid = (w, h, r, g, b) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return { width: w, height: h, data };
  };

  const f0 = mkSolid(20, 10, 220, 40, 20);
  const f1 = mkSolid(20, 10, 20, 180, 240);
  assert.equal(imagesPixelEqual(f0, f0), true);
  assert.equal(imagesPixelEqual(f0, f1), false);

  const resized = resizeRgba(f0, 10, 5);
  assert.equal(resized.width, 10);
  assert.equal(resized.height, 5);
  assert.equal(resized.data[0], 220);

  const sheet = stitchHorizontal([resized, resizeRgba(f1, 10, 5)]);
  assert.equal(sheet.width, 20);
  assert.equal(sheet.height, 5);
  assert.equal(sheet.data[0], 220);
  assert.equal(sheet.data[10 * 4 + 2], 240);
});

test('optimizePngBuffer quantizes opaque gradient PNG into decodable indexed PNG', () => {
  const buf = makeRgbaPng(64, 64, (x, y) => [x * 4, y * 4, ((x + y) * 2) & 255, 255]);
  const opt = optimizePngBuffer(buf, true);
  assert.deepEqual(readPngDimensions(opt), { width: 64, height: 64 });
  const dec = decodePng(opt);
  assert.equal(dec.width, 64);
  assert.equal(dec.height, 64);
  assert.equal(dec.data[3], 255);
});
