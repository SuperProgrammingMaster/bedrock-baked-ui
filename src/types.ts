// Shared TypeScript types for bedrock-baked-ui (build-time compiler & Bedrock runtime SDK).
// Keep this file free of Node.js and @minecraft/* imports so it can be shared everywhere.

export type HitboxTheme = 'gold' | 'classic' | 'neon' | 'minimal';
export type HudChannel = 'subtitle' | 'title';

export interface BakedButton {
  readonly hitId: string;
  readonly hitTag: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly xPct: string;
  readonly yPct: string;
  readonly wPct: string;
  readonly hPct: string;
  readonly nextState: string;
  readonly special: string | null;
  readonly hitFxHover?: string;
  readonly hitFxPress?: string;
  readonly sound?: string;
  readonly soundPitch?: number;
  readonly soundVolume?: number;
}

export interface BakedDynSlot {
  readonly slot: number;
  readonly dynId: string;
  readonly maskTag: string;
  readonly tone: string;
}

export type BarDirection = 'left' | 'right' | 'up' | 'down';

export interface BakedBarSlot {
  readonly slot: number;
  readonly barId: string;
  readonly barKey: string;
  readonly barTag: string;
  readonly direction: BarDirection | string;
}

export interface BakedBarSpec {
  readonly barKey: string;
  readonly barId: string;
  readonly slot: number;
  readonly barTag: string;
  readonly direction: BarDirection | string;
  readonly texture: string;
  readonly texturePng: string;
  readonly width: number;
  readonly height: number;
  readonly xPct: string;
  readonly yPct: string;
  readonly wPct: string;
  readonly hPct: string;
  readonly states: readonly string[];
}

export interface BakedState {
  readonly key: string;
  readonly index: number;
  readonly tag: string;
  readonly texture: string;
  readonly texturePng: string;
  readonly url: string;
  readonly title: string;
  readonly buttons: readonly BakedButton[];
  readonly dynSlots?: readonly BakedDynSlot[];
  readonly barSlots?: readonly BakedBarSlot[];
}

export interface BakedAnimationPlacement {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly states: readonly string[];
}

export interface BakedAnimationSpec {
  readonly animKey: string;
  readonly animId: string;
  readonly flipBook: string;
  readonly texture: string;
  readonly texturePng: string;
  readonly frames: number;
  readonly fps: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly sheetW: number;
  readonly sheetH: number;
  readonly placements: readonly BakedAnimationPlacement[];
}

export type MotionEasing =
  | 'linear'
  | 'spring'
  | 'in_quad'
  | 'out_quad'
  | 'in_out_quad'
  | 'in_cubic'
  | 'out_cubic'
  | 'in_out_cubic'
  | 'in_quart'
  | 'out_quart'
  | 'in_out_quart'
  | 'in_quint'
  | 'out_quint'
  | 'in_out_quint'
  | 'in_sine'
  | 'out_sine'
  | 'in_out_sine'
  | 'in_expo'
  | 'out_expo'
  | 'in_out_expo'
  | 'in_circ'
  | 'out_circ'
  | 'in_out_circ'
  | 'in_bounce'
  | 'out_bounce'
  | 'in_out_bounce'
  | 'in_back'
  | 'out_back'
  | 'in_out_back'
  | 'in_elastic'
  | 'out_elastic'
  | 'in_out_elastic';

export interface BakedMotionPlacement {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly states: readonly string[];
}

export interface BakedMotionSpec {
  readonly motionKey: string;
  readonly motionId: string;
  readonly effects: readonly string[];
  readonly texture: string;
  readonly texturePng: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly delay: number;
  readonly easing: MotionEasing | string;
  readonly dx: number;
  readonly dy: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly alphaMin: number;
  readonly alphaMax: number;
  readonly animNames: readonly string[];
  readonly placements: readonly BakedMotionPlacement[];
}

