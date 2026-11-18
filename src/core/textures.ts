// Procedural 9-slice hitbox frame and utility texture generator for Baked JsonUI.

import fs from 'node:fs';
import path from 'node:path';
import type { HitboxTheme } from '../types.js';
import { makeRgbaPng } from './png.js';

type Rgba = [number, number, number, number];
type PixelFn = (x: number, y: number, w: number, h: number) => Rgba;

interface ThemeFrames {
  hover: { size: number; slice: number; fn: PixelFn };
  press: { size: number; slice: number; fn: PixelFn };
  backdrop: { size: number; slice: number; fn: PixelFn };
}

function goldTheme(): ThemeFrames {
  return {
    hover: {
      size: 24,
      slice: 6,
      fn: (x, y, w, h) => {
        const outer = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        if (outer) return [26, 16, 7, 235];
        const cornerW = (x <= 4 || x >= w - 5) && (y <= 4 || y >= h - 5);
        const rivet =
          (x === 3 && y === 3) ||
          (x === w - 4 && y === 3) ||
          (x === 3 && y === h - 4) ||
          (x === w - 4 && y === h - 4);
        if (rivet) return [58, 36, 14, 245];
        const arm =
          ((x <= 4 || x >= w - 5) && (y === 1 || y === 2 || y === h - 2 || y === h - 3)) ||
          ((y <= 4 || y >= h - 5) && (x === 1 || x === 2 || x === w - 2 || x === w - 3));
        if (cornerW && arm) return [255, 240, 156, 255];
        if (x === 1 || y === 1) return [255, 244, 184, 245];
        if (x === w - 2 || y === h - 2) return [176, 114, 24, 245];
        if (x === 2 || y === 2 || x === w - 3 || y === h - 3) return [246, 204, 84, 195];
        return [255, 230, 148, 26];
      },
    },
    press: {
      size: 24,
      slice: 6,
      fn: (x, y, w, h) => {
        const outer = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        if (outer) return [20, 12, 5, 245];
        const cornerW = (x <= 4 || x >= w - 5) && (y <= 4 || y >= h - 5);
        const rivet =
          (x === 3 && y === 3) ||
          (x === w - 4 && y === 3) ||
          (x === 3 && y === h - 4) ||
          (x === w - 4 && y === h - 4);
        if (rivet) return [42, 24, 8, 250];
        const arm =
          ((x <= 4 || x >= w - 5) && (y === 1 || y === 2 || y === h - 2 || y === h - 3)) ||
          ((y <= 4 || y >= h - 5) && (x === 1 || x === 2 || x === w - 2 || x === w - 3));
        if (cornerW && arm) return [255, 212, 84, 255];
        if (x === 1 || y === 1) return [128, 78, 14, 245];
        if (x === w - 2 || y === h - 2) return [255, 232, 136, 245];
        if (x === 2 || y === 2 || x === w - 3 || y === h - 3) return [230, 162, 42, 205];
        return [245, 178, 52, 56];
      },
    },
    backdrop: {
      size: 16,
      slice: 4,
      fn: (x, y, w, h) => {
        const outer = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const bevel = x === 1 || y === 1 || x === w - 2 || y === h - 2;
        if (outer) return [18, 12, 6, 255];
        if (bevel) return [107, 76, 43, 255];
        return [28, 19, 10, 255];
      },
    },
  };
}

function classicTheme(): ThemeFrames {
  return {
    hover: {
      size: 16,
      slice: 4,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [18, 18, 18, 240];
        if (x === 1 || y === 1) return [255, 255, 255, 245];
        if (x === w - 2 || y === h - 2) return [180, 180, 180, 235];
        if (x === 2 || y === 2 || x === w - 3 || y === h - 3) return [235, 245, 255, 170];
        return [255, 255, 255, 32];
      },
    },
    press: {
      size: 16,
      slice: 4,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [14, 14, 14, 245];
        if (x === 1 || y === 1) return [100, 100, 100, 240];
        if (x === w - 2 || y === h - 2) return [245, 245, 245, 240];
        return [220, 235, 255, 58];
      },
    },
    backdrop: {
      size: 16,
      slice: 4,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [16, 16, 16, 255];
        if (x === 1 || y === 1 || x === w - 2 || y === h - 2) return [110, 110, 110, 255];
        return [32, 32, 36, 255];
      },
    },
  };
}

