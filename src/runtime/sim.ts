// Pure TypeScript runtime helpers for bedrock-baked-ui (zero @minecraft/* and zero Node.js imports).
// Safe to import in both Minecraft Bedrock Behavior Packs and Node.js unit tests.

import type { BakedBarSlot, BakedButton, BakedDynSlot, BakedSiteManifest, BakedState } from '../types.js';

export const MENU_MARKER_ITEM = 'minecraft:paper';

export interface BakedMenuState {
  bakedKey: string;
  clicks: number;
  openedTick: number;
}

export interface InvSlotSpec {
  slot: number;
  nameTag: string;
}

export interface ActionFormSpec {
  title: string;
  body: string;
  buttons: Array<{ text: string; action: BakedButton }>;
}

/** Checks whether an item nameTag starts with a baked-UI hidden marker (`§s§00`, `§h§00`, `§9§0`, `§b§0`). */
export function isBakedMarkerTag(nameTag: string | undefined): boolean {
  if (!nameTag) return false;
  return /^§[sh9b]§\d(§\d)?/.test(nameTag);
}

/** Resolves a route string (exact state key or substring/URL match) to a valid manifest state key. */
export function resolveRouteKey(manifest: BakedSiteManifest, route?: string): string {
  if (route) {
    const trimmed = route.trim();
    if (manifest.states[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    if (manifest.states[lower]) return lower;
    const found = Object.values(manifest.states).find(
      (s) => s.key.toLowerCase() === lower || s.url.toLowerCase().includes(lower),
    );
    if (found) return found.key;
  }
  return manifest.initialState;
}

/** Creates an initial per-player baked menu state. */
export function createMenuState(manifest: BakedSiteManifest, initialRoute?: string): BakedMenuState {
  return {
    bakedKey: resolveRouteKey(manifest, initialRoute),
    clicks: 0,
    openedTick: 0,
  };
}

/** Returns the current BakedState entry from the manifest (falls back to initialState). */
export function getBakedState(manifest: BakedSiteManifest, state: BakedMenuState): BakedState {
  return manifest.states[state.bakedKey] ?? manifest.states[manifest.initialState];
}

/** Advances menu state to `button.nextState` if present in manifest and increments click counter. */
export function applyBakedButton(manifest: BakedSiteManifest, state: BakedMenuState, button: BakedButton): BakedState {
  state.clicks += 1;
  if (button.nextState && button.nextState in manifest.states) {
    state.bakedKey = button.nextState;
  }
  return getBakedState(manifest, state);
}

/** Formats a dynamic slot item nameTag with its background mask variant tag and reset code (`§r`). */
export function formatDynTag(spec: BakedDynSlot, text: string): string {
  return `${spec.maskTag}§r${text}`;
}

/** Formats a progress bar slot item nameTag as a 20-step (5%) tag (`§b§00`..`§b§20`). */
export function formatBarTag(spec: BakedBarSlot, percent: number): string {
  const clamped = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const step = clamped <= 0 ? 0 : Math.max(1, Math.min(20, Math.round(clamped / 5)));
  const prefix = spec.barTag || '§b§';
  return `${prefix}${String(step).padStart(2, '0')}`;
}

/**
 * Builds the 27-slot container item plan for the current baked state:
 * - Slot 0: empty (avoids client first-slot interference)
 * - Slot 1: state screenshot marker (`§s§XX`)
 * - Slots 2..(2+N-1): button hitbox markers (`§h§XX<label>`)
 * - Slots 26..downward: dynamic live text slots (`§9§V§r<text>`) and progress bar slots (`§b§0<0..100>`)
 */
export function buildInvSlotPlan(
  manifest: BakedSiteManifest,
  state: BakedMenuState,
  dynValues: Record<string, string> = {},
  barValues: Record<string, number> = {},
): InvSlotSpec[] {
  const cur = getBakedState(manifest, state);
  const out: InvSlotSpec[] = [{ slot: 1, nameTag: cur.tag }];
  for (let j = 0; j < cur.buttons.length && 2 + j < 27; j++) {
    out.push({ slot: 2 + j, nameTag: `${cur.buttons[j].hitTag}${cur.buttons[j].label}` });
  }
  if (cur.dynSlots?.length) {
    for (const ds of cur.dynSlots) {
      const raw = dynValues[ds.dynId] ?? '';
      // Enforce Bedrock's 255-char ItemStack.nameTag limit safely
      const safe = raw.length > 240 ? raw.slice(0, 240) : raw;
      out.push({ slot: ds.slot, nameTag: formatDynTag(ds, safe) });
    }
  }
  if (cur.barSlots?.length) {
    for (const bs of cur.barSlots) {
      const pctVal = barValues[bs.barId] ?? 0;
      out.push({ slot: bs.slot, nameTag: formatBarTag(bs, pctVal) });
    }
  }
  return out;
}

/** Builds an ActionFormData title/body/buttons payload for the fallback `server_form.json` renderer. */
export function buildActionFormSpec(manifest: BakedSiteManifest, state: BakedMenuState): ActionFormSpec {
  const cur = getBakedState(manifest, state);
  return {
    title: `${manifest.routerTag}${cur.tag}${cur.url}`,
    body: `${cur.title} (${cur.key})`,
    buttons: cur.buttons.map((b) => ({
      text: `${b.hitTag}${b.label}`,
      action: b,
    })),
  };
}

/** Estimates visual character width (ASCII = 1, CJK/wide >= 0x2000 = 2, ignores `§x` formatting codes). */
export function textUnits(s: string): number {
  let u = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xa7) {
      i++;
      continue;
    }
    u += c < 0x2000 ? 1 : 2;
  }
  return u;
}

/** Truncates text with `…` to fit within `maxUnits` visual columns while preserving `§x` formatting codes. */
export function fitText(s: string, maxUnits: number): string {
  if (textUnits(s) <= maxUnits) return s;
  let out = '';
  let u = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xa7) {
      out += s.slice(i, i + 2);
      i++;
      continue;
    }
    const w = c < 0x2000 ? 1 : 2;
    if (u + w > maxUnits - 1) break;
    out += s[i];
    u += w;
  }
  return out + '…';
}

/** Computes a point along the player's view vector (used for positioning or parking the menu entity). */
export function spotInFront(
  head: { readonly x: number; readonly y: number; readonly z: number },
  view: { readonly x: number; readonly y: number; readonly z: number },
  distance: number,
  drop: number,
): { x: number; y: number; z: number } {
  return {
    x: head.x + view.x * distance,
    y: head.y + view.y * distance - drop,
    z: head.z + view.z * distance,
  };
}