export interface BakedSiteManifest {
  readonly version: number;
  readonly namespace: string;
  readonly entityId: string;
  readonly routerTag: string;
  readonly invTitleTag: string;
  readonly viewport: readonly number[];
  readonly sourceScale: number;
  readonly texScale: number;
  readonly initialState: string;
  readonly hitboxCount: number;
  readonly hitFxCount?: number;
  readonly stateCount: number;
  readonly animCount: number;
  readonly motionCount?: number;
  readonly dynCount: number;
  readonly barCount?: number;
  readonly animations: Record<string, BakedAnimationSpec>;
  readonly motions?: Record<string, BakedMotionSpec>;
  readonly bars?: Record<string, BakedBarSpec>;
  readonly states: Record<string, BakedState>;
}

export interface BakedHudWidget {
  readonly id: string;
  readonly texture: string;
  readonly texturePng: string;
  readonly width: number;
  readonly height: number;
  readonly xPct: string;
  readonly yPct: string;
  readonly wPct: string;
  readonly hPct: string;
}

export interface BakedHudAnim {
  readonly animKey: string;
  readonly flipBook: string;
  readonly texture: string;
  readonly texturePng: string;
  readonly frames: number;
  readonly fps: number;
  readonly frameW: number;
  readonly frameH: number;
  readonly sheetW: number;
  readonly sheetH: number;
  readonly xPct: string;
  readonly yPct: string;
  readonly wPct: string;
  readonly hPct: string;
}

export interface BakedHudMotion {
  readonly motionKey: string;
  readonly motionId: string;
  readonly effects: readonly string[];
  readonly texture: string;
  readonly texturePng: string;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly delay: number;
  readonly easing: MotionEasing | string;
  readonly animNames: readonly string[];
  readonly xPct: string;
  readonly yPct: string;
  readonly wPct: string;
  readonly hPct: string;
}

export interface BakedHudField {
  readonly dynId: string;
  readonly start: number;
  readonly end: number;
  readonly len: number;
  readonly tail: boolean;
}

export interface BakedHudManifest {
  readonly version: number;
  readonly experimental: boolean;
  readonly namespace: string;
  readonly channel: HudChannel | string;
  readonly hudTag: string;
  readonly hudOffTag: string;
  readonly viewport: readonly number[];
  readonly scale: number;
  readonly widgetCount: number;
  readonly animCount: number;
  readonly motionCount?: number;
  readonly dynCount: number;
  readonly fixedByteLen: number;
  readonly widgets: readonly BakedHudWidget[];
  readonly animations: readonly BakedHudAnim[];
  readonly motions?: readonly BakedHudMotion[];
  readonly dynFields: readonly BakedHudField[];
}

export interface SiteBakeConfig {
  /** Path to HTML entry file (relative to config directory or absolute). */
  entry?: string;
  /** Logical CSS viewport width x height (default: [1056, 594], 16:9). */
  viewport?: [number, number];
  /** Logical downscale factor for integer hitbox coordinates (default: 3 -> 352x198). */
  sourceScale?: number;
  /** HiDPI supersampling factor for baked PNGs (1..3, default: 2). */
  texScale?: number;
  /** Maximum reachable states to crawl (1..100, default: 64). */
  maxStates?: number;
  /** Maximum flip_book spritesheet width in px (default: 2800). */
  maxSheetWidth?: number;
  /** Built-in 9-slice hitbox frame theme (default: 'gold'). */
  theme?: HitboxTheme;
  /** Solid RGB [0..255, 0..255, 0..255] letterbox backdrop color. */
  backdropColor?: [number, number, number];
  /** Quantize opaque PNGs to 256-color indexed PNG to shrink pack size (default: true). */
  quantize?: boolean;
  /** Emit invisible 27-slot container entity files into BP & RP (default: true). */
  emitEntity?: boolean;
  /** Emit ActionFormData fallback rules in ui/server_form.json (default: true). */
  emitActionForm?: boolean;
  /** Hidden marker tag used for ActionFormData routing (default: '§w§b'). */
  routerTag?: string;
  /** Hidden entity nameTag matching chest_screen/pocket_containers (default: '§b§w§n§h'). */
  invTitleTag?: string;
  /** Subdirectory under `<rpDir>/textures/ui/` for baked textures (default: 'baked_ui'). */
  textureSubdir?: string;
  /** Output path for generated JSON manifest (relative to config dir or absolute). */
  manifestOut?: string;
}

