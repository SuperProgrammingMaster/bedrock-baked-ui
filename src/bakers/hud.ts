// [EXPERIMENTAL] Automated HTML/CSS/Canvas -> Bedrock Transparent HUD Compiler.
// Captures transparent [data-hud-widget] cards, stitches [data-anim] flipbooks (pure Node),
// extracts [data-hud-dyn] byte-sliced live labels over #hud_subtitle_text_string or #hud_title_text_string,
// and emits ui/<ns>_hud.json + ui/hud_screen.json + manifest JSON.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  BakedHudAnim,
  BakedHudField,
  BakedHudManifest,
  BakedHudWidget,
  HudBakeResult,
  ResolvedBakedUiConfig,
} from '../types.js';
import { findBrowser, launchCdp } from '../core/browser.js';
import {
  decodePng,
  encodeRgbaPng,
  imagesPixelEqual,
  resizeRgba,
  stitchHorizontal,
  type RgbaImage,
} from '../core/png.js';

const pct = (val: number, total: number): string => `${Math.round((val / total) * 100000) / 1000}%`;

interface RawHudWidget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawHudAnim {
  animId: string;
  animKey: string;
  frames: number;
  fps: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RawHudDyn {
  dynId: string;
  len: number;
  tail: boolean;
  scale: number;
  align: string;
  color: [number, number, number];
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * [Experimental] Compiles a transparent HTML HUD document into Bedrock JsonUI (`ui/<ns>_hud.json`, `ui/hud_screen.json`).
 */
export async function bakeHud(config: ResolvedBakedUiConfig): Promise<HudBakeResult> {
  const { namespace: ns, rpDir, hud } = config;
  if (!fs.existsSync(hud.entry)) {
    throw new Error(`Missing HUD HTML source: ${hud.entry}`);
  }

  const [viewW, viewH] = hud.viewport;
  const aspectPctX = `${Math.round((viewH / viewW) * 10000) / 100}%x`;
  const texRelBase = `textures/ui/${hud.textureSubdir}`;
  const texOutDir = path.join(rpDir, 'textures', 'ui', hud.textureSubdir);
  const uiOutDir = path.join(rpDir, 'ui');
  const hudNs = `${ns}_hud`;
  const hudUiRel = `ui/${hudNs}.json`;

  const browserExe = findBrowser(config.browserPath);
  const userDataDir = path.join(os.tmpdir(), `baked_ui_hud_${process.pid}_${Date.now()}`);

  fs.rmSync(texOutDir, { recursive: true, force: true });
  fs.mkdirSync(texOutDir, { recursive: true });
  fs.mkdirSync(uiOutDir, { recursive: true });
  fs.mkdirSync(path.dirname(hud.manifestOut), { recursive: true });

  const cdp = await launchCdp(browserExe, userDataDir);
  try {
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__BAKE_HEADLESS__ = true;' });
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: viewW,
      height: viewH,
      deviceScaleFactor: hud.texScale,
      mobile: false,
    });
    await cdp.call('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });

    const loaded = cdp.onceEvent('Page.loadEventFired');
    await cdp.call('Page.navigate', { url: pathToFileURL(hud.entry).href });
    await loaded;

    const info = await cdp.evalJs<{
      widgets: RawHudWidget[];
      anims: RawHudAnim[];
      dyns: RawHudDyn[];
    }>(`
      (async () => {
        if (window.__BAKE__ && window.__BAKE__.setAnimFrame) window.__BAKE__.setAnimFrame(0);
        if (window.__BAKE__ && window.__BAKE__.whenReady) await window.__BAKE__.whenReady();
        await new Promise(r => setTimeout(r, 20));
        const widgets = [...document.querySelectorAll('[data-hud-widget]')].map(el => {
          const r = el.getBoundingClientRect();
          return {
            id: (el.getAttribute('data-hud-widget') || 'widget').replace(/[^a-z0-9_]/gi, '_'),
            x: Math.max(0, Math.round(r.left)),
            y: Math.max(0, Math.round(r.top)),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }).filter(w => w.w > 4 && w.h > 4);
        const anims = [...document.querySelectorAll('[data-anim]')].map(el => {
          const r = el.getBoundingClientRect();
          const animId = el.getAttribute('data-anim') || 'anim';
          const rawKey = el.getAttribute('data-anim-key') || animId;
          return {
            animId,
            animKey: rawKey.replace(/[^a-z0-9_]/gi, '_'),
            frames: Math.max(1, parseInt(el.getAttribute('data-frames') || '12', 10) || 12),
            fps: Math.max(1, parseFloat(el.getAttribute('data-fps') || '8') || 8),
            x: Math.max(0, Math.round(r.left)),
            y: Math.max(0, Math.round(r.top)),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }).filter(a => a.w > 4 && a.h > 4);
        const dyns = [...document.querySelectorAll('[data-hud-dyn]')].map(el => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(cs.color);
          const color = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [248, 250, 252];
          return {
            dynId: el.getAttribute('data-hud-dyn'),
            len: Math.max(4, parseInt(el.getAttribute('data-dyn-len') || '16', 10) || 16),
            tail: el.getAttribute('data-dyn-tail') === '1',
            scale: parseFloat(el.getAttribute('data-dyn-scale') || '1.0') || 1.0,
            align: el.getAttribute('data-dyn-align') || 'left',
            color,
            x: Math.max(0, Math.round(r.left)),
            y: Math.max(0, Math.round(r.top)),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }).filter(d => d.dynId && d.w > 4 && d.h > 4);
        return { widgets, anims, dyns };
      })()
    `);

    // Hide dynamic placeholder text & animations while capturing clean widget chrome PNGs
    await cdp.evalJs(`
      (() => {
        document.querySelectorAll('[data-hud-dyn]').forEach(el => { el.style.visibility = 'hidden'; });
        document.querySelectorAll('[data-anim]').forEach(el => { el.style.visibility = 'hidden'; });
      })()
    `);

    const widgetMeta: BakedHudWidget[] = [];
    for (const w of info.widgets) {
      const pngBuf = await cdp.capturePng({ x: w.x, y: w.y, width: w.w, height: w.h, scale: 1 });
      const texRel = `${texRelBase}/w_${w.id}`;
      const texPng = `${texRel}.png`;
      fs.writeFileSync(path.join(rpDir, texPng), pngBuf);
      widgetMeta.push({
        id: w.id,
        texture: texRel,
        texturePng: texPng,
        width: w.w * hud.texScale,
        height: w.h * hud.texScale,
        xPct: pct(w.x, viewW),
        yPct: pct(w.y, viewH),
        wPct: pct(w.w, viewW),
        hPct: pct(w.h, viewH),
      });
    }

    // Capture transparent animation frames independently and stitch horizontally in pure Node
    const animMeta: BakedHudAnim[] = [];
    if (info.anims.length > 0) {
      await cdp.evalJs(`
        (() => {
          document.querySelectorAll('[data-hud-widget]').forEach(el => { el.style.visibility = 'hidden'; });
          document.querySelectorAll('[data-anim]').forEach(el => { el.style.visibility = 'visible'; });
        })()
      `);

      for (const a of info.anims) {
        const pxW = a.w * hud.texScale;
        const pxH = a.h * hud.texScale;
        const frameW = Math.max(1, Math.min(pxW, Math.floor(hud.maxSheetWidth / a.frames)));
        const frameH = Math.max(1, Math.round(pxH * (frameW / pxW)));
        const texRel = `${texRelBase}/anim_${a.animKey}`;
        const frames: RgbaImage[] = [];

        for (let f = 0; f < a.frames; f++) {
          const phase = f / a.frames;
          await cdp.evalJs(`
            (async () => {
              if (window.__BAKE__ && window.__BAKE__.setAnimFrame) window.__BAKE__.setAnimFrame(${phase});
              await new Promise(r => setTimeout(r, 8));
            })()
          `);
          const shotBuf = await cdp.capturePng({ x: a.x, y: a.y, width: a.w, height: a.h, scale: 1 });
          let img = decodePng(shotBuf);
          if (img.width !== frameW || img.height !== frameH) {
            img = resizeRgba(img, frameW, frameH);
          }
          frames.push(img);
        }

        if (frames.length >= 2 && imagesPixelEqual(frames[0], frames[1])) {
          throw new Error(`HUD animation '${a.animKey}' frame 0 and frame 1 are pixel-identical.`);
        }

        const sheet = stitchHorizontal(frames);
        fs.writeFileSync(path.join(rpDir, `${texRel}.png`), encodeRgbaPng(sheet, { level: 7 }));
        fs.writeFileSync(
          path.join(rpDir, `${texRel}.json`),
          JSON.stringify({ base_size: [frameW * a.frames, frameH] }) + '\n',
        );

        animMeta.push({
          animKey: a.animKey,
          flipBook: `fb_${a.animKey}`,
          texture: texRel,
          texturePng: `${texRel}.png`,
          frames: a.frames,
          fps: a.fps,
          frameW,
          frameH,
          sheetW: frameW * a.frames,
          sheetH: frameH,
          xPct: pct(a.x, viewW),
          yPct: pct(a.y, viewH),
          wPct: pct(a.w, viewW),
          hPct: pct(a.h, viewH),
        });
      }
    }

    // Build fixed-width ASCII byte slices + optional UTF-8 tail field
    const fixedDyns = info.dyns.filter((d) => !d.tail);
    const tailDyns = info.dyns.filter((d) => d.tail);
    if (tailDyns.length > 1) {
      throw new Error('Only one [data-dyn-tail="1"] field is supported in a HUD document.');
    }
    const orderedDyns = [...fixedDyns, ...tailDyns];

    const payloadBinding = hud.channel === 'title' ? '#hud_title_text_string' : '#hud_subtitle_text_string';
    const prefixBytes = hud.channel === 'title' ? Buffer.byteLength(hud.hudTag, 'utf8') : 0;

    let cursor = 0;
    const dynSpecs: Array<
      BakedHudField & {
        expr: string;
        scale: number;
        align: string;
        colorFloat: [number, number, number];
        xPct: string;
        yMidPct: string;
        wPct: string;
      }
    > = [];

    for (const d of orderedDyns) {
      const start = cursor;
      const end = d.tail ? -1 : start + d.len;
      const bStart = prefixBytes + start;
      const bEnd = d.tail ? -1 : prefixBytes + end;

      const expr = d.tail
        ? bStart === 0
          ? payloadBinding
          : `(${payloadBinding} - ('%.${bStart}s' * ${payloadBinding}))`
        : bStart === 0
          ? `('%.${bEnd}s' * ${payloadBinding})`
          : `(('%.${bEnd}s' * ${payloadBinding}) - ('%.${bStart}s' * ${payloadBinding}))`;

      if (!d.tail) cursor = end;
      dynSpecs.push({
        dynId: d.dynId,
        start,
        end,
        len: d.tail ? 0 : d.len,
        tail: d.tail,
        expr,
        scale: d.scale,
        align: d.align,
        colorFloat: [
          Math.round((d.color[0] / 255) * 1000) / 1000,
          Math.round((d.color[1] / 255) * 1000) / 1000,
          Math.round((d.color[2] / 255) * 1000) / 1000,
        ],
        xPct: pct(d.x, viewW),
        yMidPct: pct(d.y + d.h / 2, viewH),
        wPct: pct(d.w, viewW),
      });
    }

    const flipBooks: Record<string, unknown> = {};
    for (const a of animMeta) {
      flipBooks[a.flipBook] = {
        anim_type: 'flip_book',
        initial_uv: [0, 0],
        frame_count: a.frames,
        frame_step: a.frameW,
        fps: a.fps,
        reversible: false,
        easing: 'linear',
      };
    }

    const hudUiJson = {
      namespace: hudNs,
      ...flipBooks,

      root: {
        type: 'panel',
        size: ['100%', '100%'],
        bindings: [
          { binding_name: '#hud_title_text_string', binding_type: 'global' },
          {
            binding_type: 'view',
            source_property_name: `(not ((#hud_title_text_string - '${hud.hudTag}') = #hud_title_text_string))`,
            target_property_name: '#visible',
          },
        ],
        controls: [
          {
            hud_canvas: {
              type: 'panel',
              size: ['100%', aspectPctX],
              anchor_from: 'center',
              anchor_to: 'center',
              controls: [
                ...widgetMeta.map((w) => ({
                  [`w_${w.id}`]: {
                    type: 'image',
                    texture: w.texture,
                    keep_ratio: false,
                    anchor_from: 'top_left',
                    anchor_to: 'top_left',
                    offset: [w.xPct, w.yPct],
                    size: [w.wPct, w.hPct],
                    layer: 15,
                  },
                })),
                ...animMeta.map((a, i) => ({
                  [`anim_${i}`]: {
                    type: 'image',
                    texture: a.texture,
                    keep_ratio: false,
                    anchor_from: 'top_left',
                    anchor_to: 'top_left',
                    offset: [a.xPct, a.yPct],
                    size: [a.wPct, a.hPct],
                    uv_size: [a.frameW, a.frameH],
                    uv: `@${hudNs}.${a.flipBook}`,
                    disable_anim_fast_forward: true,
                    layer: 17,
                  },
                })),
                ...dynSpecs.map((d) => ({
                  [`dyn_${d.dynId}`]: {
                    type: 'label',
                    text: '#text',
                    color: d.colorFloat,
                    font_type: 'smooth',
                    font_size: 'normal',
                    font_scale_factor: d.scale,
                    shadow: true,
                    localize: false,
                    text_alignment: d.align,
                    anchor_from: 'top_left',
                    anchor_to: 'left_middle',
                    offset: [d.xPct, d.yMidPct],
                    size: [d.wPct, 'default'],
                    layer: 20,
                    bindings: [
                      { binding_name: payloadBinding, binding_type: 'global' },
                      {
                        binding_type: 'view',
                        source_property_name: d.expr,
                        target_property_name: '#text',
                      },
                    ],
                  },
                })),
              ],
            },
          },
        ],
      },
    };

    const hudScreenJson = {
      namespace: 'hud',
      root_panel: {
        modifications: [
          {
            array_name: 'controls',
            operation: 'insert_back',
            value: [{ [`${hudNs}_overlay@${hudNs}.root`]: {} }],
          },
        ],
      },
      hud_title_text: {
        bindings: [
          { binding_name: '#hud_title_text_string', binding_name_override: '#bui_title', binding_type: 'global' },
          {
            binding_type: 'view',
            source_property_name: `(((#bui_title - '${hud.hudTag}') - '${hud.hudOffTag}') = #bui_title)`,
            target_property_name: '#visible',
          },
        ],
      },
    };

    const uiDefsPath = path.join(uiOutDir, '_ui_defs.json');
    const existingDefs: string[] = fs.existsSync(uiDefsPath)
      ? (JSON.parse(fs.readFileSync(uiDefsPath, 'utf8')).ui_defs ?? [])
      : [];
    const mergedDefs = [...new Set([...existingDefs, hudUiRel])].filter(
      (p) => p === hudUiRel || fs.existsSync(path.join(rpDir, p)),
    );

    fs.writeFileSync(uiDefsPath, JSON.stringify({ ui_defs: mergedDefs }, null, 2) + '\n');
    fs.writeFileSync(path.join(uiOutDir, `${hudNs}.json`), JSON.stringify(hudUiJson, null, 2) + '\n');
    fs.writeFileSync(path.join(uiOutDir, 'hud_screen.json'), JSON.stringify(hudScreenJson, null, 2) + '\n');

    const manifest: BakedHudManifest = {
      version: 2,
      experimental: true,
      namespace: hudNs,
      channel: hud.channel,
      hudTag: hud.hudTag,
      hudOffTag: hud.hudOffTag,
      viewport: [viewW, viewH],
      scale: hud.texScale,
      widgetCount: widgetMeta.length,
      animCount: animMeta.length,
      dynCount: dynSpecs.length,
      fixedByteLen: cursor,
      widgets: widgetMeta,
      animations: animMeta,
      dynFields: dynSpecs.map(({ dynId, start, end, len, tail }) => ({ dynId, start, end, len, tail })),
    };
    fs.writeFileSync(hud.manifestOut, JSON.stringify(manifest, null, 2) + '\n');

    return {
      manifestPath: hud.manifestOut,
      manifest,
      widgetCount: widgetMeta.length,
      animCount: animMeta.length,
      dynCount: dynSpecs.length,
    };
  } finally {
    await cdp.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
    } catch {}
  }
}
