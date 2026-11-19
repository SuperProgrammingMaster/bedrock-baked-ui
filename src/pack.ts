// One-click Minecraft Bedrock .mcaddon packager (`baked-ui pack`).
// Pure Node.js ZIP builder (zero external zip binaries or npm deps), optional esbuild bundling.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedBakedUiConfig } from './types.js';
import { bakeSite } from './bakers/site.js';
import { buildZipBuffer, collectDirZipEntries } from './core/zip.js';
import { validateSiteBake } from './validate.js';

export interface PackAddonOptions {
  /** Destination .mcaddon path (default: `<rootDir>/dist/<namespace>.mcaddon`). */
  outPath?: string;
  /** Skip running `bakeSite` before packaging (default: false). */
  skipBake?: boolean;
  /** Skip attempting to bundle `bp/src/main.ts` with esbuild (default: false). */
  skipBundle?: boolean;
}

export interface PackAddonResult {
  outPath: string;
  entries: number;
  bytes: number;
  bundledScript: boolean;
}

function findEsbuildBin(rootDir: string): string | undefined {
  const binName = process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild';
  let cur = path.resolve(rootDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cur, 'node_modules', '.bin', binName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/**
 * Bakes (optional), validates, optionally bundles `bp/src/main.ts`, and writes a cross-platform
 * POSIX-slash `.mcaddon` archive containing `<ns>_bp/` and `<ns>_rp/`.
 */
export async function packAddon(
  config: ResolvedBakedUiConfig,
  opts: PackAddonOptions = {},
): Promise<PackAddonResult> {
  const { namespace: ns, rootDir, bpDir, rpDir } = config;

  if (!opts.skipBake) {
    await bakeSite(config);
  }

  const report = validateSiteBake(config);
  if (!report.ok) {
    const errs = report.issues.filter((i) => i.level === 'error').map((i) => `${i.code}: ${i.message}`);
    throw new Error(`Validation failed before packaging:\n  - ${errs.join('\n  - ')}`);
  }

  if (!fs.existsSync(path.join(bpDir, 'manifest.json'))) {
    throw new Error(`Missing Behavior Pack manifest: ${path.join(bpDir, 'manifest.json')}`);
  }
  if (!fs.existsSync(path.join(rpDir, 'manifest.json'))) {
    throw new Error(`Missing Resource Pack manifest: ${path.join(rpDir, 'manifest.json')}`);
  }

  let bundledScript = false;
  const tsEntry = path.join(bpDir, 'src', 'main.ts');
  const jsOut = path.join(bpDir, 'scripts', 'main.js');
  if (!opts.skipBundle && fs.existsSync(tsEntry)) {
    const esbuildBin = findEsbuildBin(rootDir);
    if (esbuildBin) {
      fs.mkdirSync(path.dirname(jsOut), { recursive: true });
      const args = [
        tsEntry,
        '--bundle',
        '--format=esm',
        '--platform=neutral',
        '--target=es2022',
        '--external:@minecraft/server',
        '--external:@minecraft/server-ui',
        `--outfile=${jsOut}`,
      ];
      execFileSync(esbuildBin, args, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      bundledScript = true;
    }
  }

  const bpEntries = collectDirZipEntries(bpDir, `${ns}_bp`, (rel) => {
    if (rel === 'src/' || rel.startsWith('src/')) return false;
    if (rel.endsWith('.ts') || rel.endsWith('.map')) return false;
    return true;
  });
  const rpEntries = collectDirZipEntries(rpDir, `${ns}_rp`, (rel) => {
    if (rel.startsWith('tools/')) return false;
    return true;
  });

  const allEntries = [...bpEntries, ...rpEntries];
  const zipBuf = buildZipBuffer(allEntries);

  const outPath = opts.outPath
    ? path.resolve(rootDir, opts.outPath)
    : path.join(rootDir, 'dist', `${ns}.mcaddon`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, zipBuf);

  return {
    outPath,
    entries: allEntries.length,
    bytes: zipBuf.length,
    bundledScript,
  };
}