function neonTheme(): ThemeFrames {
  return {
    hover: {
      size: 20,
      slice: 5,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [8, 16, 28, 235];
        if (x === 1 || y === 1 || x === w - 2 || y === h - 2) return [56, 232, 255, 250];
        if (x === 2 || y === 2 || x === w - 3 || y === h - 3) return [125, 245, 255, 165];
        return [56, 232, 255, 30];
      },
    },
    press: {
      size: 20,
      slice: 5,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [12, 8, 24, 245];
        if (x === 1 || y === 1 || x === w - 2 || y === h - 2) return [244, 114, 182, 250];
        if (x === 2 || y === 2 || x === w - 3 || y === h - 3) return [249, 168, 212, 180];
        return [244, 114, 182, 54];
      },
    },
    backdrop: {
      size: 16,
      slice: 4,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [6, 10, 18, 255];
        if (x === 1 || y === 1 || x === w - 2 || y === h - 2) return [38, 72, 112, 255];
        return [12, 16, 28, 255];
      },
    },
  };
}

function minimalTheme(): ThemeFrames {
  return {
    hover: {
      size: 12,
      slice: 3,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [255, 255, 255, 180];
        return [255, 255, 255, 22];
      },
    },
    press: {
      size: 12,
      slice: 3,
      fn: (x, y, w, h) => {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [255, 255, 255, 230];
        return [255, 255, 255, 52];
      },
    },
    backdrop: {
      size: 12,
      slice: 3,
      fn: () => [16, 16, 20, 255],
    },
  };
}

function getThemeFrames(theme: HitboxTheme): ThemeFrames {
  switch (theme) {
    case 'classic': return classicTheme();
    case 'neon': return neonTheme();
    case 'minimal': return minimalTheme();
    case 'gold':
    default:
      return goldTheme();
  }
}

export function writeUtilityTextures(
  texOutDir: string,
  theme: HitboxTheme,
  backdropColor: [number, number, number],
): void {
  fs.mkdirSync(texOutDir, { recursive: true });

  const write9 = (name: string, size: number, slice: number, fn: PixelFn) => {
    fs.writeFileSync(path.join(texOutDir, `${name}.png`), makeRgbaPng(size, size, fn));
    fs.writeFileSync(
      path.join(texOutDir, `${name}.json`),
      JSON.stringify({ nineslice_size: slice, base_size: [size, size] }, null, 2) + '\n',
    );
  };

  const frames = getThemeFrames(theme);
  write9('hit_idle', 8, 2, () => [255, 255, 255, 2]);
  write9('hit_hover', frames.hover.size, frames.hover.slice, frames.hover.fn);
  write9('hit_press', frames.press.size, frames.press.slice, frames.press.fn);
  write9('hit_backdrop', frames.backdrop.size, frames.backdrop.slice, frames.backdrop.fn);

  const [br, bg, bb] = backdropColor;
  fs.writeFileSync(path.join(texOutDir, 'screen_fill.png'), makeRgbaPng(4, 4, () => [br, bg, bb, 255]));
  fs.writeFileSync(
    path.join(texOutDir, 'screen_fill.json'),
    JSON.stringify({ nineslice_size: 1, base_size: [4, 4] }, null, 2) + '\n',
  );

  fs.writeFileSync(path.join(texOutDir, 'white_fill.png'), makeRgbaPng(4, 4, () => [255, 255, 255, 255]));
  fs.writeFileSync(
    path.join(texOutDir, 'white_fill.json'),
    JSON.stringify({ nineslice_size: 1, base_size: [4, 4] }, null, 2) + '\n',
  );
}
