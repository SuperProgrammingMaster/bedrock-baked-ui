#!/usr/bin/env node
// CLI entry point for bedrock-baked-ui (`baked-ui`).

import path from 'node:path';
import type { HitboxTheme, HudChannel } from './types.js';
import { bakeHud } from './bakers/hud.js';
import { bakeSite } from './bakers/site.js';
import { DEFAULT_CONFIG_FILENAME, loadConfig } from './config.js';
import { scaffoldProject } from './init.js';
import { startPreviewServer } from './preview.js';
import { validateSiteBake } from './validate.js';

const HELP = `
bedrock-baked-ui: HTML/CSS/Canvas to Minecraft Bedrock JsonUI Compiler

Usage:
  baked-ui init [dir] [options]       Scaffold config, starter HTML UI, and BP example
  baked-ui dev [options]              Start local live preview with hitbox/budget inspector
  baked-ui bake [options]             Compile fullscreen interactive menu -> RP + BP manifest
  baked-ui bake-hud [options]         [Experimental] Compile transparent HUD -> RP + BP manifest
  baked-ui validate [options]         Validate baked textures, JsonUI, and Bedrock limits

Options:
  -c, --config <path>                 Path to ${DEFAULT_CONFIG_FILENAME} (default: cwd)
  --namespace <ns>                    (init) JsonUI namespace (default: my_ui)
  --entity <ns:name>                  (init) Invisible container entity ID
  --theme <gold|classic|neon|minimal> (init) Hitbox 9-slice frame theme (default: gold)
  --no-hud                            (init) Skip experimental HUD template
  --force                             (init) Overwrite existing starter files
  --port <num>                        (dev) Preview server port (default: 4173)
  --hud                               (dev) Preview experimental HUD instead of menu
  --scale <1..4>                      (bake / bake-hud) Override HiDPI texture scale
  --no-quantize                       (bake) Disable 256-color PNG quantization
  --channel <subtitle|title>          (bake-hud) Override HUD payload transport channel
  -h, --help                          Show this help message
`.trim();

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      flags.help = true;
    } else if (a === '-c' || a === '--config') {
      flags.config = argv[++i] ?? '';
    } else if (a.startsWith('--no-')) {
      flags[a.slice(5)] = false;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = argv[++i];
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function fmtKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || flags.help) {
    console.log(HELP);
    return;
  }

  if (cmd === 'init') {
    const targetDir = positional[1] ? path.resolve(positional[1]) : process.cwd();
    const res = scaffoldProject({
      targetDir,
      namespace: typeof flags.namespace === 'string' ? flags.namespace : undefined,
      entityId: typeof flags.entity === 'string' ? flags.entity : undefined,
      theme: typeof flags.theme === 'string' ? (flags.theme as HitboxTheme) : undefined,
      includeHud: flags.hud !== false,
      force: flags.force === true,
    });
    console.log(`[baked-ui] Initialized project in ${targetDir}`);
    for (const f of res.filesCreated) {
      console.log(`  + ${path.relative(targetDir, f)}`);
    }
    console.log('\nNext steps:');
    console.log('  1. baked-ui dev      # preview & inspect hitboxes/slots in your browser');
    console.log('  2. baked-ui bake     # compile HTML -> Bedrock RP JsonUI + BP manifest');
    console.log('  3. baked-ui validate # verify Bedrock constraints');
    return;
  }

  const configPath = typeof flags.config === 'string' ? flags.config : undefined;
  const config = loadConfig(configPath);

  if (cmd === 'dev' || cmd === 'preview') {
    const port = typeof flags.port === 'string' ? Number(flags.port) : 4173;
    const mode = flags.hud === true ? 'hud' : 'site';
    const srv = await startPreviewServer(config, { port, mode });
    console.log(`[baked-ui] Preview (${mode}) running at ${srv.url}`);
    console.log('[baked-ui] Press Shift+I in browser to toggle hitbox / dyn / anim inspector.');
    process.on('SIGINT', async () => {
      await srv.close();
      process.exit(0);
    });
    return;
  }

  if (cmd === 'bake') {
    if (typeof flags.scale === 'string') {
      config.site.texScale = Math.max(1, Math.min(3, Number(flags.scale) || config.site.texScale));
    }
    if (flags.quantize === false) {
      config.site.quantize = false;
    }
    const res = await bakeSite(config);
    console.log(
      `[baked-ui] Baked ${res.stateCount} states (${res.uniquePngs} unique PNGs, ${fmtKb(res.totalBytes)}), ` +
        `${res.hitboxCount} hitboxes, ${res.animCount} flip_books, ${res.motionCount} 60fps motions, ${res.dynCount} dyn slots.`,
    );
    console.log(`[baked-ui] Manifest -> ${res.manifestPath}`);

    const report = validateSiteBake(config);
    for (const issue of report.issues) {
      const prefix = issue.level === 'error' ? 'ERROR' : 'WARN';
      console.log(`[baked-ui] ${prefix} (${issue.code}): ${issue.message}`);
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'bake-hud') {
    if (typeof flags.scale === 'string') {
      config.hud.texScale = Math.max(1, Math.min(4, Number(flags.scale) || config.hud.texScale));
    }
    if (typeof flags.channel === 'string') {
      config.hud.channel = flags.channel as HudChannel;
    }
    console.log(`[baked-ui] [experimental] Baking transparent HUD (channel=${config.hud.channel})...`);
    const res = await bakeHud(config);
    console.log(
      `[baked-ui] Baked ${res.widgetCount} widgets, ${res.animCount} flip_books, ${res.dynCount} live HUD fields.`,
    );
    console.log(`[baked-ui] Manifest -> ${res.manifestPath}`);
    return;
  }

  if (cmd === 'validate') {
    const report = validateSiteBake(config);
    console.log(
      `[baked-ui] Stats: ${report.stats.stateCount} states, ${report.stats.hitboxCount} hitboxes, ` +
        `${report.stats.dynCount} dyn slots (max ${report.stats.maxButtonsPerState}/${report.stats.maxSlotBudget} buttons/page), ` +
        `${report.stats.animCount} flip_books, ${report.stats.motionCount} 60fps motions.`,
    );
    for (const issue of report.issues) {
      const prefix = issue.level === 'error' ? 'ERROR' : 'WARN';
      console.log(`  [${prefix}] ${issue.code}: ${issue.message}`);
    }
    if (!report.ok) {
      console.error('[baked-ui] Validation failed.');
      process.exitCode = 1;
    } else {
      console.log('[baked-ui] Validation passed.');
    }
    return;
  }

  console.error(`Unknown command: '${cmd}'\n`);
  console.log(HELP);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`[baked-ui] Failed: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});
