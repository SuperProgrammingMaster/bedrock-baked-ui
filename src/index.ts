// Programmatic Node.js API for bedrock-baked-ui.

export * from './types.js';
export { DEFAULT_CONFIG_FILENAME, loadConfig, resolveConfig } from './config.js';
export { bakeSite } from './bakers/site.js';
export { bakeHud } from './bakers/hud.js';
export { validateSiteBake } from './validate.js';
export { startPreviewServer, type PreviewServerOptions } from './preview.js';
export { packAddon, type PackAddonOptions, type PackAddonResult } from './pack.js';
export { scaffoldProject, type InitOptions, type InitResult } from './init.js';
export { findBrowser } from './core/browser.js';
export { encodeTag, isBakedMarkerTag } from './core/tags.js';
export { buildZipBuffer, collectDirZipEntries, type ZipInputEntry } from './core/zip.js';
export {
  decodePng,
  encodeRgbaPng,
  imagesPixelEqual,
  makeRgbaPng,
  optimizePngBuffer,
  readPngDimensions,
  resizeRgba,
  stitchHorizontal,
  type RgbaImage,
} from './core/png.js';
