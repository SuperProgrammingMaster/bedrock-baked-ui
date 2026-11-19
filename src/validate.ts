// Static integrity & Bedrock constraint validator for baked UI artifacts.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BakedSiteManifest, ResolvedBakedUiConfig, ValidationIssue, ValidationResult } from './types.js';
import { readPngDimensions } from './core/png.js';

/** Validates a baked site manifest, textures, flipbook sheets, and JsonUI files against Bedrock limits. */
export function validateSiteBake(config: ResolvedBakedUiConfig): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { namespace: ns, rpDir, site } = config;
  const stats = {
    stateCount: 0,
    hitboxCount: 0,
    hitFxCount: 0,
    dynCount: 0,
    barCount: 0,
    animCount: 0,
    motionCount: 0,
    maxButtonsPerState: 0,
    maxSlotBudget: 25,
  };

  if (!fs.existsSync(site.manifestOut)) {
    issues.push({
      level: 'error',
      code: 'MANIFEST_MISSING',
      message: `Baked manifest not found: ${site.manifestOut}. Run 'baked-ui bake' first.`,
    });
    return { ok: false, issues, stats };
  }

  const manifest = JSON.parse(fs.readFileSync(site.manifestOut, 'utf8')) as BakedSiteManifest;
  stats.stateCount = manifest.stateCount ?? Object.keys(manifest.states ?? {}).length;
  stats.hitboxCount = manifest.hitboxCount ?? 0;
  stats.hitFxCount = manifest.hitFxCount ?? 0;
  stats.dynCount = manifest.dynCount ?? 0;
  stats.barCount = manifest.barCount ?? Object.keys(manifest.bars ?? {}).length;
  stats.animCount = manifest.animCount ?? Object.keys(manifest.animations ?? {}).length;
  stats.motionCount = manifest.motionCount ?? Object.keys(manifest.motions ?? {}).length;
  stats.maxSlotBudget = Math.max(0, 25 - stats.dynCount - stats.barCount);

  if (stats.stateCount <= 0) {
    issues.push({ level: 'error', code: 'NO_STATES', message: 'Manifest contains 0 states.' });
  }
  if (stats.stateCount > site.maxStates) {
    issues.push({
      level: 'error',
      code: 'TOO_MANY_STATES',
      message: `State count (${stats.stateCount}) exceeds configured maxStates (${site.maxStates}).`,
    });
  }
  if (stats.stateCount > 100) {
    issues.push({
      level: 'error',
      code: 'STATE_TAG_OVERFLOW',
      message: `State count (${stats.stateCount}) exceeds hard tag limit of 100 (§s§00..§s§99).`,
    });
  }
  if (stats.hitboxCount <= 0) {
    issues.push({ level: 'warning', code: 'NO_HITBOXES', message: 'Manifest contains 0 interactive hitboxes.' });
  }
  if (stats.hitboxCount > 100) {
    issues.push({
      level: 'error',
      code: 'HITBOX_TAG_OVERFLOW',
      message: `Unique hitbox count (${stats.hitboxCount}) exceeds hard tag limit of 100 (§h§00..§h§99).`,
    });
  }

  const expectedW = site.viewport[0] * (manifest.texScale ?? site.texScale);
  const expectedH = site.viewport[1] * (manifest.texScale ?? site.texScale);
  const seenHashes = new Map<string, string>();

  for (const st of Object.values(manifest.states ?? {})) {
    if (st.buttons.length > stats.maxButtonsPerState) {
      stats.maxButtonsPerState = st.buttons.length;
    }
    if (st.buttons.length + stats.dynCount + stats.barCount > 25) {
      issues.push({
        level: 'error',
        code: 'SLOT_OVERFLOW',
        message: `State '${st.key}' uses ${st.buttons.length} buttons + ${stats.dynCount} dyn + ${stats.barCount} bar slots = ${st.buttons.length + stats.dynCount + stats.barCount} > 25.`,
      });
    }
    for (const btn of st.buttons) {
      for (const rel of [btn.hitFxHover, btn.hitFxPress]) {
        if (rel && !fs.existsSync(path.join(rpDir, rel))) {
          issues.push({
            level: 'error',
            code: 'MISSING_HITFX_PNG',
            message: `Missing button hover/press texture for '${btn.hitId}': ${rel}`,
          });
        }
      }
    }

    const pngPath = path.join(rpDir, st.texturePng || `${st.texture}.png`);
    if (!fs.existsSync(pngPath)) {
      issues.push({ level: 'error', code: 'MISSING_STATE_PNG', message: `Missing state texture: ${pngPath}` });
      continue;
    }

    const buf = fs.readFileSync(pngPath);
    try {
      const dims = readPngDimensions(buf);
      if (dims.width !== expectedW || dims.height !== expectedH) {
        issues.push({
          level: 'error',
          code: 'STATE_PNG_DIMENSIONS',
          message: `State '${st.key}' PNG is ${dims.width}x${dims.height}, expected ${expectedW}x${expectedH}.`,
        });
      }
    } catch (err) {
      issues.push({
        level: 'error',
        code: 'INVALID_PNG',
        message: `State '${st.key}' PNG is invalid: ${(err as Error).message}`,
      });
    }

    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const prevKey = seenHashes.get(hash);
    if (prevKey) {
      issues.push({
        level: 'warning',
        code: 'DUPLICATE_STATE_PNG',
        message: `States '${prevKey}' and '${st.key}' produced pixel-identical PNGs. Check if both states are necessary.`,
      });
    } else {
      seenHashes.set(hash, st.key);
    }
  }

  for (const anim of Object.values(manifest.animations ?? {})) {
    const pngPath = path.join(rpDir, anim.texturePng);
    const jsonPath = path.join(rpDir, `${anim.texture}.json`);
    if (!fs.existsSync(pngPath)) {
      issues.push({ level: 'error', code: 'MISSING_ANIM_PNG', message: `Missing flip_book PNG: ${pngPath}` });
    } else {
      const dims = readPngDimensions(fs.readFileSync(pngPath));
      if (dims.width > site.maxSheetWidth) {
        issues.push({
          level: 'error',
          code: 'ANIM_SHEET_TOO_WIDE',
          message: `Flipbook '${anim.animKey}' width (${dims.width}px) exceeds maxSheetWidth (${site.maxSheetWidth}px).`,
        });
      }
    }
    if (!fs.existsSync(jsonPath)) {
      issues.push({ level: 'error', code: 'MISSING_ANIM_JSON', message: `Missing flip_book metadata JSON: ${jsonPath}` });
    }
  }

  for (const mot of Object.values(manifest.motions ?? {})) {
    const pngPath = path.join(rpDir, mot.texturePng);
    if (!fs.existsSync(pngPath)) {
      issues.push({ level: 'error', code: 'MISSING_MOTION_PNG', message: `Missing motion sprite PNG: ${pngPath}` });
    } else {
      try {
        readPngDimensions(fs.readFileSync(pngPath));
      } catch (err) {
        issues.push({
          level: 'error',
          code: 'INVALID_MOTION_PNG',
          message: `Motion sprite '${mot.motionKey}' PNG is invalid: ${(err as Error).message}`,
        });
      }
    }
  }

  for (const bar of Object.values(manifest.bars ?? {})) {
    const pngPath = path.join(rpDir, bar.texturePng);
    if (!fs.existsSync(pngPath)) {
      issues.push({ level: 'error', code: 'MISSING_BAR_PNG', message: `Missing progress bar PNG: ${pngPath}` });
    } else {
      try {
        readPngDimensions(fs.readFileSync(pngPath));
      } catch (err) {
        issues.push({
          level: 'error',
          code: 'INVALID_BAR_PNG',
          message: `Progress bar '${bar.barKey}' PNG is invalid: ${(err as Error).message}`,
        });
      }
    }
  }

  // JsonUI structural checks
  const uiDir = path.join(rpDir, 'ui');
  const uiDefsPath = path.join(uiDir, '_ui_defs.json');
  const nsUiPath = path.join(uiDir, `${ns}.json`);
  const chestPath = path.join(uiDir, 'chest_screen.json');
  const pocketPath = path.join(uiDir, 'pocket_containers.json');

  for (const [label, filePath] of [
    ['_ui_defs.json', uiDefsPath],
    [`${ns}.json`, nsUiPath],
    ['chest_screen.json', chestPath],
    ['pocket_containers.json', pocketPath],
  ] as const) {
    if (!fs.existsSync(filePath)) {
      issues.push({ level: 'error', code: 'MISSING_UI_JSON', message: `Missing JsonUI file: ui/${label}` });
    }
  }

  if (fs.existsSync(uiDefsPath)) {
    const defs = JSON.parse(fs.readFileSync(uiDefsPath, 'utf8')) as { ui_defs?: string[] };
    if (!defs.ui_defs?.includes(`ui/${ns}.json`)) {
      issues.push({ level: 'error', code: 'UI_DEFS_MISSING_NS', message: `ui/_ui_defs.json does not include 'ui/${ns}.json'.` });
    }
  }

  if (fs.existsSync(chestPath)) {
    const text = fs.readFileSync(chestPath, 'utf8');
    if (!text.includes(`${ns}.inv_overlay`)) {
      issues.push({ level: 'error', code: 'CHEST_MISSING_OVERLAY', message: `ui/chest_screen.json does not reference '${ns}.inv_overlay'.` });
    }
  }

  if (fs.existsSync(nsUiPath)) {
    const text = fs.readFileSync(nsUiPath, 'utf8');
    for (const st of Object.values(manifest.states ?? {})) {
      if (!text.includes(st.tag)) {
        issues.push({ level: 'error', code: 'MISSING_STATE_TAG', message: `ui/${ns}.json is missing state tag '${st.tag}' (${st.key}).` });
      }
    }
    for (const mot of Object.values(manifest.motions ?? {})) {
      for (const animName of mot.animNames ?? []) {
        if (!text.includes(`"${animName}"`)) {
          issues.push({
            level: 'error',
            code: 'MISSING_MOTION_ANIM',
            message: `ui/${ns}.json is missing native animation '${animName}' for motion '${mot.motionKey}'.`,
          });
        }
      }
    }
  }

  const ok = issues.every((i) => i.level !== 'error');
  return { ok, issues, stats };
}
