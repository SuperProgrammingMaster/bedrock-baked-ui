// Tag encoding and detection helpers for Bedrock JsonUI marker bindings.

export const DEFAULT_ROUTER_TAG = '§w§b';
export const DEFAULT_INV_TITLE_TAG = '§b§w§n§h';
export const DEFAULT_HUD_TAG = '§h§u§d';
export const DEFAULT_HUD_OFF_TAG = 'bui.off';

/**
 * Encodes an index in [0..99] into a 2-digit section-code marker (`§<prefix>§<d0>§<d1>`).
 * Bedrock renders section codes invisibly while preserving them in `#hover_text` / `#title_text` bindings.
 */
export function encodeTag(prefix: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 99) {
    throw new RangeError(`Tag index for prefix '${prefix}' out of range (0..99): ${index}`);
  }
  const digits = String(index).padStart(2, '0');
  return `§${prefix}§${digits[0]}§${digits[1]}`;
}

/**
 * Returns true if an item nameTag starts with a baked-UI marker prefix:
 *  - `§s§00..§s§99` (state tag)
 *  - `§h§00..§h§99` (hitbox tag)
 *  - `§9§0..§9§9`   (dynamic slot background mask variant tag)
 */
export function isBakedMarkerTag(nameTag: string | undefined): boolean {
  if (!nameTag) return false;
  return /^§[sh9]§\d(§\d)?/.test(nameTag);
}
