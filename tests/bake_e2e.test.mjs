import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bakeHud,
  bakeSite,
  decodePng,
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

test('native 60fps [data-motion]: transparent RGBA sprites, ghost-free background, chained JsonUI offset/size/alpha', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-baked-ui-motion-'));
  try {
    scaffoldProject({
      targetDir: tmpDir,
      namespace: 'mot_ui',
      entityId: 'mot_ui:menu',
      theme: 'neon',
      includeHud: false,
    });
    const config = loadConfig(tmpDir);

    // Replace starter HTML with a focused [data-motion] test page
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1056px; height: 594px; background: #101420; overflow: hidden; }
  #app { position: relative; width: 1056px; height: 594px; background: #101420; }
  .orb {
    position: absolute; left: 100px; top: 100px; width: 80px; height: 80px;
    border-radius: 50%; background: #ff2266;
  }
  .badge {
    position: absolute; left: 260px; top: 100px; width: 120px; height: 60px;
    border-radius: 16px; background: #22d3ee;
  }
  .glowonly {
    position: absolute; left: 420px; top: 100px; width: 64px; height: 64px;
    border-radius: 12px; background: #a855f7;
  }
  .close-btn {
    position: absolute; right: 24px; top: 24px; width: 80px; height: 36px;
    background: #334155; color: #fff; display: flex; align-items: center; justify-content: center;
  }
</style>
</head>
<body>
<div id="app">
  <div class="orb" data-motion="orb" data-motion-type="float+glow" data-motion-amp="12" data-motion-min="0.3" data-motion-duration="1.1"></div>
  <div class="badge" data-motion="badge" data-motion-type="pulse+slide-x" data-motion-amp="10" data-motion-scale="1.12" data-motion-delay="0.25"></div>
  <div class="glowonly" data-motion="glowonly" data-motion-type="glow" data-motion-min="0.25"></div>
  <div class="close-btn" data-hit="close" data-special="close">Close</div>
</div>
<script>
  window.__BAKE__ = {
    getStateKey: () => 'home',
    setStateKey: () => {},
    clickHit: () => 'home',
    getMeta: () => ({ url: 'home', title: 'Motion Test' }),
  };
</script>
</body>
</html>`;
    fs.writeFileSync(config.site.entry, html, 'utf8');

    const res = await bakeSite(config);
    assert.equal(res.stateCount, 1);
    assert.equal(res.motionCount, 3);
    assert.ok(res.manifest.motions?.orb);
    assert.ok(res.manifest.motions?.badge);
    assert.ok(res.manifest.motions?.glowonly);

    // 1. Verify transparent RGBA capture on the circular orb (corner is transparent, center is magenta)
    const orbPng = fs.readFileSync(path.join(config.rpDir, res.manifest.motions.orb.texturePng));
    const orbImg = decodePng(orbPng);
    assert.equal(orbImg.data[3], 0, 'Corner of circular motion sprite should be transparent (alpha=0)');
    const midIdx = (Math.floor(orbImg.height / 2) * orbImg.width + Math.floor(orbImg.width / 2)) * 4;
    assert.ok(orbImg.data[midIdx] > 200 && orbImg.data[midIdx + 3] === 255, 'Center of orb should be opaque magenta');

    // 2. Verify static state background has NO ghost copy of the magenta orb
    const bgPng = fs.readFileSync(path.join(config.rpDir, res.manifest.states.home.texturePng));
    const bgImg = decodePng(bgPng);
    const scale = config.site.texScale;
    const bgOrbCenter = (Math.floor(140 * scale) * bgImg.width + Math.floor(140 * scale)) * 4;
    assert.ok(bgImg.data[bgOrbCenter] < 40, `Background should be dark #101420 with no ghost orb, got R=${bgImg.data[bgOrbCenter]}`);

    // 3. Verify generated JsonUI has native offset, size, alpha, wait animations & ping-pong chaining
    const uiJson = JSON.parse(fs.readFileSync(path.join(config.rpDir, 'ui', 'mot_ui.json'), 'utf8'));
    assert.equal(uiJson.mot_orb_off_a.anim_type, 'offset');
    assert.equal(uiJson.mot_orb_off_a.next, '@mot_ui.mot_orb_off_b');
    assert.equal(uiJson.mot_orb_off_b.next, '@mot_ui.mot_orb_off_a');
    assert.equal(uiJson.mot_orb_al_a.anim_type, 'alpha');
    assert.equal(uiJson.mot_badge_sz_a.anim_type, 'size');
    assert.equal(uiJson.mot_badge_off_w.anim_type, 'wait');
    assert.equal(uiJson.mot_badge_off_w.next, '@mot_ui.mot_badge_off_a');

    // Regression: alpha-only motion puts animation on wrapper panel, so inner static sprite must NOT set disable_anim_fast_forward
    const stControls = uiJson.inv_window.controls[0].inv_stack.controls[0].slot_01_state.controls[0].stpanel_00.controls;
    const glowWrapper = stControls.find((c) => c.motion_2)?.motion_2;
    assert.ok(glowWrapper?.alpha);
    assert.equal(glowWrapper.controls[0].sprite.disable_anim_fast_forward, undefined);

    // 4. Validator passes with 0 errors and reports motionCount=3
    const report = validateSiteBake(config);
    assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
    assert.equal(report.stats.motionCount, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
