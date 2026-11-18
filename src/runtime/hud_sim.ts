// [EXPERIMENTAL] Pure TypeScript byte-aligned HUD payload packer (zero @minecraft/* imports).

import type { BakedHudManifest } from '../types.js';

/**
 * Normalizes arbitrary text into fixed-length single-byte printable ASCII (`0x20..0x7E`, `§x` stripped)
 * so Bedrock JsonUI `('%.Ns' * #str)` UTF-8 byte slicing never drifts across slots.
 */
export function sliceAsciiField(text: string, len: number): string {
  if (len <= 0) return '';
  const clean = String(text ?? '')
    .replace(/\u00a7./g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
  if (clean.length >= len) return clean.slice(0, len);
  return clean.padEnd(len, ' ');
}

/**
 * Packs fixed ASCII slots in byte order followed by the optional UTF-8 / `§`-colored tail slot.
 */
export function packHudPayload(values: Record<string, string>, manifest: BakedHudManifest): string {
  const fixedFields = manifest.dynFields.filter((f) => !f.tail).sort((a, b) => a.start - b.start);
  const tailField = manifest.dynFields.find((f) => f.tail);

  let prefix = '';
  for (const field of fixedFields) {
    if (prefix.length < field.start) {
      prefix += ' '.repeat(field.start - prefix.length);
    }
    prefix = prefix.slice(0, field.start) + sliceAsciiField(values[field.dynId] ?? '', field.len);
  }

  if (prefix.length < manifest.fixedByteLen) {
    prefix = prefix.padEnd(manifest.fixedByteLen, ' ');
  } else if (prefix.length > manifest.fixedByteLen) {
    prefix = prefix.slice(0, manifest.fixedByteLen);
  }

  if (!tailField) return prefix;
  const rawTail = String(values[tailField.dynId] ?? '').replace(/[\r\n]+/g, ' ');
  return `${prefix}${rawTail}`;
}

/**
 * Diagnostic payload: fills fixed slots with `AAAA...`, `BBBB...`, etc. and tail with `§aTAIL OK`
 * to verify whether client-side JsonUI slicing or server payload formatting is at fault.
 */
export function buildHudDebugPayload(manifest: BakedHudManifest): string {
  const values: Record<string, string> = {};
  let i = 0;
  for (const f of manifest.dynFields) {
    if (f.tail) {
      values[f.dynId] = '§aTAIL OK';
    } else {
      values[f.dynId] = String.fromCharCode(65 + (i % 26)).repeat(f.len);
      i++;
    }
  }
  return packHudPayload(values, manifest);
}
