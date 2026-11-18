import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bakeHud,
  bakeSite,
  loadConfig,
  readPngDimensions,
  scaffoldProject,
  startPreviewServer,
  validateSiteBake,
} from '../dist/index.js';

test('end-to-end: init -> preview -> bakeSite -> validate -> bakeHud (subtitle & title channels)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-baked-ui-e2e-'));
  try {
    // 1. Scaffold starter project
    const initRes = scaffoldProject({
      targetDir: tmpDir,
      namespace: 'demo_ui',
      entityId: 'demo_ui:menu',
      theme: 'gold',
      includeHud: true,
    });
    assert.ok(initRes.filesCreated.length >= 4);

    const config = loadConfig(tmpDir);
    assert.equal(config.namespace, 'demo_ui');
    assert.equal(config.entityId, 'demo_ui:menu');

    // 2. Preview server injects inspector overlay cleanly
    const srv = await startPreviewServer(config, { port: 0 });
    try {
      const html = await fetch(srv.url).then((r) => r.text());
      assert.ok(html.includes('BEDROCK BAKED UI'));
      assert.ok(html.includes('__bui_dev_bar'));
    } finally {
      await srv.close();
    }

    // 3. Fullscreen Menu Bake (pure Node, zero Python/Pillow)
    const siteRes = await bakeSite(config);
    assert.equal(siteRes.stateCount, 3);
    assert.equal(siteRes.uniquePngs, 3);
    assert.equal(siteRes.animCount, 1);
    assert.equal(siteRes.dynCount, 4);
    assert.ok(siteRes.hitboxCount > 0 && siteRes.hitboxCount <= 100);
    assert.ok(fs.existsSync(siteRes.manifestPath));

    // Verify BP & RP invisible entity files were emitted
    assert.ok(fs.existsSync(path.join(config.bpDir, 'entities', 'demo_ui_menu.json')));
    assert.ok(fs.existsSync(path.join(config.rpDir, 'entity', 'demo_ui_menu.entity.json')));
    assert.ok(fs.existsSync(path.join(config.rpDir, 'models', 'entity', 'demo_ui_menu.geo.json')));
    assert.ok(fs.existsSync(path.join(config.rpDir, 'render_controllers', 'demo_ui_menu.render_controllers.json')));
    assert.ok(fs.existsSync(path.join(config.rpDir, 'textures', 'entity', 'demo_ui', 'empty.png')));

    // Verify flipbook spritesheet dimensions & sidecar JSON
    const anim = siteRes.manifest.animations.beacon;
    assert.ok(anim);
    const animPng = path.join(config.rpDir, anim.texturePng);
    assert.ok(fs.existsSync(animPng));
    assert.deepEqual(readPngDimensions(fs.readFileSync(animPng)), { width: anim.sheetW, height: anim.sheetH });
    assert.ok(anim.sheetW <= 2800);

    // 4. Built-in Validator passes with 0 errors
    const report = validateSiteBake(config);
    assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
    assert.equal(report.stats.stateCount, 3);
    assert.equal(report.stats.maxSlotBudget, 21);

    // 5. Experimental HUD Bake (subtitle channel)
    const hudRes = await bakeHud(config);
    assert.equal(hudRes.widgetCount, 1);
    assert.equal(hudRes.animCount, 1);
    assert.equal(hudRes.dynCount, 2);
    assert.equal(hudRes.manifest.experimental, true);
    assert.equal(hudRes.manifest.channel, 'subtitle');
    assert.ok(fs.existsSync(path.join(config.rpDir, 'ui', 'demo_ui_hud.json')));
    assert.ok(fs.existsSync(path.join(config.rpDir, 'ui', 'hud_screen.json')));

    // 6. Experimental HUD Bake (title channel for 1.26.65+ fallback)
    config.hud.channel = 'title';
    const hudTitleRes = await bakeHud(config);
    assert.equal(hudTitleRes.manifest.channel, 'title');
    const hudUiText = fs.readFileSync(path.join(config.rpDir, 'ui', 'demo_ui_hud.json'), 'utf8');
    // '§h§u§d' is 9 UTF-8 bytes, so the first 20-byte field must slice bytes [9..29) on #hud_title_text_string
    assert.ok(hudUiText.includes("'%.29s' * #hud_title_text_string"));
    assert.ok(hudUiText.includes("'%.9s' * #hud_title_text_string"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
