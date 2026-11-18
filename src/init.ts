// Starter project scaffolder (`baked-ui init`).
// Generates baked-ui.config.json, a 3-tab interactive HTML menu with live [data-dyn] and animated canvas [data-anim],
// an experimental transparent HUD template, and a ready-to-wire Behavior Pack TypeScript example.

import fs from 'node:fs';
import path from 'node:path';
import type { BakedUiConfig, HitboxTheme } from './types.js';
import { DEFAULT_CONFIG_FILENAME } from './config.js';

export interface InitOptions {
  targetDir: string;
  namespace?: string;
  entityId?: string;
  theme?: HitboxTheme;
  includeHud?: boolean;
  force?: boolean;
}

export interface InitResult {
  filesCreated: string[];
}

function starterSiteHtml(ns: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Starter Guild Menu</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  html, body {
    width: 1056px; height: 594px; overflow: hidden;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: #1c130a;
  }
  #app {
    position: relative; width: 1056px; height: 594px; overflow: hidden;
    background: repeating-linear-gradient(0deg, #24180d 0px, #24180d 22px, #1e140a 22px, #1e140a 24px);
    color: #2b1d10;
  }
  .a { position: absolute; overflow: hidden; }
  .frame {
    background: #3b2714;
    border: 4px solid;
    border-color: #6b4c2b #1a1007 #1a1007 #6b4c2b;
  }
  .parchment {
    background: #e5d4b1;
    border: 3px solid;
    border-color: #f8ecd0 #8d744c #8d744c #f8ecd0;
  }
  .btn {
    background: #c6c6c6;
    border: 3px solid;
    border-color: #ffffff #555555 #555555 #ffffff;
    color: #222;
    font-weight: 800;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    text-align: center;
  }
  .btn.active {
    background: #f0dfba;
    border-color: #fff6dc #8a6d3b #8a6d3b #fff6dc;
  }
  .btn.gold {
    background: #a87c1e;
    border-color: #f6cf66 #4a3307 #4a3307 #f6cf66;
    color: #fff9e2;
  }
  .btn.green {
    background: #357d2c;
    border-color: #78d868 #143b0f #143b0f #78d868;
    color: #f4fff2;
  }
  .btn.red {
    background: #9f2b27;
    border-color: #e86b64 #4a100d #4a100d #e86b64;
    color: #fff6f2;
  }
  .nav {
    background: #5a3c20;
    border: 3px solid;
    border-color: #8a623c #24160a #24160a #8a623c;
    color: #f3e4c6;
    font-weight: 800;
    font-size: 15px;
    cursor: pointer;
    display: flex; align-items: center; padding: 0 14px;
  }
  .nav.on {
    background: #e5d4b1;
    border-color: #fff3d8 #7a5c34 #7a5c34 #fff3d8;
    color: #2b1a09;
  }
  /* Opaque solid background-color required for every [data-dyn] container! */
  .wallet-box {
    background-color: #2b1d10;
    border: 3px solid;
    border-color: #160e07 #6b4c2b #6b4c2b #160e07;
    display: flex; align-items: center; padding: 0 10px;
  }
  .dynval {
    background-color: #2b1d10;
    color: #ffe28a;
    font-size: 15px;
    font-weight: 900;
    display: flex; align-items: center;
    white-space: nowrap;
  }
  .dock-box {
    background-color: #24180c;
    border: 3px solid;
    border-color: #120b05 #634424 #634424 #120b05;
  }
  .dynrow {
    background-color: #24180c;
    color: #fff5df;
    font-size: 13px;
    font-weight: 800;
    display: flex; align-items: center; padding-left: 8px;
    white-space: nowrap;
  }
  .card {
    background: #d8c6a0;
    border: 3px solid;
    border-color: #f4e8cc #7d6641 #7d6641 #f4e8cc;
    cursor: pointer;
    padding: 12px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  var state = { tab: 'home' }; // 'home' | 'shop' | 'settings'
  var animPhase = 0;

  var SHOP_ITEMS = [
    { id: 'pick_0', name: 'Iron Blade', cost: '120 G', desc: 'Balanced melee starter weapon.' },
    { id: 'pick_1', name: 'Oak Shield', cost: '90 G', desc: 'Blocks arrows and heavy strikes.' },
    { id: 'pick_2', name: 'Swift Boots', cost: '150 G', desc: '+15% movement speed in combat.' },
    { id: 'pick_3', name: 'Healing Stew', cost: '45 G', desc: 'Restores 8 HP instantly.' }
  ];

  function drawBeacon(phase) {
    var cv = document.getElementById('beacon_cv');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = 132, h = 112;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#24180c';
    ctx.fillRect(0, 0, w, h);

    var cx = w / 2, cy = h / 2;
    var tau = Math.PI * 2;
    // Vertical beam shimmer
    var beamW = 14 + Math.round(Math.sin(phase * tau) * 3);
    ctx.fillStyle = 'rgba(94, 234, 212, 0.25)';
    ctx.fillRect(cx - beamW, 6, beamW * 2, h - 12);
    ctx.fillStyle = 'rgba(153, 246, 228, 0.65)';
    ctx.fillRect(cx - 5, 6, 10, h - 12);

    // Orbiting pixel motes (seamless 0..1 loop)
    for (var i = 0; i < 6; i++) {
      var ang = (phase + i / 6) * tau;
      var px = Math.round(cx + Math.cos(ang) * 34);
      var py = Math.round(cy + Math.sin(ang) * 20);
      ctx.fillStyle = i % 2 === 0 ? '#fde047' : '#5eead4';
      ctx.fillRect(px - 3, py - 3, 6, 6);
    }

    // Floating crystal core
    var bob = Math.round(Math.sin(phase * tau) * 4);
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(cx - 14, cy - 14 + bob, 28, 28);
    ctx.fillStyle = '#5eead4';
    ctx.fillRect(cx - 10, cy - 10 + bob, 20, 20);
    ctx.fillStyle = '#f0fdfa';
    ctx.fillRect(cx - 5, cy - 5 + bob, 10, 10);
  }

  function renderChrome() {
    return (
      '<div class="a frame" style="left:16px;top:14px;width:1024px;height:66px;">' +
        '<div class="a" style="left:18px;top:14px;width:440px;height:36px;color:#f8ecd0;font-size:24px;font-weight:900;letter-spacing:0.5px;">BEDROCK BAKED UI</div>' +
        '<div class="a wallet-box" style="left:650px;top:10px;width:146px;height:40px;">' +
          '<div class="a dynval" data-dyn="coins" data-dyn-scale="0.95" data-dyn-align="left" style="left:8px;top:4px;width:124px;height:32px;">1,250 G</div>' +
        '</div>' +
        '<div class="a wallet-box" style="left:806px;top:10px;width:128px;height:40px;">' +
          '<div class="a dynval" data-dyn="gems" data-dyn-scale="0.95" data-dyn-align="left" style="left:8px;top:4px;width:106px;height:32px;">12 Gems</div>' +
        '</div>' +
        '<div class="a btn red" data-hit="close_menu" data-special="close" data-label="Close" style="left:946px;top:10px;width:62px;height:40px;font-size:18px;">X</div>' +
      '</div>' +
      '<div class="a frame" style="left:16px;top:90px;width:196px;height:382px;">' +
        '<div class="a nav ' + (state.tab === 'home' ? 'on' : '') + '" data-hit="nav_home" data-label="Overview" style="left:12px;top:16px;width:164px;height:52px;">OVERVIEW</div>' +
        '<div class="a nav ' + (state.tab === 'shop' ? 'on' : '') + '" data-hit="nav_shop" data-label="Armory Shop" style="left:12px;top:80px;width:164px;height:52px;">ARMORY SHOP</div>' +
        '<div class="a nav ' + (state.tab === 'settings' ? 'on' : '') + '" data-hit="nav_settings" data-label="Settings" style="left:12px;top:144px;width:164px;height:52px;">SETTINGS</div>' +
        '<canvas id="beacon_cv" class="a" data-anim="beacon" data-frames="10" data-fps="5" style="left:28px;top:244px;width:132px;height:112px;border:3px solid #6b4c2b;"></canvas>' +
      '</div>' +
      '<div class="a dock-box" style="left:16px;top:482px;width:1024px;height:98px;">' +
        '<div class="a dynrow" data-dyn="line1" data-dyn-scale="0.95" style="left:10px;top:8px;width:996px;height:36px;">Welcome to ${ns}! Click any button to trigger server actions.</div>' +
        '<div class="a dynrow" data-dyn="line2" data-dyn-scale="0.90" style="left:10px;top:48px;width:996px;height:36px;">Zero-flicker Entity Inventory UI · 4 dyn slots => up to 21 buttons/page.</div>' +
      '</div>'
    );
  }

  function renderBody() {
    if (state.tab === 'shop') {
      var cards = '';
      for (var i = 0; i < SHOP_ITEMS.length; i++) {
        var it = SHOP_ITEMS[i];
        var col = i % 2;
        var row = Math.floor(i / 2);
        cards +=
          '<div class="a card" data-hit="' + it.id + '" data-label="' + it.name + '" style="left:' + (24 + col * 380) + 'px;top:' + (68 + row * 116) + 'px;width:360px;height:102px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:18px;font-weight:900;">' + it.name + '</span>' +
              '<span style="background:#5a3c20;color:#ffe28a;padding:2px 8px;font-size:13px;font-weight:900;">' + it.cost + '</span>' +
            '</div>' +
            '<div style="font-size:13px;color:#4a3520;">' + it.desc + '</div>' +
          '</div>';
      }
      return (
        '<div class="a parchment" style="left:224px;top:90px;width:816px;height:382px;">' +
          '<div class="a" style="left:24px;top:18px;width:520px;height:36px;font-size:22px;font-weight:900;">ARMORY SHOP</div>' +
          cards +
          '<div class="a btn green" data-hit="act_buy" data-label="Purchase Selected" style="left:24px;top:308px;width:740px;height:52px;font-size:17px;">PURCHASE SELECTED ITEM</div>' +
        '</div>'
      );
    }

    if (state.tab === 'settings') {
      return (
        '<div class="a parchment" style="left:224px;top:90px;width:816px;height:382px;">' +
          '<div class="a" style="left:24px;top:18px;width:520px;height:36px;font-size:22px;font-weight:900;">PREFERENCES</div>' +
          '<div class="a btn active" data-hit="act_toggle_sfx" data-label="Toggle Sound FX" style="left:24px;top:84px;width:360px;height:68px;font-size:16px;">TOGGLE SOUND FX</div>' +
          '<div class="a btn active" data-hit="act_toggle_hud" data-label="Toggle HUD" style="left:410px;top:84px;width:360px;height:68px;font-size:16px;">TOGGLE EXPERIMENTAL HUD</div>' +
          '<div class="a btn gold" data-hit="act_reset" data-label="Reset Demo Data" style="left:24px;top:180px;width:746px;height:64px;font-size:16px;">RESET DEMO WALLET</div>' +
        '</div>'
      );
    }

    return (
      '<div class="a parchment" style="left:224px;top:90px;width:816px;height:382px;">' +
        '<div class="a" style="left:24px;top:20px;width:680px;height:38px;font-size:24px;font-weight:900;">COMMAND OVERVIEW</div>' +
        '<div class="a" style="left:24px;top:66px;width:740px;height:60px;font-size:15px;line-height:1.5;color:#4a3520;">' +
          'Build Minecraft Bedrock UIs with standard HTML, CSS, and Canvas. Run <b>baked-ui bake</b> to compile states, hitboxes, flip_book animations, and dynamic text slots into JsonUI.' +
        '</div>' +
        '<div class="a btn green" data-hit="act_play" data-label="Deploy to Arena" style="left:24px;top:148px;width:364px;height:86px;font-size:20px;">DEPLOY TO ARENA</div>' +
        '<div class="a btn gold" data-hit="act_claim" data-label="Claim Daily Reward" style="left:410px;top:148px;width:364px;height:86px;font-size:20px;">CLAIM DAILY (+100G)</div>' +
        '<div class="a btn active" data-hit="nav_shop" data-label="Open Shop" style="left:24px;top:256px;width:750px;height:68px;font-size:18px;">OPEN ARMORY SHOP &rarr;</div>' +
      '</div>'
    );
  }

  function render() {
    var app = document.getElementById('app');
    app.innerHTML = renderChrome() + renderBody();
    if (window.__BAKE_HEADLESS__) {
      app.querySelectorAll('[data-dyn]').forEach(function (el) { el.style.color = 'transparent'; });
    }
    drawBeacon(animPhase);
  }

  function onHit(id) {
    if (id === 'nav_home') state.tab = 'home';
    else if (id === 'nav_shop') state.tab = 'shop';
    else if (id === 'nav_settings') state.tab = 'settings';
    render();
  }

  document.getElementById('app').addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-hit]');
    if (btn) onHit(btn.getAttribute('data-hit'));
  });

  render();

  if (!window.__BAKE_HEADLESS__) {
    var t0 = performance.now();
    var loop = function (now) {
      if (!window.__BAKE_PAUSED__) {
        animPhase = ((now - t0) % 2000) / 2000;
        drawBeacon(animPhase);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  window.__BAKE__ = {
    getStateKey: function () { return state.tab; },
    getMeta: function () { return { url: 'baked://' + state.tab, title: 'Starter Menu · ' + state.tab.toUpperCase() }; },
    setStateKey: function (key) {
      state.tab = (key === 'shop' || key === 'settings') ? key : 'home';
      render();
    },
    setAnimFrame: function (phase) {
      window.__BAKE_PAUSED__ = true;
      animPhase = phase;
      drawBeacon(animPhase);
    },
    clickHit: function (hitId) {
      var el = document.querySelector('[data-hit="' + hitId + '"]');
      if (el) el.click();
      return state.tab;
    }
  };
})();
</script>
</body>
</html>
`;
}

function starterHudHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Starter Experimental HUD</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1056px; height: 594px; overflow: hidden;
    background: transparent;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .a { position: absolute; }
  .hud-card {
    background: rgba(20, 15, 10, 0.84);
    border: 3px solid;
    border-color: #8c633b #120b05 #120b05 #8c633b;
    border-radius: 6px;
  }
  .hud-text {
    color: #f8fafc;
    font-size: 13px;
    font-weight: 800;
    display: flex; align-items: center;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div class="a hud-card" data-hud-widget="status_bar" style="left:16px;top:14px;width:360px;height:66px;">
    <canvas id="pulse_orb" class="a" data-anim="orb" data-frames="8" data-fps="6" style="left:10px;top:11px;width:40px;height:40px;"></canvas>
    <div class="a hud-text" data-hud-dyn="player" data-dyn-len="20" data-dyn-scale="0.95" style="left:60px;top:8px;width:284px;height:24px;color:#fde68a;">Steve | HP 20/20</div>
    <div class="a hud-text" data-hud-dyn="status" data-dyn-tail="1" data-dyn-scale="0.88" style="left:60px;top:34px;width:284px;height:24px;color:#a7f3d0;">Ready · Quest Active</div>
  </div>
<script>
(function () {
  var phase = 0;
  function drawOrb(p) {
    var cv = document.getElementById('pulse_orb');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = 40, h = 40;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var r = 10 + Math.sin(p * Math.PI * 2) * 3;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.beginPath(); ctx.arc(20, 20, r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(20, 20, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath(); ctx.arc(18, 17, 4, 0, Math.PI * 2); ctx.fill();
  }
  drawOrb(0);
  if (!window.__BAKE_HEADLESS__) {
    var t0 = performance.now();
    var tick = function (now) {
      if (!window.__BAKE_PAUSED__) {
        phase = ((now - t0) % 1400) / 1400;
        drawOrb(phase);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  window.__BAKE__ = {
    setAnimFrame: function (p) { window.__BAKE_PAUSED__ = true; phase = p; drawOrb(p); }
  };
})();
</script>
</body>
</html>
`;
}

