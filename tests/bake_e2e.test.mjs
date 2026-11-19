import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bakeHud,
  bakeSite,
  decodePng,
  imagesPixelEqual,
  loadConfig,
  packAddon,
  readPngDimensions,
  scaffoldProject,
  startPreviewServer,
  validateSiteBake,
} from '../dist/index.js';
import { buildInvSlotPlan, createMenuState, isBakedMarkerTag } from '../dist/runtime/sim.js';

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

test('v0.3 features: CSS :hover/:active (data-hit-fx), custom data-sound, entrance motions, [data-bar], HUD motion, and packAddon (.mcaddon)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-baked-ui-v03-'));
  try {
    scaffoldProject({
      targetDir: tmpDir,
      namespace: 'v03_ui',
      entityId: 'v03_ui:menu',
      theme: 'neon',
      includeHud: true,
    });
    const config = loadConfig(tmpDir);

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1056px; height: 594px; background: #0f172a; overflow: hidden; }
  #app { position: relative; width: 1056px; height: 594px; background: #0f172a; }
  .cta {
    position: absolute; left: 80px; top: 80px; width: 200px; height: 56px;
    background: #1e293b; color: #f8fafc; display: flex; align-items: center; justify-content: center;
    border-radius: 10px; font: 700 16px sans-serif;
  }
  .cta:hover { background: #10b981; color: #052e16; }
  .cta:active { background: #f59e0b; color: #451a03; }
  .card {
    position: absolute; left: 80px; top: 180px; width: 200px; height: 90px;
    background: #38bdf8; border-radius: 12px;
  }
  .track {
    position: absolute; left: 80px; top: 320px; width: 320px; height: 28px;
    background: #1e293b; border-radius: 8px; overflow: hidden;
  }
  .bar-fill {
    width: 100%; height: 100%; background: linear-gradient(90deg, #10b981, #34d399);
  }
  .close-btn {
    position: absolute; right: 24px; top: 24px; width: 80px; height: 36px;
    background: #991b1b; color: #fff; display: flex; align-items: center; justify-content: center;
  }
</style>
</head>
<body>
<div id="app">
  <div class="cta" data-hit="buy" data-hit-fx="1" data-sound="random.orb" data-sound-pitch="1.3" data-sound-volume="0.8">Buy Now</div>
  <div class="card" data-motion="enter_card" data-motion-type="enter-up+enter-fade" data-motion-amp="24" data-motion-duration="0.4" data-motion-delay="0.2"></div>
  <div class="track"><div class="bar-fill" data-bar="hp" data-bar-dir="left"></div></div>
  <div class="close-btn" data-hit="close" data-special="close" data-sound="random.pop">Close</div>
</div>
<script>
  window.__BAKE__ = {
    getStateKey: () => 'main',
    setStateKey: () => {},
    clickHit: () => 'main',
    getMeta: () => ({ url: 'main', title: 'v03 Test' }),
  };
</script>
</body>
</html>`;
    fs.writeFileSync(config.site.entry, html, 'utf8');

    // Add a [data-motion] element to HUD HTML too
    const hudHtml = fs.readFileSync(config.hud.entry, 'utf8').replace(
      '</body>',
      '<div data-motion="hud_gem" data-motion-type="float+glow" style="position:absolute;left:24px;top:24px;width:32px;height:32px;border-radius:50%;background:#34d399;"></div></body>',
    );
    fs.writeFileSync(config.hud.entry, hudHtml, 'utf8');

    const res = await bakeSite(config);
    assert.equal(res.hitFxCount, 1);
    assert.equal(res.motionCount, 1);
    assert.equal(res.barCount, 1);

    const buyBtn = res.manifest.states.main.buttons.find((b) => b.hitId === 'buy');
    assert.ok(buyBtn?.hitFxHover && buyBtn?.hitFxPress);
    assert.equal(buyBtn.sound, 'random.orb');
    assert.equal(buyBtn.soundPitch, 1.3);

    // 1. Hover PNG (green #10b981) and Press PNG (amber #f59e0b) must differ visually
    const hoverImg = decodePng(fs.readFileSync(path.join(config.rpDir, buyBtn.hitFxHover)));
    const pressImg = decodePng(fs.readFileSync(path.join(config.rpDir, buyBtn.hitFxPress)));
    assert.equal(imagesPixelEqual(hoverImg, pressImg), false, ':hover and :active PNGs should differ');

    // 2. Entrance motion should have delayed hold -> one-shot (no back-loop next on _a)
    const uiJson = JSON.parse(fs.readFileSync(path.join(config.rpDir, 'ui', 'v03_ui.json'), 'utf8'));
    assert.equal(uiJson.mot_enter_card_off_w.anim_type, 'offset');
    assert.equal(uiJson.mot_enter_card_off_w.next, '@v03_ui.mot_enter_card_off_a');
    assert.equal(uiJson.mot_enter_card_off_a.next, undefined, 'One-shot entrance should not loop');
    assert.equal(uiJson.mot_enter_card_al_w.from, 0);
    assert.equal(uiJson.mot_enter_card_al_w.to, 0);
    assert.equal(uiJson.mot_enter_card_al_a.from, 0);
    assert.equal(uiJson.mot_enter_card_al_a.to, 1);

    // 3. Progress bar: JsonUI has 20-step clips_children bars and runtime sim formats §b§15 for 75%
    const uiText = JSON.stringify(uiJson);
    assert.ok(uiText.includes('"bf_15"'));
    assert.ok(uiText.includes('"clips_children":true'));
    assert.ok(uiJson.st_enter_00, 'One-shot entrance motions should be hosted in st_enter_00 factory template');
    assert.ok(uiText.includes('"type":"collection_panel"'));
    const st = createMenuState(res.manifest);
    const plan = buildInvSlotPlan(res.manifest, st, {}, { hp: 75 });
    const barSlot = plan.find((p) => p.nameTag === '§b§15');
    assert.ok(barSlot, 'buildInvSlotPlan should emit bar marker §b§15 for 75%');
    assert.equal(isBakedMarkerTag(barSlot.nameTag), true);

    // 4. HUD motion bake
    const hudRes = await bakeHud(config);
    assert.equal(hudRes.motionCount, 1);
    assert.ok(fs.existsSync(path.join(config.rpDir, hudRes.manifest.motions[0].texturePng)));

    // 5. One-click packAddon (.mcaddon ZIP with POSIX slashes & no .ts files)
    const packRes = await packAddon(config, { skipBake: true, skipBundle: true });
    assert.ok(fs.existsSync(packRes.outPath));
    assert.ok(packRes.entries >= 10);
    const zipBuf = fs.readFileSync(packRes.outPath);
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, 'Valid ZIP magic header');
    assert.ok(zipBuf.includes('v03_ui_bp/manifest.json'));
    assert.ok(zipBuf.includes('v03_ui_rp/manifest.json'));
    assert.equal(zipBuf.includes('.ts'), false, 'Should exclude TypeScript source files from .mcaddon');

    // 6. Preview server live motion CSS & SSE watch
    const srv = await startPreviewServer(config, { port: 0, watch: true });
    try {
      const pageHtml = await fetch(srv.url).then((r) => r.text());
      assert.ok(pageHtml.includes('__bui_dev_motion_css'));
      assert.ok(pageHtml.includes('/__bui_events'));
    } finally {
      await srv.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
