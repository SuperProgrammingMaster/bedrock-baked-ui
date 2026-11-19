// Shared native 60fps JsonUI motion animation parser & emitter for site.ts and hud.ts.
// Supports looping motions (float, slide-x, slide-y, pulse, glow) and one-shot entrances
// (enter-up, enter-down, enter-left, enter-right, enter-fade, enter-pop).

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface RawMotionElement {
  motionId: string;
  motionKey: string;
  effects: string[];
  dx: number;
  dy: number;
  offsetOneShot: boolean;
  hasSize: boolean;
  sizeOneShot: boolean;
  scaleMin: number;
  scaleMax: number;
  hasAlpha: boolean;
  alphaOneShot: boolean;
  alphaMin: number;
  alphaMax: number;
  duration: number;
  delay: number;
  easing: string;
  layer: number;
  domIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompiledMotionRefs {
  offsetAnimRef?: string;
  sizeAnimRef?: string;
  alphaAnimRef?: string;
  animNames: string[];
  defs: Record<string, unknown>;
}

/** Browser-side JS snippet that measures all `[data-motion]` elements within a viewport. */
export function buildMeasureMotionsSnippet(viewW: number, viewH: number): string {
  return `[...document.querySelectorAll('[data-motion]')].map((el, domIndex) => {
    const r = el.getBoundingClientRect();
    const motionId = el.getAttribute('data-motion') || 'motion';
    const rawKey = el.getAttribute('data-motion-key') || motionId;
    const rawType = (el.getAttribute('data-motion-type') || 'float').toLowerCase();
    const effects = rawType.split(/[+,\\s]+/).map(s => s.trim()).filter(Boolean);
    const ampRaw = el.getAttribute('data-motion-amp');
    const hasEnterOffset = effects.some(e => e.startsWith('enter-') && e !== 'enter-fade' && e !== 'enter-pop');
    const amp = ampRaw !== null && ampRaw !== '' && !Number.isNaN(Number(ampRaw)) ? Number(ampRaw) : (hasEnterOffset ? 22 : 8);
    let dx = 0;
    let dy = 0;
    let offsetOneShot = false;
    let hasSize = false;
    let sizeOneShot = false;
    let hasAlpha = false;
    let alphaOneShot = false;
    for (const ef of effects) {
      if (ef === 'float' || ef === 'bob') { dy = -amp; offsetOneShot = false; }
      else if (ef === 'slide-y' || ef === 'slide_y') { dy = amp; offsetOneShot = false; }
      else if (ef === 'slide-x' || ef === 'slide_x' || ef === 'sway') { dx = amp; offsetOneShot = false; }
      else if (ef === 'enter-up' || ef === 'enter_up') { dy = amp; offsetOneShot = true; }
      else if (ef === 'enter-down' || ef === 'enter_down') { dy = -amp; offsetOneShot = true; }
      else if (ef === 'enter-left' || ef === 'enter_left') { dx = amp; offsetOneShot = true; }
      else if (ef === 'enter-right' || ef === 'enter_right') { dx = -amp; offsetOneShot = true; }
      else if (ef === 'pulse' || ef === 'breathe' || ef === 'scale') { hasSize = true; sizeOneShot = false; }
      else if (ef === 'enter-pop' || ef === 'enter_pop') { hasSize = true; sizeOneShot = true; }
      else if (ef === 'glow' || ef === 'fade' || ef === 'alpha') { hasAlpha = true; alphaOneShot = false; }
      else if (ef === 'enter-fade' || ef === 'enter_fade') { hasAlpha = true; alphaOneShot = true; }
    }
    const dxAttr = el.getAttribute('data-motion-dx');
    const dyAttr = el.getAttribute('data-motion-dy');
    if (dxAttr !== null && dxAttr !== '' && !Number.isNaN(Number(dxAttr))) dx = Number(dxAttr);
    if (dyAttr !== null && dyAttr !== '' && !Number.isNaN(Number(dyAttr))) dy = Number(dyAttr);
    const scaleMinAttr = el.getAttribute('data-motion-scale-min');
    const scaleMaxAttr = el.getAttribute('data-motion-scale-max') ?? el.getAttribute('data-motion-scale');
    const defaultScaleMin = sizeOneShot ? 0.82 : 1.0;
    const defaultScaleMax = sizeOneShot ? 1.0 : 1.08;
    const scaleMin = scaleMinAttr !== null && scaleMinAttr !== '' && !Number.isNaN(Number(scaleMinAttr)) ? Number(scaleMinAttr) : defaultScaleMin;
    const scaleMax = scaleMaxAttr !== null && scaleMaxAttr !== '' && !Number.isNaN(Number(scaleMaxAttr)) ? Number(scaleMaxAttr) : defaultScaleMax;
    const alphaMinAttr = el.getAttribute('data-motion-min');
    const alphaMaxAttr = el.getAttribute('data-motion-max');
    const defaultAlphaMin = alphaOneShot ? 0.0 : 0.35;
    const alphaMin = Math.max(0, Math.min(1, alphaMinAttr !== null && alphaMinAttr !== '' && !Number.isNaN(Number(alphaMinAttr)) ? Number(alphaMinAttr) : defaultAlphaMin));
    const alphaMax = Math.max(0, Math.min(1, alphaMaxAttr !== null && alphaMaxAttr !== '' && !Number.isNaN(Number(alphaMaxAttr)) ? Number(alphaMaxAttr) : 1.0));
    const isAnyOneShot = offsetOneShot || sizeOneShot || alphaOneShot;
    const durAttr = el.getAttribute('data-motion-duration');
    const duration = Math.max(0.1, durAttr !== null && durAttr !== '' && !Number.isNaN(Number(durAttr)) ? Number(durAttr) : (isAnyOneShot ? 0.45 : 1.2));
    const delay = Math.max(0, parseFloat(el.getAttribute('data-motion-delay') || '0') || 0);
    const easingAttr = el.getAttribute('data-motion-easing');
    const easing = (easingAttr && easingAttr.trim()) || (isAnyOneShot ? 'out_cubic' : 'in_out_sine');
    const pad = Math.max(0, Math.round(parseFloat(el.getAttribute('data-motion-pad') || '0') || 0));
    const layer = Math.max(4, Math.min(7, parseInt(el.getAttribute('data-motion-layer') || '5', 10) || 5));
    const x = Math.max(0, Math.round(r.left) - pad);
    const y = Math.max(0, Math.round(r.top) - pad);
    const right = Math.min(${viewW}, Math.round(r.right) + pad);
    const bottom = Math.min(${viewH}, Math.round(r.bottom) + pad);
    return {
      motionId,
      motionKey: rawKey.replace(/[^a-z0-9_]/gi, '_'),
      effects: effects.length ? effects : ['float'],
      dx,
      dy,
      offsetOneShot,
      hasSize,
      sizeOneShot,
      scaleMin,
      scaleMax,
      hasAlpha,
      alphaOneShot,
      alphaMin,
      alphaMax,
      duration,
      delay,
      easing,
      layer,
      domIndex,
      x,
      y,
      w: Math.max(0, right - x),
      h: Math.max(0, bottom - y),
    };
  }).filter(m => m.w > 4 && m.h > 4)`;
}

/** Emits native Bedrock JsonUI animation definitions (`offset`, `size`, `alpha`, `wait`) for one motion sprite. */
export function compileMotionAnimations(
  ns: string,
  spec: {
    motionKey: string;
    dx: number;
    dy: number;
    offsetOneShot: boolean;
    hasSize: boolean;
    sizeOneShot: boolean;
    scaleMin: number;
    scaleMax: number;
    hasAlpha: boolean;
    alphaOneShot: boolean;
    alphaMin: number;
    alphaMax: number;
    duration: number;
    delay: number;
    easing: string;
    clip: { w: number; h: number };
  },
): CompiledMotionRefs {
  const k = spec.motionKey;
  const dur = round2(spec.duration);
  const delay = round2(spec.delay);
  const easing = spec.easing;
  const defs: Record<string, unknown> = {};
  const animNames: string[] = [];
  let offsetAnimRef: string | undefined;
  let sizeAnimRef: string | undefined;
  let alphaAnimRef: string | undefined;

  if (spec.dx !== 0 || spec.dy !== 0) {
    const offX: string | number = spec.dx !== 0 ? `${round2((spec.dx / spec.clip.w) * 100)}%` : 0;
    const offY: string | number = spec.dy !== 0 ? `${round2((spec.dy / spec.clip.h) * 100)}%` : 0;
    const nameA = `mot_${k}_off_a`;
    if (spec.offsetOneShot) {
      defs[nameA] = {
        anim_type: 'offset',
        from: [offX, offY],
        to: [0, 0],
        duration: dur,
        easing,
      };
      animNames.push(nameA);
      if (delay > 0) {
        const nameW = `mot_${k}_off_w`;
        defs[nameW] = {
          anim_type: 'offset',
          from: [offX, offY],
          to: [offX, offY],
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        offsetAnimRef = `@${ns}.${nameW}`;
      } else {
        offsetAnimRef = `@${ns}.${nameA}`;
      }
    } else {
      const nameB = `mot_${k}_off_b`;
      defs[nameA] = {
        anim_type: 'offset',
        from: [0, 0],
        to: [offX, offY],
        duration: dur,
        easing,
        next: `@${ns}.${nameB}`,
      };
      defs[nameB] = {
        anim_type: 'offset',
        from: [offX, offY],
        to: [0, 0],
        duration: dur,
        easing,
        next: `@${ns}.${nameA}`,
      };
      animNames.push(nameA, nameB);
      if (delay > 0) {
        const nameW = `mot_${k}_off_w`;
        defs[nameW] = {
          anim_type: 'wait',
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        offsetAnimRef = `@${ns}.${nameW}`;
      } else {
        offsetAnimRef = `@${ns}.${nameA}`;
      }
    }
  }

  if (spec.hasSize) {
    const s0 = `${round2(spec.scaleMin * 100)}%`;
    const s1 = `${round2(spec.scaleMax * 100)}%`;
    const nameA = `mot_${k}_sz_a`;
    if (spec.sizeOneShot) {
      defs[nameA] = {
        anim_type: 'size',
        from: [s0, s0],
        to: [s1, s1],
        duration: dur,
        easing,
      };
      animNames.push(nameA);
      if (delay > 0) {
        const nameW = `mot_${k}_sz_w`;
        defs[nameW] = {
          anim_type: 'size',
          from: [s0, s0],
          to: [s0, s0],
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        sizeAnimRef = `@${ns}.${nameW}`;
      } else {
        sizeAnimRef = `@${ns}.${nameA}`;
      }
    } else {
      const nameB = `mot_${k}_sz_b`;
      defs[nameA] = {
        anim_type: 'size',
        from: [s0, s0],
        to: [s1, s1],
        duration: dur,
        easing,
        next: `@${ns}.${nameB}`,
      };
      defs[nameB] = {
        anim_type: 'size',
        from: [s1, s1],
        to: [s0, s0],
        duration: dur,
        easing,
        next: `@${ns}.${nameA}`,
      };
      animNames.push(nameA, nameB);
      if (delay > 0) {
        const nameW = `mot_${k}_sz_w`;
        defs[nameW] = {
          anim_type: 'wait',
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        sizeAnimRef = `@${ns}.${nameW}`;
      } else {
        sizeAnimRef = `@${ns}.${nameA}`;
      }
    }
  }

  if (spec.hasAlpha) {
    const aMax = round2(spec.alphaMax);
    const aMin = round2(spec.alphaMin);
    const nameA = `mot_${k}_al_a`;
    if (spec.alphaOneShot) {
      defs[nameA] = {
        anim_type: 'alpha',
        from: aMin,
        to: aMax,
        duration: dur,
        easing,
      };
      animNames.push(nameA);
      if (delay > 0) {
        const nameW = `mot_${k}_al_w`;
        defs[nameW] = {
          anim_type: 'alpha',
          from: aMin,
          to: aMin,
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        alphaAnimRef = `@${ns}.${nameW}`;
      } else {
        alphaAnimRef = `@${ns}.${nameA}`;
      }
    } else {
      const nameB = `mot_${k}_al_b`;
      defs[nameA] = {
        anim_type: 'alpha',
        from: aMax,
        to: aMin,
        duration: dur,
        easing,
        next: `@${ns}.${nameB}`,
      };
      defs[nameB] = {
        anim_type: 'alpha',
        from: aMin,
        to: aMax,
        duration: dur,
        easing,
        next: `@${ns}.${nameA}`,
      };
      animNames.push(nameA, nameB);
      if (delay > 0) {
        const nameW = `mot_${k}_al_w`;
        defs[nameW] = {
          anim_type: 'wait',
          duration: delay,
          next: `@${ns}.${nameA}`,
        };
        animNames.push(nameW);
        alphaAnimRef = `@${ns}.${nameW}`;
      } else {
        alphaAnimRef = `@${ns}.${nameA}`;
      }
    }
  }

  return { offsetAnimRef, sizeAnimRef, alphaAnimRef, animNames, defs };
}

/** Builds a Bedrock JsonUI control wrapper for one motion sprite (never emits invalid disable_anim_fast_forward). */
export function buildMotionControl(opts: {
  controlName: string;
  texRel: string;
  xPct: string;
  yPct: string;
  wPct: string;
  hPct: string;
  layer: number;
  offsetAnimRef?: string;
  sizeAnimRef?: string;
  alphaAnimRef?: string;
}): Record<string, unknown> {
  const hasBothOffsetAndSize = Boolean(opts.offsetAnimRef && opts.sizeAnimRef);
  const spriteHasAnim = Boolean(opts.sizeAnimRef || (!hasBothOffsetAndSize && opts.offsetAnimRef));
  const spriteControl: Record<string, unknown> = {
    type: 'image',
    texture: opts.texRel,
    keep_ratio: false,
    anchor_from: 'center',
    anchor_to: 'center',
    size: opts.sizeAnimRef ?? ['100%', '100%'],
    layer: opts.layer,
  };
  if (spriteHasAnim) {
    spriteControl.disable_anim_fast_forward = true;
  }
  if (!hasBothOffsetAndSize && opts.offsetAnimRef) {
    spriteControl.offset = opts.offsetAnimRef;
  }

  const innerControls: Array<Record<string, unknown>> = hasBothOffsetAndSize
    ? [
        {
          mover: {
            type: 'panel',
            anchor_from: 'center',
            anchor_to: 'center',
            size: ['100%', '100%'],
            offset: opts.offsetAnimRef,
            clips_children: false,
            disable_anim_fast_forward: true,
            ...(opts.alphaAnimRef ? { propagate_alpha: true } : {}),
            controls: [{ sprite: spriteControl }],
          },
        },
      ]
    : [{ sprite: spriteControl }];

  const wrapper: Record<string, unknown> = {
    type: 'panel',
    anchor_from: 'top_left',
    anchor_to: 'top_left',
    offset: [opts.xPct, opts.yPct],
    size: [opts.wPct, opts.hPct],
    clips_children: false,
    layer: opts.layer,
    controls: innerControls,
  };
  if (opts.alphaAnimRef) {
    wrapper.alpha = opts.alphaAnimRef;
    wrapper.propagate_alpha = true;
    wrapper.disable_anim_fast_forward = true;
  }
  return { [opts.controlName]: wrapper };
}