function starterBpExample(): string {
  return `// Example Behavior Pack wiring using bedrock-baked-ui/runtime.
// After running \`baked-ui bake\`, import your generated manifest and register BakedMenuManager.

import { world } from '@minecraft/server';
import { BakedMenuManager, fitText } from 'bedrock-baked-ui/runtime';
import manifest from './generated/baked_site.json';

interface PlayerWallet {
  coins: number;
  gems: number;
  selectedItem: number;
  sfx: boolean;
}

const wallets = new Map<string, PlayerWallet>();
function walletOf(name: string): PlayerWallet {
  let w = wallets.get(name);
  if (!w) {
    w = { coins: 1250, gems: 12, selectedItem: 0, sfx: true };
    wallets.set(name, w);
  }
  return w;
}

const SHOP_PRICES = [120, 90, 150, 45];
const SHOP_NAMES = ['Iron Blade', 'Oak Shield', 'Swift Boots', 'Healing Stew'];

export const menu = new BakedMenuManager(manifest, {
  triggerItemId: 'minecraft:compass',

  resolveDynamicValues(player, state) {
    const w = walletOf(player.name);
    const pick = SHOP_NAMES[w.selectedItem] ?? SHOP_NAMES[0];
    const price = SHOP_PRICES[w.selectedItem] ?? 0;
    return {
      coins: \`§6§l\${w.coins.toLocaleString('en-US')} G\`,
      gems: \`§b§l\${w.gems} Gems\`,
      line1: fitText(
        state.bakedKey === 'shop'
          ? \`§6Selected: §f\${pick} §7(\${price} G) | Click PURCHASE to buy\`
          : \`§aWelcome, \${player.name}! §7State: \${state.bakedKey} | Clicks: \${state.clicks}\`,
        58,
      ),
      line2: fitText(\`§7SFX: \${w.sfx ? '§aON' : '§cOFF'} §7| Zero-flicker Entity Inventory UI\`, 58),
    };
  },

  onButtonClick(player, button) {
    const w = walletOf(player.name);
    if (button.hitId === 'act_claim') {
      w.coins += 100;
      if (w.sfx) player.playSound('random.levelup', { volume: 0.6, pitch: 1.2 });
    } else if (button.hitId.startsWith('pick_')) {
      w.selectedItem = Number(button.hitId.slice(5)) || 0;
    } else if (button.hitId === 'act_buy') {
      const price = SHOP_PRICES[w.selectedItem] ?? 0;
      if (w.coins >= price) {
        w.coins -= price;
        player.sendMessage(\`§aPurchased \${SHOP_NAMES[w.selectedItem]}!\`);
      } else {
        player.sendMessage('§cNot enough coins!');
      }
    } else if (button.hitId === 'act_toggle_sfx') {
      w.sfx = !w.sfx;
    } else if (button.hitId === 'act_reset') {
      w.coins = 1250;
      w.gems = 12;
    }
  },
});

export function initStarterMenu(): void {
  menu.install();

  // Optional chat command to open ActionFormData fallback: \`!menu form\`
  world.beforeEvents.chatSend.subscribe((ev) => {
    if (ev.message.trim() === '!menu form') {
      ev.cancel = true;
      void menu.openActionFormFallback(ev.sender);
    }
  });
}
`;
}

