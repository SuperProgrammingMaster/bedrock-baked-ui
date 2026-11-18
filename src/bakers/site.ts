// Automated HTML/CSS/Canvas -> Minecraft Bedrock JsonUI + Entity Inventory UI Compiler.
// Zero Python/Pillow, zero Puppeteer/Playwright: uses system Chrome/Edge via CDP and pure-Node PNG tools.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  BakedAnimationSpec,
  BakedButton,
  BakedDynSlot,
  BakedSiteManifest,
  BakedState,
  ResolvedBakedUiConfig,
  SiteBakeResult,
} from '../types.js';
import { findBrowser, launchCdp } from '../core/browser.js';
import { writeMenuEntityFiles } from '../core/entity.js';
import {
  decodePng,
  encodeRgbaPng,
  imagesPixelEqual,
  optimizePngBuffer,
  resizeRgba,
  stitchHorizontal,
  type RgbaImage,
} from '../core/png.js';
import { encodeTag } from '../core/tags.js';
import { writeUtilityTextures } from '../core/textures.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (val: number, total: number): string => `${Math.round((val / total) * 100000) / 1000}%`;

interface RawHit {
  hitId: string;
  label: string;
  special: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawAnim {
  animId: string;
  animKey: string;
  frames: number;
  fps: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawDyn {
  dynId: string;
  scale: number;
  tone: string;
  align: string;
  bg: [number, number, number];
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BoxEntry {
  tag: string;
  idx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  xPct: string;
  yPct: string;
  wPct: string;
  hPct: string;
}

interface AnimSheetEntry {
  animKey: string;
  animId: string;
  frames: number;
  fps: number;
  sampleStateKey: string;
  clip: { x: number; y: number; w: number; h: number };
  frameW: number;
  frameH: number;
  texRel: string;
  texPng: string;
  texJson: string;
}

interface AnimPlacementEntry {
  idx: number;
  animKey: string;
  ax: number;
  ay: number;
  aw: number;
  ah: number;
  stateTags: string[];
  stateKeys: string[];
}

interface DynVariant {
  maskTag: string;
  color: [number, number, number];
}

interface DynRegistryEntry {
  slot: number;
  dynId: string;
  scale: number;
  align: string;
  xPct: string;
  yPct: string;
  wPct: string;
  hPct: string;
  maskXPct: string;
  maskYPct: string;
  maskWPct: string;
  maskHPct: string;
  variants: Map<string, DynVariant>;
}

interface InternalState extends BakedState {
  stateAnims: Array<{ animKey: string; xPct: string; yPct: string; wPct: string; hPct: string }>;
}

/**
 * Crawls all reachable UI states from `config.site.entry`, bakes HiDPI PNGs and flip_book spritesheets,
 * generates Bedrock JsonUI (`ui/<ns>.json`, `chest_screen.json`, `pocket_containers.json`, `server_form.json`),
 * optionally emits the invisible 27-slot container entity, and writes the runtime JSON manifest.
 */
export async function bakeSite(config: ResolvedBakedUiConfig): Promise<SiteBakeResult> {
  const { namespace: ns, entityId, rpDir, bpDir, site } = config;
  if (!fs.existsSync(site.entry)) {
    throw new Error(`Missing HTML UI source: ${site.entry}`);
  }

  const [viewW, viewH] = site.viewport;
  const sourceScale = site.sourceScale;
  const canvasW = Math.round(viewW / sourceScale);
  const canvasH = Math.round(viewH / sourceScale);
  const aspectPctX = `${Math.round((viewH / viewW) * 10000) / 100}%x`; // 56.25%x for 16:9

  const texRelBase = `textures/ui/${site.textureSubdir}`;
  const texOutDir = path.join(rpDir, 'textures', 'ui', site.textureSubdir);
  const uiOutDir = path.join(rpDir, 'ui');
  const uiDefRel = `ui/${ns}.json`;

  const browserExe = findBrowser(config.browserPath);
  const userDataDir = path.join(os.tmpdir(), `baked_ui_site_${process.pid}_${Date.now()}`);

  fs.rmSync(texOutDir, { recursive: true, force: true });
  fs.mkdirSync(texOutDir, { recursive: true });
  fs.mkdirSync(uiOutDir, { recursive: true });
  fs.mkdirSync(path.dirname(site.manifestOut), { recursive: true });

  writeUtilityTextures(texOutDir, site.theme, site.backdropColor);
  if (site.emitEntity) {
    writeMenuEntityFiles(bpDir, rpDir, entityId);
  }

  const cdp = await launchCdp(browserExe, userDataDir);
  try {
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BAKE_HEADLESS__ = true;' });
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: viewW,
      height: viewH,
      deviceScaleFactor: site.texScale,
      mobile: false,
    });

    const loaded = cdp.onceEvent('Page.loadEventFired');
    await cdp.call('Page.navigate', { url: pathToFileURL(site.entry).href });
    await loaded;

    const initialKey = await cdp.evalJs<string>('window.__BAKE__ && window.__BAKE__.getStateKey()');
    if (typeof initialKey !== 'string' || !initialKey) {
      throw new Error('window.__BAKE__.getStateKey() must return a non-empty string state key');
    }

    const queue: string[] = [initialKey];
    const visited = new Map<string, InternalState>();
    const boxRegistry = new Map<string, BoxEntry>();
    const animSheets = new Map<string, AnimSheetEntry>();
    const animPlacements = new Map<string, AnimPlacementEntry>();
    const dynRegistry = new Map<string, DynRegistryEntry>();

    const registerBox = (x: number, y: number, w: number, h: number, hx: number, hy: number, hw: number, hh: number): BoxEntry => {
      const key = `${x}_${y}_${w}_${h}`;
      let entry = boxRegistry.get(key);
      if (!entry) {
        const idx = boxRegistry.size;
        if (idx >= 100) {
          throw new Error(`Exceeded maximum unique hitbox count (100). Reuse button positions across pages.`);
        }
        entry = {
          tag: encodeTag('h', idx),
          idx,
          x,
          y,
          w,
          h,
          xPct: pct(hx, viewW),
          yPct: pct(hy, viewH),
          wPct: pct(Math.max(12, hw), viewW),
          hPct: pct(Math.max(12, hh), viewH),
        };
        boxRegistry.set(key, entry);
      }
      return entry;
    };

    while (queue.length > 0) {
      const stateKey = queue.shift()!;
      if (visited.has(stateKey)) continue;
      if (visited.size >= site.maxStates) {
        throw new Error(
          `Reachable UI states exceeded maxStates (${site.maxStates}) while visiting '${stateKey}'. ` +
            'Use additive tab state keys instead of multiplicative combinations, or raise site.maxStates (max 100).',
        );
      }

      const idx = visited.size;
      const stateTag = encodeTag('s', idx);
      const safeFile = `s_${String(idx).padStart(2, '0')}_${stateKey.replace(/[^a-z0-9_]/gi, '_')}`;

      const info = await cdp.evalJs<{
        meta: { url: string; title: string };
        hits: RawHit[];
        anims: RawAnim[];
        dyns: RawDyn[];
      }>(`
        (async () => {
          window.__BAKE__.setStateKey(${JSON.stringify(stateKey)});
          if (window.__BAKE__.setAnimFrame) window.__BAKE__.setAnimFrame(0);
          if (window.__BAKE__.whenReady) await window.__BAKE__.whenReady();
          await new Promise(r => setTimeout(r, 16));
          const meta = window.__BAKE__.getMeta ? window.__BAKE__.getMeta() : { url: ${JSON.stringify(stateKey)}, title: document.title || 'Menu' };
          const hits = [...document.querySelectorAll('[data-hit]')].map(el => {
            const r = el.getBoundingClientRect();
            return {
              hitId: el.getAttribute('data-hit'),
              label: (el.getAttribute('data-label') || el.innerText || el.getAttribute('aria-label') || el.getAttribute('data-hit') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
              special: el.getAttribute('data-special') || null,
              x: Math.round(r.left),
              y: Math.round(r.top),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          }).filter(h => h.hitId && h.w > 2 && h.h > 2);
          const anims = [...document.querySelectorAll('[data-anim]')].map(el => {
            const r = el.getBoundingClientRect();
            const animId = el.getAttribute('data-anim') || 'anim';
            const rawKey = el.getAttribute('data-anim-key') || animId;
            return {
              animId,
              animKey: rawKey.replace(/[^a-z0-9_]/gi, '_'),
              frames: Math.max(1, parseInt(el.getAttribute('data-frames') || '8', 10) || 8),
              fps: Math.max(1, parseFloat(el.getAttribute('data-fps') || '4') || 4),
              x: Math.max(0, Math.round(r.left)),
              y: Math.max(0, Math.round(r.top)),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          }).filter(a => a.w > 4 && a.h > 4);
          const dyns = [...document.querySelectorAll('[data-dyn]')].map(el => {
            const r = el.getBoundingClientRect();
            let bg = [${site.backdropColor[0]}, ${site.backdropColor[1]}, ${site.backdropColor[2]}];
            for (let cur = el; cur; cur = cur.parentElement) {
              const cs = getComputedStyle(cur).backgroundColor;
              const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(cs);
              if (m && (m[4] === undefined || parseFloat(m[4]) > 0.85)) {
                bg = [Number(m[1]), Number(m[2]), Number(m[3])];
                break;
              }
            }
            return {
              dynId: el.getAttribute('data-dyn'),
              scale: parseFloat(el.getAttribute('data-dyn-scale') || '1.0') || 1.0,
              tone: el.getAttribute('data-dyn-tone') || 'main',
              align: el.getAttribute('data-dyn-align') || 'left',
              bg,
              x: Math.max(0, Math.round(r.left)),
              y: Math.max(0, Math.round(r.top)),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          }).filter(d => d.dynId && d.w > 4 && d.h > 4);
          return { meta, hits, anims, dyns };
        })()
      `);

      const pngBuf = await cdp.capturePng();
      const outPng = optimizePngBuffer(pngBuf, site.quantize);
      fs.writeFileSync(path.join(texOutDir, `${safeFile}.png`), outPng);

      const stateAnims: InternalState['stateAnims'] = [];
      for (const a of info.anims) {
        if (!animSheets.has(a.animKey)) {
          const pxW = a.w * site.texScale;
          const pxH = a.h * site.texScale;
          const frameW = Math.max(1, Math.min(pxW, Math.floor(site.maxSheetWidth / a.frames)));
          const frameH = Math.max(1, Math.round(pxH * (frameW / pxW)));
          const texRel = `${texRelBase}/anim_${a.animKey}`;
          animSheets.set(a.animKey, {
            animKey: a.animKey,
            animId: a.animId,
            frames: a.frames,
            fps: a.fps,
            sampleStateKey: stateKey,
            clip: { x: a.x, y: a.y, w: a.w, h: a.h },
            frameW,
            frameH,
            texRel,
            texPng: `${texRel}.png`,
            texJson: `${texRel}.json`,
          });
        }
        const ax = round2(a.x / sourceScale);
        const ay = round2(a.y / sourceScale);
        const aw = round2(a.w / sourceScale);
        const ah = round2(a.h / sourceScale);
        stateAnims.push({
          animKey: a.animKey,
          xPct: pct(a.x, viewW),
          yPct: pct(a.y, viewH),
          wPct: pct(a.w, viewW),
          hPct: pct(a.h, viewH),
        });
        const pKey = `${a.animKey}@${ax},${ay},${aw},${ah}`;
        let place = animPlacements.get(pKey);
        if (!place) {
          place = {
            idx: animPlacements.size,
            animKey: a.animKey,
            ax,
            ay,
            aw,
            ah,
            stateTags: [],
            stateKeys: [],
          };
          animPlacements.set(pKey, place);
        }
        if (!place.stateTags.includes(stateTag)) {
          place.stateTags.push(stateTag);
          place.stateKeys.push(stateKey);
        }
      }

      const dynSlots: BakedDynSlot[] = [];
      for (const d of info.dyns ?? []) {
        const xPct = pct(d.x, viewW);
        const yPct = pct(d.y, viewH);
        const wPct = pct(d.w, viewW);
        const hPct = pct(d.h, viewH);
        const dKey = `${d.dynId}@${xPct},${yPct},${wPct},${hPct}`;
        let reg = dynRegistry.get(dKey);
        if (!reg) {
          const slot = 26 - dynRegistry.size;
          if (slot < 2) {
            throw new Error(`Too many unique [data-dyn] positions (exceeds 25 available chest slots)`);
          }
          reg = {
            slot,
            dynId: d.dynId,
            scale: d.scale,
            align: d.align,
            xPct,
            yPct,
            wPct,
            hPct,
            maskXPct: pct(Math.max(0, d.x - 2), viewW),
            maskYPct: pct(Math.max(0, d.y - 1), viewH),
            maskWPct: pct(d.w + 4, viewW),
            maskHPct: pct(d.h + 2, viewH),
            variants: new Map(),
          };
          dynRegistry.set(dKey, reg);
        }
        const rgbKey = d.bg.join(',');
        let variant = reg.variants.get(rgbKey);
        if (!variant) {
          const vIdx = reg.variants.size;
          if (vIdx > 9) {
            throw new Error(`Too many background variants (>10) on dynamic widget '${d.dynId}'`);
          }
          variant = {
            maskTag: `§9§${vIdx}`,
            color: [
              Math.round((d.bg[0] / 255) * 1000) / 1000,
              Math.round((d.bg[1] / 255) * 1000) / 1000,
              Math.round((d.bg[2] / 255) * 1000) / 1000,
            ],
          };
          reg.variants.set(rgbKey, variant);
        }
        dynSlots.push({
          slot: reg.slot,
          dynId: d.dynId,
          maskTag: variant.maskTag,
          tone: d.tone,
        });
      }

      const buttons: BakedButton[] = [];
      for (const h of info.hits) {
        const bx = Math.max(0, Math.min(canvasW - 4, Math.round(h.x / sourceScale)));
        const by = Math.max(0, Math.min(canvasH - 4, Math.round(h.y / sourceScale)));
        const bw = Math.max(6, Math.min(canvasW - bx, Math.round(h.w / sourceScale)));
        const bh = Math.max(6, Math.min(canvasH - by, Math.round(h.h / sourceScale)));
        const box = registerBox(bx, by, bw, bh, h.x, h.y, h.w, h.h);

        let nextState = stateKey;
        if (!h.special) {
          nextState = await cdp.evalJs<string>(`
            (() => {
              window.__BAKE__.setStateKey(${JSON.stringify(stateKey)});
              return window.__BAKE__.clickHit(${JSON.stringify(h.hitId)});
            })()
          `);
          if (typeof nextState === 'string' && nextState && !visited.has(nextState) && !queue.includes(nextState)) {
            queue.push(nextState);
          }
        }

        buttons.push({
          hitId: h.hitId,
          hitTag: box.tag,
          label: h.label || h.hitId,
          x: bx,
          y: by,
          w: bw,
          h: bh,
          xPct: box.xPct,
          yPct: box.yPct,
          wPct: box.wPct,
          hPct: box.hPct,
          nextState,
          special: h.special,
        });
      }

      visited.set(stateKey, {
        key: stateKey,
        index: idx,
        tag: stateTag,
        texture: `${texRelBase}/${safeFile}`,
        texturePng: `${texRelBase}/${safeFile}.png`,
        url: info.meta.url,
        title: info.meta.title,
        buttons,
        dynSlots,
        stateAnims,
      });
    }

    // Bake flip_book animation sprite sheets in pure Node (no Python/Pillow!)
    const animSheetsArr = [...animSheets.values()];
    const animPlacementsArr = [...animPlacements.values()];
    for (const sheet of animSheetsArr) {
      await cdp.evalJs(`
        (async () => {
          window.__BAKE__.setStateKey(${JSON.stringify(sheet.sampleStateKey)});
          if (window.__BAKE__.whenReady) await window.__BAKE__.whenReady();
        })()
      `);
      const frames: RgbaImage[] = [];
      for (let f = 0; f < sheet.frames; f++) {
        const phase = f / sheet.frames;
        await cdp.evalJs(`
          (async () => {
            if (window.__BAKE__.setAnimFrame) window.__BAKE__.setAnimFrame(${phase});
            await new Promise(r => setTimeout(r, 8));
          })()
        `);
        const clipBuf = await cdp.capturePng({
          x: sheet.clip.x,
          y: sheet.clip.y,
          width: sheet.clip.w,
          height: sheet.clip.h,
          scale: 1,
        });
        let img = decodePng(clipBuf);
        if (img.width !== sheet.frameW || img.height !== sheet.frameH) {
          img = resizeRgba(img, sheet.frameW, sheet.frameH);
        }
        frames.push(img);
      }

      if (frames.length >= 2 && imagesPixelEqual(frames[0], frames[1])) {
        throw new Error(
          `Animation '${sheet.animKey}' frame 0 and frame 1 are pixel-identical. Ensure window.__BAKE__.setAnimFrame(phase) updates pixels.`,
        );
      }

      const stitched = stitchHorizontal(frames);
      const rawSheetPng = encodeRgbaPng(stitched, { level: 7 });
      const finalSheetPng = optimizePngBuffer(rawSheetPng, site.quantize);
      fs.writeFileSync(path.join(rpDir, sheet.texPng), finalSheetPng);
      fs.writeFileSync(
        path.join(rpDir, sheet.texJson),
        JSON.stringify({ base_size: [sheet.frameW * sheet.frames, sheet.frameH] }) + '\n',
      );
    }

    const statesArr = [...visited.values()];
    const boxesArr = [...boxRegistry.values()];

    // Build JsonUI definitions
    const flipBooks: Record<string, unknown> = {};
    for (const sheet of animSheetsArr) {
      flipBooks[`fb_${sheet.animKey}`] = {
        anim_type: 'flip_book',
        initial_uv: [0, 0],
        frame_count: sheet.frames,
        frame_step: sheet.frameW,
        fps: sheet.fps,
        reversible: false,
        easing: 'linear',
      };
    }

    const makeStateAnims = (stateAnims: InternalState['stateAnims']) =>
      stateAnims.map((a, ai) => {
        const sheet = animSheets.get(a.animKey)!;
        return {
          [`anim_${ai}`]: {
            type: 'image',
            texture: sheet.texRel,
            keep_ratio: false,
            anchor_from: 'top_left',
            anchor_to: 'top_left',
            offset: [a.xPct, a.yPct],
            size: [a.wPct, a.hPct],
            uv_size: [sheet.frameW, sheet.frameH],
            uv: `@${ns}.fb_${sheet.animKey}`,
            disable_anim_fast_forward: true,
            layer: 5,
          },
        };
      });

    const dynSlotList = [...dynRegistry.values()].sort((a, b) => a.slot - b.slot);
    const minDynSlot = dynSlotList.length > 0 ? dynSlotList[0].slot : 27;

    const invSlotMap = new Map<
      string,
      { slotIdx: number; hitTag: string; xPct: string; yPct: string; wPct: string; hPct: string; isExit: boolean }
    >();

    for (const s of statesArr) {
      s.buttons.forEach((b, j) => {
        const slotIdx = 2 + j;
        if (slotIdx >= minDynSlot) {
          throw new Error(
            `State '${s.key}' has ${s.buttons.length} buttons which overlap ${dynSlotList.length} dynamic slots ` +
              `(slot ${slotIdx} >= ${minDynSlot}; max buttons per page = ${minDynSlot - 2}).`,
          );
        }
        const isExit = b.special === 'close';
        const key = `${slotIdx}_${b.hitTag}_${isExit ? 1 : 0}`;
        if (!invSlotMap.has(key)) {
          invSlotMap.set(key, {
            slotIdx,
            hitTag: b.hitTag,
            xPct: b.xPct,
            yPct: b.yPct,
            wPct: b.wPct,
            hPct: b.hPct,
            isExit,
          });
        }
      });
    }

    const slotGroups = new Map<number, Array<{ slotIdx: number; hitTag: string; xPct: string; yPct: string; wPct: string; hPct: string; isExit: boolean }>>();
    for (const h of invSlotMap.values()) {
      const list = slotGroups.get(h.slotIdx) ?? [];
      list.push(h);
      slotGroups.set(h.slotIdx, list);
    }

    const uiJson: Record<string, unknown> = {
      namespace: ns,
      ...flipBooks,

      empty_cell: { type: 'panel', size: [18, 18] },

      inv_hitbox_btn: {
        type: 'button',
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        offset: '$hoff',
        size: '$hsize',
        layer: 8,
        default_control: 'default',
        hover_control: 'hover',
        pressed_control: 'pressed',
        sound_name: 'random.click',
        sound_volume: 0.6,
        sound_pitch: 1.0,
        controls: [
          { default: { type: 'image', texture: `${texRelBase}/hit_idle`, size: ['100%', '100%'], layer: 8 } },
          { hover: { type: 'image', texture: `${texRelBase}/hit_hover`, size: ['100%', '100%'], layer: 9 } },
          { pressed: { type: 'image', texture: `${texRelBase}/hit_press`, size: ['100%', '100%'], layer: 9 } },
        ],
        button_mappings: [
          { from_button_id: 'button.menu_select', to_button_id: 'button.container_auto_place', mapping_type: 'pressed', consume_event: false },
          { from_button_id: 'button.menu_ok', to_button_id: 'button.container_auto_place', mapping_type: 'focused', consume_event: false },
        ],
        bindings: [
          { binding_type: 'collection_details', binding_collection_name: 'container_items' },
          {
            binding_name: '#hover_text',
            binding_type: 'collection',
            binding_collection_name: 'container_items',
            binding_condition: 'always',
          },
          {
            binding_type: 'view',
            source_property_name: '(not ((#hover_text - $htag) = #hover_text))',
            target_property_name: '#visible',
          },
        ],
      },

      [`inv_exit_btn@${ns}.inv_hitbox_btn`]: {
        button_mappings: [
          { from_button_id: 'button.menu_select', to_button_id: 'button.menu_exit', mapping_type: 'pressed' },
          { from_button_id: 'button.menu_ok', to_button_id: 'button.menu_exit', mapping_type: 'focused' },
        ],
      },

      inv_window: {
        type: 'panel',
        size: ['100%', aspectPctX],
        anchor_from: 'center',
        anchor_to: 'center',
        layer: 2,
        controls: [
          {
            inv_stack: {
              type: 'stack_panel',
              orientation: 'vertical',
              anchor_from: 'top_left',
              anchor_to: 'top_left',
              size: ['100%', '100%'],
              clips_children: false,
              collection_name: 'container_items',
              controls: [
                {
                  slot_01_state: {
                    type: 'panel',
                    size: ['100%', 0],
                    clips_children: false,
                    collection_index: 1,
                    controls: statesArr.map((s) => ({
                      [`stpanel_${String(s.index).padStart(2, '0')}`]: {
                        type: 'panel',
                        size: ['100%', aspectPctX],
                        anchor_from: 'top_left',
                        anchor_to: 'top_left',
                        bindings: [
                          {
                            binding_name: '#hover_text',
                            binding_type: 'collection',
                            binding_collection_name: 'container_items',
                            binding_condition: 'always',
                          },
                          {
                            binding_type: 'view',
                            source_property_name: `(not ((#hover_text - '${s.tag}') = #hover_text))`,
                            target_property_name: '#visible',
                          },
                        ],
                        controls: [
                          {
                            bg: {
                              type: 'image',
                              texture: s.texture,
                              keep_ratio: false,
                              size: ['100%', '100%'],
                              anchor_from: 'top_left',
                              anchor_to: 'top_left',
                              layer: 3,
                            },
                          },
                          ...makeStateAnims(s.stateAnims),
                        ],
                      },
                    })),
                  },
                },
                ...[...slotGroups.entries()]
                  .sort((a, b) => a[0] - b[0])
                  .map(([slotIdx, list]) => ({
                    [`slot_${String(slotIdx).padStart(2, '0')}`]: {
                      type: 'panel',
                      size: ['100%', 0],
                      clips_children: false,
                      collection_index: slotIdx,
                      controls: [
                        {
                          hit_frame: {
                            type: 'panel',
                            size: ['100%', aspectPctX],
                            anchor_from: 'top_left',
                            anchor_to: 'top_left',
                            controls: list.map((h, i) => ({
                              [`ih_${String(i).padStart(2, '0')}@${ns}.${h.isExit ? 'inv_exit_btn' : 'inv_hitbox_btn'}`]: {
                                $htag: h.hitTag,
                                $hoff: [h.xPct, h.yPct],
                                $hsize: [h.wPct, h.hPct],
                              },
                            })),
                          },
                        },
                      ],
                    },
                  })),
                ...dynSlotList.map((d) => ({
                  [`slot_${String(d.slot).padStart(2, '0')}`]: {
                    type: 'panel',
                    size: ['100%', 0],
                    clips_children: false,
                    collection_index: d.slot,
                    controls: [
                      {
                        dyn_frame: {
                          type: 'panel',
                          size: ['100%', aspectPctX],
                          anchor_from: 'top_left',
                          anchor_to: 'top_left',
                          controls: [
                            ...[...d.variants.values()].map((v, vi) => ({
                              [`mask_${vi}`]: {
                                type: 'image',
                                texture: `${texRelBase}/white_fill`,
                                keep_ratio: false,
                                color: v.color,
                                anchor_from: 'top_left',
                                anchor_to: 'top_left',
                                offset: [d.maskXPct, d.maskYPct],
                                size: [d.maskWPct, d.maskHPct],
                                layer: 5,
                                bindings: [
                                  {
                                    binding_name: '#hover_text',
                                    binding_type: 'collection',
                                    binding_collection_name: 'container_items',
                                    binding_condition: 'always',
                                  },
                                  {
                                    binding_type: 'view',
                                    source_property_name: `(not ((#hover_text - '${v.maskTag}') = #hover_text))`,
                                    target_property_name: '#visible',
                                  },
                                ],
                              },
                            })),
                            {
                              dyn_label: {
                                type: 'label',
                                text: '#hover_text',
                                color: [1, 1, 1],
                                font_type: 'smooth',
                                font_size: 'normal',
                                font_scale_factor: d.scale,
                                shadow: false,
                                localize: false,
                                text_alignment: d.align,
                                anchor_from: 'top_left',
                                anchor_to: 'top_left',
                                offset: [d.xPct, d.yPct],
                                size: [d.wPct, d.hPct],
                                layer: 6,
                                bindings: [
                                  {
                                    binding_name: '#hover_text',
                                    binding_type: 'collection',
                                    binding_collection_name: 'container_items',
                                    binding_condition: 'always',
                                  },
                                  {
                                    binding_type: 'view',
                                    source_property_name: "(not ((#hover_text - '§r') = #hover_text))",
                                    target_property_name: '#visible',
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                })),
              ],
            },
          },
        ],
      },

      inv_overlay: {
        type: 'panel',
        size: ['100%', '100%'],
        layer: 1,
        $bui_title: '$container_title',
        controls: [
          {
            host: {
              type: 'panel',
              size: ['100%', '100%'],
              ignored: `(not ($bui_title = '${site.invTitleTag}'))`,
              controls: [
                {
                  entity_ui_hide_vanilla: {
                    type: 'panel',
                    size: [0, 0],
                    property_bag: { '#entity_ui_vanilla_visible': false },
                  },
                },
                {
                  cover: {
                    type: 'panel',
                    size: ['100%', '100%'],
                    layer: 1,
                    controls: [
                      {
                        screen_bg: {
                          type: 'image',
                          texture: `${texRelBase}/screen_fill`,
                          keep_ratio: false,
                          size: ['100%', '100%'],
                          layer: 0,
                        },
                      },
                      {
                        sync_grid: {
                          type: 'grid',
                          size: [162, 54],
                          layer: 1,
                          grid_rescaling_type: 'horizontal',
                          maximum_grid_items: 27,
                          collection_name: 'container_items',
                          grid_item_template: `${ns}.empty_cell`,
                        },
                      },
                      { [`window@${ns}.inv_window`]: { layer: 2 } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    };

    if (site.emitActionForm) {
      uiJson['hitbox_btn@common.button'] = {
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        offset: '$hoff',
        size: '$hsize',
        layer: 12,
        $pressed_button_name: 'button.form_button_click',
        $border_visible: false,
        default_control: 'default',
        hover_control: 'hover',
        pressed_control: 'pressed',
        controls: [
          { default: { type: 'image', texture: `${texRelBase}/hit_idle`, size: ['100%', '100%'], layer: 12 } },
          { hover: { type: 'image', texture: `${texRelBase}/hit_hover`, size: ['100%', '100%'], layer: 13 } },
          { pressed: { type: 'image', texture: `${texRelBase}/hit_press`, size: ['100%', '100%'], layer: 13 } },
        ],
        bindings: [
          { binding_name: '#null', binding_type: 'collection', binding_condition: 'none', binding_collection_name: 'form_buttons' },
          { binding_name: '#null', binding_type: 'collection_details', binding_collection_name: 'form_buttons' },
          { binding_name: '#form_button_text', binding_type: 'collection', binding_collection_name: 'form_buttons' },
          {
            binding_type: 'view',
            source_property_name: '(not ((#form_button_text - $htag) = #form_button_text))',
            target_property_name: '#visible',
          },
        ],
      };

      uiJson.hit_slot = {
        type: 'panel',
        size: ['100%', 0],
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        clips_children: false,
        controls: [
          {
            hit_frame: {
              type: 'panel',
              size: ['100%', aspectPctX],
              anchor_from: 'top_left',
              anchor_to: 'top_left',
              controls: boxesArr.map((b) => ({
                [`hb_${String(b.idx).padStart(2, '0')}@${ns}.hitbox_btn`]: {
                  $htag: b.tag,
                  $hoff: [b.xPct, b.yPct],
                  $hsize: [b.wPct, b.hPct],
                },
              })),
            },
          },
        ],
      };

      uiJson.hitboxes_layer = {
        type: 'stack_panel',
        orientation: 'vertical',
        anchor_from: 'top_left',
        anchor_to: 'top_left',
        size: ['100%', '100%'],
        clips_children: false,
        layer: 10,
        collection_name: 'form_buttons',
        factory: {
          name: 'buttons',
          control_ids: { button: `${ns}.hit_slot` },
        },
        bindings: [{ binding_name: '#form_button_contents', binding_name_override: '#collection_length' }],
      };

      uiJson.browser_window = {
        type: 'panel',
        size: ['100%', aspectPctX],
        anchor_from: 'center',
        anchor_to: 'center',
        layer: 5,
        bindings: [
          { binding_name: '#title_text', binding_type: 'global' },
          {
            binding_type: 'view',
            source_property_name: `(not ((#title_text - '${site.routerTag}') = #title_text))`,
            target_property_name: '#visible',
          },
        ],
        controls: [
          {
            backdrop: {
              type: 'image',
              texture: `${texRelBase}/screen_fill`,
              keep_ratio: false,
              size: ['100%', '100%'],
              layer: 1,
            },
          },
          ...statesArr.map((s) => ({
            [`fpanel_${String(s.index).padStart(2, '0')}`]: {
              type: 'panel',
              size: ['100%', '100%'],
              anchor_from: 'top_left',
              anchor_to: 'top_left',
              bindings: [
                { binding_name: '#title_text', binding_type: 'global' },
                {
                  binding_type: 'view',
                  source_property_name: `(not ((#title_text - '${s.tag}') = #title_text))`,
                  target_property_name: '#visible',
                },
              ],
              controls: [
                {
                  bg: {
                    type: 'image',
                    texture: s.texture,
                    keep_ratio: false,
                    size: ['100%', '100%'],
                    anchor_from: 'top_left',
                    anchor_to: 'top_left',
                    layer: 3,
                  },
                },
                ...makeStateAnims(s.stateAnims),
              ],
            },
          })),
          { [`hitboxes@${ns}.hitboxes_layer`]: {} },
        ],
      };

      const serverFormJson = {
        namespace: 'server_form',
        long_form: {
          type: 'panel',
          controls: [
            {
              'vanilla_long_form@common_dialogs.main_panel_no_buttons': {
                $title_panel: 'common_dialogs.standard_title_label',
                $title_size: ['100% - 15px', 10],
                $title_max_size: ['100% - 15px', 10],
                size: [225, 200],
                $text_name: '#title_text',
                $title_text_binding_type: 'none',
                $child_control: 'server_form.long_form_panel',
                layer: 2,
                bindings: [
                  { binding_name: '#title_text' },
                  {
                    binding_type: 'view',
                    source_property_name: `((#title_text - '${site.routerTag}') = #title_text)`,
                    target_property_name: '#visible',
                  },
                ],
              },
            },
            { [`${ns}_browser@${ns}.browser_window`]: {} },
          ],
        },
      };

      fs.writeFileSync(path.join(uiOutDir, 'server_form.json'), JSON.stringify(serverFormJson, null, 2) + '\n');
    }

    const hideVanillaMod = {
      array_name: 'bindings',
      operation: 'insert_back',
      value: [
        {
          binding_type: 'view',
          source_control_name: 'entity_ui_hide_vanilla',
          source_property_name: '#entity_ui_vanilla_visible',
          target_property_name: '#visible',
          binding_condition: 'always',
        },
      ],
    };

    const chestScreenJson = {
      namespace: 'chest',
      small_chest_panel: {
        modifications: [
          {
            array_name: 'controls',
            operation: 'insert_back',
            value: [{ [`${ns}_overlay@${ns}.inv_overlay`]: {} }],
          },
        ],
      },
      'small_chest_panel/root_panel': { modifications: [hideVanillaMod] },
      'small_chest_panel/container_gamepad_helpers': { modifications: [hideVanillaMod] },
    };

    const pocketContainersJson = {
      namespace: 'pocket_containers',
      panel: {
        modifications: [
          {
            array_name: 'controls',
            operation: 'insert_back',
            value: [{ [`${ns}_overlay@${ns}.inv_overlay`]: {} }],
          },
        ],
      },
      header_area: { modifications: [hideVanillaMod] },
      background_panel: { modifications: [hideVanillaMod] },
      half_screen: { modifications: [hideVanillaMod] },
    };

    const uiDefsPath = path.join(uiOutDir, '_ui_defs.json');
    const existingDefs: string[] = fs.existsSync(uiDefsPath)
      ? (JSON.parse(fs.readFileSync(uiDefsPath, 'utf8')).ui_defs ?? [])
      : [];
    const mergedDefs = [...new Set([uiDefRel, ...existingDefs])].filter(
      (p) => p === uiDefRel || fs.existsSync(path.join(rpDir, p)),
    );

    fs.writeFileSync(uiDefsPath, JSON.stringify({ ui_defs: mergedDefs }, null, 2) + '\n');
    fs.writeFileSync(path.join(uiOutDir, 'chest_screen.json'), JSON.stringify(chestScreenJson, null, 2) + '\n');
    fs.writeFileSync(path.join(uiOutDir, 'pocket_containers.json'), JSON.stringify(pocketContainersJson, null, 2) + '\n');
    fs.writeFileSync(path.join(uiOutDir, `${ns}.json`), JSON.stringify(uiJson, null, 2) + '\n');

    const statesMap: Record<string, BakedState> = {};
    for (const s of statesArr) {
      const { stateAnims: _discard, ...pubState } = s;
      statesMap[s.key] = pubState;
    }

    const animationsMap: Record<string, BakedAnimationSpec> = {};
    for (const sheet of animSheetsArr) {
      animationsMap[sheet.animKey] = {
        animKey: sheet.animKey,
        animId: sheet.animId,
        flipBook: `fb_${sheet.animKey}`,
        texture: sheet.texRel,
        texturePng: sheet.texPng,
        frames: sheet.frames,
        fps: sheet.fps,
        frameW: sheet.frameW,
        frameH: sheet.frameH,
        sheetW: sheet.frameW * sheet.frames,
        sheetH: sheet.frameH,
        placements: animPlacementsArr
          .filter((p) => p.animKey === sheet.animKey)
          .map((p) => ({ x: p.ax, y: p.ay, w: p.aw, h: p.ah, states: p.stateKeys })),
      };
    }

    const manifest: BakedSiteManifest = {
      version: 1,
      namespace: ns,
      entityId,
      routerTag: site.routerTag,
      invTitleTag: site.invTitleTag,
      viewport: [canvasW, canvasH],
      sourceScale,
      texScale: site.texScale,
      initialState: initialKey,
      hitboxCount: boxesArr.length,
      stateCount: statesArr.length,
      animCount: animSheetsArr.length,
      dynCount: dynSlotList.length,
      animations: animationsMap,
      states: statesMap,
    };
    fs.writeFileSync(site.manifestOut, JSON.stringify(manifest, null, 2) + '\n');

    const hashes = new Set<string>();
    let totalBytes = 0;
    for (const s of statesArr) {
      const buf = fs.readFileSync(path.join(rpDir, s.texturePng));
      totalBytes += buf.length;
      hashes.add(crypto.createHash('sha256').update(buf).digest('hex'));
    }
    for (const sh of animSheetsArr) {
      totalBytes += fs.statSync(path.join(rpDir, sh.texPng)).size;
    }

    return {
      manifestPath: site.manifestOut,
      manifest,
      stateCount: statesArr.length,
      uniquePngs: hashes.size,
      hitboxCount: boxesArr.length,
      animCount: animSheetsArr.length,
      dynCount: dynSlotList.length,
      totalBytes,
    };
  } finally {
    await cdp.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
    } catch {}
  }
}