export interface HudBakeConfig {
  /** Path to transparent HUD HTML entry file (experimental). */
  entry?: string;
  /** Logical CSS viewport width x height (default: [1056, 594]). */
  viewport?: [number, number];
  /** HiDPI supersampling factor (1..4, default: 3). */
  texScale?: number;
  /** Maximum flip_book spritesheet width in px (default: 2800). */
  maxSheetWidth?: number;
  /** Hidden title tag that toggles HUD visibility (default: '§h§u§d'). */
  hudTag?: string;
  /** Non-empty title tag used to hide HUD cleanly (default: 'bui.off'). */
  hudOffTag?: string;
  /** Payload transport channel: 'subtitle' (classic) or 'title' (1.26.65+ fallback). Default: 'subtitle'. */
  channel?: HudChannel;
  /** Subdirectory under `<rpDir>/textures/ui/` for HUD textures (default: 'baked_hud'). */
  textureSubdir?: string;
  /** Output path for generated HUD manifest JSON. */
  manifestOut?: string;
}

export interface BakedUiConfig {
  /** JsonUI namespace (alphanumeric + underscore, default: 'baked_ui'). */
  namespace?: string;
  /** Invisible container entity identifier (`ns:name`, default: 'baked_ui:menu'). */
  entityId?: string;
  /** Target Resource Pack root directory. */
  rpDir?: string;
  /** Target Behavior Pack root directory. */
  bpDir?: string;
  /** Optional explicit path to Chrome/Edge/Chromium executable. */
  browserPath?: string;
  /** Fullscreen interactive menu configuration. */
  site?: SiteBakeConfig;
  /** Experimental transparent HUD configuration. */
  hud?: HudBakeConfig;
}

export interface ResolvedSiteBakeConfig {
  entry: string;
  viewport: [number, number];
  sourceScale: number;
  texScale: number;
  maxStates: number;
  maxSheetWidth: number;
  theme: HitboxTheme;
  backdropColor: [number, number, number];
  quantize: boolean;
  emitEntity: boolean;
  emitActionForm: boolean;
  routerTag: string;
  invTitleTag: string;
  textureSubdir: string;
  manifestOut: string;
}

export interface ResolvedHudBakeConfig {
  entry: string;
  viewport: [number, number];
  texScale: number;
  maxSheetWidth: number;
  hudTag: string;
  hudOffTag: string;
  channel: HudChannel;
  textureSubdir: string;
  manifestOut: string;
}

export interface ResolvedBakedUiConfig {
  rootDir: string;
  namespace: string;
  entityId: string;
  rpDir: string;
  bpDir: string;
  browserPath?: string;
  site: ResolvedSiteBakeConfig;
  hud: ResolvedHudBakeConfig;
}

export interface SiteBakeResult {
  manifestPath: string;
  manifest: BakedSiteManifest;
  stateCount: number;
  uniquePngs: number;
  hitboxCount: number;
  hitFxCount: number;
  animCount: number;
  motionCount: number;
  dynCount: number;
  barCount: number;
  totalBytes: number;
}

export interface HudBakeResult {
  manifestPath: string;
  manifest: BakedHudManifest;
  widgetCount: number;
  animCount: number;
  motionCount: number;
  dynCount: number;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  stats: {
    stateCount: number;
    hitboxCount: number;
    hitFxCount: number;
    dynCount: number;
    barCount: number;
    animCount: number;
    motionCount: number;
    maxButtonsPerState: number;
    maxSlotBudget: number;
  };
}