export function scaffoldProject(opts: InitOptions): InitResult {
  const dir = path.resolve(opts.targetDir);
  const namespace = opts.namespace ?? 'my_ui';
  const entityId = opts.entityId ?? `${namespace}:menu`;
  const theme: HitboxTheme = opts.theme ?? 'gold';
  const includeHud = opts.includeHud ?? true;

  const configObj: BakedUiConfig = {
    namespace,
    entityId,
    rpDir: 'packs/rp',
    bpDir: 'packs/bp',
    site: {
      entry: 'ui-src/index.html',
      viewport: [1056, 594],
      sourceScale: 3,
      texScale: 2,
      maxStates: 64,
      maxSheetWidth: 2800,
      theme,
      backdropColor: [28, 19, 10],
      quantize: true,
      emitEntity: true,
      emitActionForm: true,
      textureSubdir: 'baked_ui',
      manifestOut: 'packs/bp/src/generated/baked_site.json',
    },
    ...(includeHud
      ? {
          hud: {
            entry: 'ui-src/hud.html',
            viewport: [1056, 594],
            texScale: 3,
            maxSheetWidth: 2800,
            hudTag: '§h§u§d',
            hudOffTag: `${namespace}.off`,
            channel: 'subtitle',
            textureSubdir: 'baked_hud',
            manifestOut: 'packs/bp/src/generated/baked_hud.json',
          },
        }
      : {}),
  };

  const files: Array<{ rel: string; content: string }> = [
    { rel: DEFAULT_CONFIG_FILENAME, content: JSON.stringify(configObj, null, 2) + '\n' },
    { rel: 'ui-src/index.html', content: starterSiteHtml(namespace) },
    { rel: 'packs/bp/src/menu_example.ts', content: starterBpExample() },
  ];

  if (includeHud) {
    files.push({ rel: 'ui-src/hud.html', content: starterHudHtml() });
  }

  const filesCreated: string[] = [];
  for (const f of files) {
    const abs = path.join(dir, f.rel);
    if (fs.existsSync(abs) && !opts.force) {
      throw new Error(`File already exists: ${abs}. Pass --force to overwrite.`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
    filesCreated.push(abs);
  }

  return { filesCreated };
}
