// Configuration loader and validator for bedrock-baked-ui.

import fs from 'node:fs';
import path from 'node:path';
import type { BakedUiConfig, HitboxTheme, HudChannel, ResolvedBakedUiConfig } from './types.js';
import { DEFAULT_HUD_OFF_TAG, DEFAULT_HUD_TAG, DEFAULT_INV_TITLE_TAG, DEFAULT_ROUTER_TAG } from './core/tags.js';

export const DEFAULT_CONFIG_FILENAME = 'baked-ui.config.json';

const VALID_THEMES = new Set<HitboxTheme>(['gold', 'classic', 'neon', 'minimal']);
const VALID_CHANNELS = new Set<HudChannel>(['subtitle', 'title']);

function resolveRel(rootDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(rootDir, p);
}

/** Resolves a partial user config into absolute paths and validated defaults. */
export function resolveConfig(raw: BakedUiConfig = {}, rootDir = process.cwd()): ResolvedBakedUiConfig {
  const namespace = raw.namespace ?? 'baked_ui';
  if (!/^[a-z][a-z0-9_]*$/i.test(namespace)) {
    throw new Error(`Invalid namespace '${namespace}'. Use alphanumeric characters and underscores starting with a letter.`);
  }

  const entityId = raw.entityId ?? `${namespace}:menu`;
  if (!/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/i.test(entityId)) {
    throw new Error(`Invalid entityId '${entityId}'. Expected '<namespace>:<name>'.`);
  }

  const rpDir = resolveRel(rootDir, raw.rpDir ?? 'packs/rp');
  const bpDir = resolveRel(rootDir, raw.bpDir ?? 'packs/bp');

  const s = raw.site ?? {};
  const theme: HitboxTheme = s.theme ?? 'gold';
  if (!VALID_THEMES.has(theme)) {
    throw new Error(`Invalid site.theme '${theme}'. Expected one of: gold, classic, neon, minimal.`);
  }

  const siteViewport: [number, number] = s.viewport ?? [1056, 594];
  const sourceScale = Math.max(1, Math.round(s.sourceScale ?? 3));
  const texScale = Math.max(1, Math.min(3, Number(process.env.BAKED_UI_SCALE || s.texScale || 2)));
  const maxStates = Math.max(1, Math.min(100, Math.round(s.maxStates ?? 64)));
  const maxSheetWidth = Math.max(256, Math.round(s.maxSheetWidth ?? 2800));
  const quantize = process.env.BAKED_UI_QUANT === '0' ? false : (s.quantize ?? true);

  const h = raw.hud ?? {};
  const channel: HudChannel = h.channel ?? 'subtitle';
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`Invalid hud.channel '${channel}'. Expected 'subtitle' or 'title'.`);
  }
  const hudOffTag = h.hudOffTag ?? DEFAULT_HUD_OFF_TAG;
  if (!hudOffTag.trim()) {
    throw new Error('hud.hudOffTag must be a non-empty string (empty setTitle cannot clear Bedrock HUD cache).');
  }

  return {
    rootDir,
    namespace,
    entityId,
    rpDir,
    bpDir,
    browserPath: raw.browserPath,
    site: {
      entry: resolveRel(rootDir, s.entry ?? 'ui-src/index.html'),
      viewport: siteViewport,
      sourceScale,
      texScale,
      maxStates,
      maxSheetWidth,
      theme,
      backdropColor: s.backdropColor ?? [28, 19, 10],
      quantize,
      emitEntity: s.emitEntity ?? true,
      emitActionForm: s.emitActionForm ?? true,
      routerTag: s.routerTag ?? DEFAULT_ROUTER_TAG,
      invTitleTag: s.invTitleTag ?? DEFAULT_INV_TITLE_TAG,
      textureSubdir: s.textureSubdir ?? 'baked_ui',
      manifestOut: resolveRel(rootDir, s.manifestOut ?? path.join(raw.bpDir ?? 'packs/bp', 'src/generated/baked_site.json')),
    },
    hud: {
      entry: resolveRel(rootDir, h.entry ?? 'ui-src/hud.html'),
      viewport: h.viewport ?? [1056, 594],
      texScale: Math.max(1, Math.min(4, Number(process.env.BAKED_HUD_SCALE || h.texScale || 3))),
      maxSheetWidth: Math.max(256, Math.round(h.maxSheetWidth ?? 2800)),
      hudTag: h.hudTag ?? DEFAULT_HUD_TAG,
      hudOffTag,
      channel,
      textureSubdir: h.textureSubdir ?? 'baked_hud',
      manifestOut: resolveRel(rootDir, h.manifestOut ?? path.join(raw.bpDir ?? 'packs/bp', 'src/generated/baked_hud.json')),
    },
  };
}

/** Loads `baked-ui.config.json` from the given path or directory. */
export function loadConfig(configPathOrDir?: string): ResolvedBakedUiConfig {
  let target = configPathOrDir ? path.resolve(configPathOrDir) : path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, DEFAULT_CONFIG_FILENAME);
  }
  if (!fs.existsSync(target)) {
    throw new Error(`Config file not found: ${target}. Run 'baked-ui init' to create one.`);
  }
  const raw = JSON.parse(fs.readFileSync(target, 'utf8')) as BakedUiConfig;
  return resolveConfig(raw, path.dirname(target));
}
