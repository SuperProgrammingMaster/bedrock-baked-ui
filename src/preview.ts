// Local HTTP live preview server with an injected Baked UI Inspector overlay,
// live [data-motion] CSS simulation, and optional --watch SSE live reload / --auto-bake.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ResolvedBakedUiConfig } from './types.js';
import { bakeSite } from './bakers/site.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function buildInspectorSnippet(texScale: number, maxSheetW: number, enableWatch: boolean): string {
  return `
<!-- bedrock-baked-ui inspector overlay (dev preview only) -->
<script>
(function(){
  if (window.__BAKE_HEADLESS__) return;
  var enabled = false;
  var motionPreview = true;
  var bar = document.createElement('div');
  bar.id = '__bui_dev_bar';
  bar.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:999999;background:rgba(15,18,28,0.92);color:#e2e8f0;font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px 10px;border:1px solid #475569;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.45);user-select:none;max-width:480px;';
  var overlay = document.createElement('div');
  overlay.id = '__bui_dev_overlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999998;display:none;';
  var motStyle = document.createElement('style');
  motStyle.id = '__bui_dev_motion_css';
  document.head.appendChild(motStyle);
  document.body.appendChild(overlay);
  document.body.appendChild(bar);

  function cssEasing(e) {
    if (!e || e === 'in_out_sine' || e === 'in_out_quad') return 'ease-in-out';
    if (e === 'linear') return 'linear';
    if (e.indexOf('in_out') === 0) return 'cubic-bezier(0.65, 0, 0.35, 1)';
    if (e.indexOf('out_') === 0) return 'cubic-bezier(0.22, 1, 0.36, 1)';
    if (e.indexOf('in_') === 0) return 'cubic-bezier(0.32, 0, 0.67, 0)';
    return 'ease-in-out';
  }

  var lastMotSig = '';
  function syncMotionCss(motions) {
    if (!motionPreview) {
      if (lastMotSig !== 'OFF') { motStyle.textContent = ''; lastMotSig = 'OFF'; }
      return;
    }
    var rules = [];
    var sig = [];
    motions.forEach(function(el, idx) {
      var id = (el.getAttribute('data-motion') || ('m' + idx)).replace(/[^a-z0-9_]/gi, '_') + '_' + idx;
      el.setAttribute('data-bui-pm', id);
      var rawType = (el.getAttribute('data-motion-type') || 'float').toLowerCase();
      var effects = rawType.split(/[+,\\s]+/).filter(Boolean);
      var hasEnterOff = effects.some(function(e){ return e.indexOf('enter-') === 0 && e !== 'enter-fade' && e !== 'enter-pop'; });
      var amp = parseFloat(el.getAttribute('data-motion-amp'));
      if (isNaN(amp)) amp = hasEnterOff ? 22 : 8;
      var dx = 0, dy = 0, offOne = false, hasSz = false, szOne = false, hasAl = false, alOne = false;
      effects.forEach(function(ef){
        if (ef === 'float' || ef === 'bob') { dy = -amp; offOne = false; }
        else if (ef === 'slide-y' || ef === 'slide_y') { dy = amp; offOne = false; }
        else if (ef === 'slide-x' || ef === 'slide_x' || ef === 'sway') { dx = amp; offOne = false; }
        else if (ef === 'enter-up' || ef === 'enter_up') { dy = amp; offOne = true; }
        else if (ef === 'enter-down' || ef === 'enter_down') { dy = -amp; offOne = true; }
        else if (ef === 'enter-left' || ef === 'enter_left') { dx = amp; offOne = true; }
        else if (ef === 'enter-right' || ef === 'enter_right') { dx = -amp; offOne = true; }
        else if (ef === 'pulse' || ef === 'breathe' || ef === 'scale') { hasSz = true; szOne = false; }
        else if (ef === 'enter-pop' || ef === 'enter_pop') { hasSz = true; szOne = true; }
        else if (ef === 'glow' || ef === 'fade' || ef === 'alpha') { hasAl = true; alOne = false; }
        else if (ef === 'enter-fade' || ef === 'enter_fade') { hasAl = true; alOne = true; }
      });
      var oneShot = offOne || szOne || alOne;
      var sMin = parseFloat(el.getAttribute('data-motion-scale-min'));
      var sMax = parseFloat(el.getAttribute('data-motion-scale-max') || el.getAttribute('data-motion-scale'));
      if (isNaN(sMin)) sMin = szOne ? 0.82 : 1.0;
      if (isNaN(sMax)) sMax = szOne ? 1.0 : 1.08;
      var aMin = parseFloat(el.getAttribute('data-motion-min'));
      var aMax = parseFloat(el.getAttribute('data-motion-max'));
      if (isNaN(aMin)) aMin = alOne ? 0.0 : 0.35;
      if (isNaN(aMax)) aMax = 1.0;
      var dur = parseFloat(el.getAttribute('data-motion-duration'));
      if (isNaN(dur)) dur = oneShot ? 0.45 : 1.2;
      var delay = parseFloat(el.getAttribute('data-motion-delay') || '0') || 0;
      var ease = cssEasing(el.getAttribute('data-motion-easing'));

      var kf = '__bui_kf_' + id;
      var fromT = (offOne ? 'translate(' + dx + 'px,' + dy + 'px) ' : 'translate(0px,0px) ') +
        (hasSz ? 'scale(' + sMin + ')' : 'scale(1)');
      var toT = (offOne ? 'translate(0px,0px) ' : 'translate(' + dx + 'px,' + dy + 'px) ') +
        (hasSz ? 'scale(' + sMax + ')' : 'scale(1)');
      var fromO = hasAl ? (alOne ? aMin : aMax) : 1;
      var toO = hasAl ? (alOne ? aMax : aMin) : 1;

      sig.push(id + ':' + rawType + ':' + dur + ':' + delay);
      rules.push('@keyframes ' + kf + ' { from { transform:' + fromT + '; opacity:' + fromO + '; } to { transform:' + toT + '; opacity:' + toO + '; } }');
      if (oneShot) {
        rules.push('[data-bui-pm="' + id + '"] { animation: ' + kf + ' ' + dur + 's ' + ease + ' ' + delay + 's 1 both; }');
      } else {
        rules.push('[data-bui-pm="' + id + '"] { animation: ' + kf + ' ' + dur + 's ' + ease + ' ' + delay + 's infinite alternate; }');
      }
    });
    var joined = sig.join('|');
    if (joined !== lastMotSig) {
      motStyle.textContent = rules.join('\\n');
      lastMotSig = joined;
    }
  }

  function refresh() {
    var hits = [].slice.call(document.querySelectorAll('[data-hit]'));
    var dyns = [].slice.call(document.querySelectorAll('[data-dyn],[data-hud-dyn]'));
    var bars = [].slice.call(document.querySelectorAll('[data-bar]'));
    var anims = [].slice.call(document.querySelectorAll('[data-anim]'));
    var motions = [].slice.call(document.querySelectorAll('[data-motion]'));
    syncMotionCss(motions);
    var total = hits.length + dyns.length + bars.length;
    var stateKey = window.__BAKE__ && window.__BAKE__.getStateKey ? window.__BAKE__.getStateKey() : '(no __BAKE__)';
    var warn = [];

    overlay.innerHTML = '';
    if (enabled) {
      function drawBox(el, color, label) {
        var r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return;
        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border:2px solid ' + color + ';background:' + color + '22;box-sizing:border-box;';
        var tag = document.createElement('span');
        tag.textContent = label;
        tag.style.cssText = 'position:absolute;left:0;top:0;background:' + color + ';color:#000;font:bold 10px/1.2 monospace;padding:1px 3px;white-space:nowrap;';
        box.appendChild(tag);
        overlay.appendChild(box);
      }
      hits.forEach(function(el){
        var fx = el.hasAttribute('data-hit-fx') && el.getAttribute('data-hit-fx') !== '0' ? '+FX' : '';
        var snd = el.getAttribute('data-sound') ? '+SFX' : '';
        drawBox(el, '#facc15', 'hit:' + el.getAttribute('data-hit') + fx + snd);
      });
      dyns.forEach(function(el){
        var id = el.getAttribute('data-dyn') || el.getAttribute('data-hud-dyn');
        drawBox(el, '#38bdf8', 'dyn:' + id);
        if (el.hasAttribute('data-dyn')) {
          var opaque = false;
          for (var cur = el; cur; cur = cur.parentElement) {
            var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(getComputedStyle(cur).backgroundColor);
            if (m && (m[4] === undefined || parseFloat(m[4]) > 0.85)) { opaque = true; break; }
          }
          if (!opaque) warn.push('dyn "' + id + '" needs opaque ancestor background-color');
        }
      });
      bars.forEach(function(el){
        drawBox(el, '#2dd4bf', 'bar:' + el.getAttribute('data-bar') + ' (' + (el.getAttribute('data-bar-dir') || 'left') + ')');
      });
      anims.forEach(function(el){
        var r = el.getBoundingClientRect();
        var frames = parseInt(el.getAttribute('data-frames') || '8', 10) || 8;
        var id = el.getAttribute('data-anim');
        drawBox(el, '#f472b6', 'anim:' + id + ' (' + frames + 'f)');
        if (r.width * ${texScale} * frames > ${maxSheetW}) {
          warn.push('anim "' + id + '" exceeds ${maxSheetW}px sheet width (will downscale)');
        }
      });
      motions.forEach(function(el){
        var id = el.getAttribute('data-motion');
        var type = el.getAttribute('data-motion-type') || 'float';
        drawBox(el, '#34d399', 'motion:' + id + ' (' + type + ', 60fps)');
      });
    }

    var budgetColor = total > 25 ? '#f87171' : (total >= 22 ? '#fbbf24' : '#4ade80');
    bar.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;justify-content:space-between;">' +
      '<span><b>BakedUI</b> · <code>' + stateKey + '</code></span>' +
      '<div style="display:flex;gap:5px;">' +
      '<button id="__bui_mot_toggle" style="cursor:pointer;background:' + (motionPreview ? '#10b981' : '#334155') + ';color:' + (motionPreview ? '#052e16' : '#f8fafc') + ';border:0;border-radius:4px;padding:2px 7px;font:bold 11px monospace;">' + (motionPreview ? 'Motion: ON' : 'Motion: OFF') + '</button>' +
      '<button id="__bui_toggle" style="cursor:pointer;background:' + (enabled ? '#38bdf8' : '#334155') + ';color:' + (enabled ? '#0f172a' : '#f8fafc') + ';border:0;border-radius:4px;padding:2px 7px;font:bold 11px monospace;">' + (enabled ? 'Boxes: ON' : 'Boxes: OFF') + '</button>' +
      '</div></div>' +
      '<div style="margin-top:4px;color:' + budgetColor + ';">Slots: ' + hits.length + ' hit + ' + dyns.length + ' dyn + ' + bars.length + ' bar = <b>' + total + '/25</b> · Anims: ' + anims.length + ' · Motions: ' + motions.length + '</div>' +
      (warn.length ? '<div style="margin-top:4px;color:#fbbf24;">! ' + warn.join(' | ') + '</div>' : '');
    var btn = document.getElementById('__bui_toggle');
    if (btn) btn.onclick = function(){ enabled = !enabled; overlay.style.display = enabled ? 'block' : 'none'; refresh(); };
    var mbtn = document.getElementById('__bui_mot_toggle');
    if (mbtn) mbtn.onclick = function(){ motionPreview = !motionPreview; refresh(); };
  }

  window.addEventListener('keydown', function(e){
    if (e.shiftKey && e.key.toLowerCase() === 'i') {
      enabled = !enabled;
      overlay.style.display = enabled ? 'block' : 'none';
      refresh();
    }
  });
  ${enableWatch ? "try { var es = new EventSource('/__bui_events'); es.onmessage = function(ev){ if (ev.data === 'reload') location.reload(); }; } catch(e) {}" : ''}
  setInterval(refresh, 350);
  refresh();
})();
</script>
`;
}

export interface PreviewServerOptions {
  port?: number;
  host?: string;
  mode?: 'site' | 'hud';
  /** Watch source directory and auto-reload browser preview on file saves. */
  watch?: boolean;
  /** When `watch` is true, also automatically re-run `bakeSite` on file saves. */
  autoBake?: boolean;
  /** Optional callback invoked after an auto-bake completes or fails. */
  onAutoBake?: (info: { ok: boolean; durationMs: number; error?: string }) => void;
}

export function startPreviewServer(
  config: ResolvedBakedUiConfig,
  opts: PreviewServerOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const port = opts.port ?? 4173;
  const host = opts.host ?? '127.0.0.1';
  const mode = opts.mode ?? 'site';
  const entry = mode === 'hud' ? config.hud.entry : config.site.entry;
  const rootDir = path.dirname(entry);
  const entryName = path.basename(entry);
  const texScale = mode === 'hud' ? config.hud.texScale : config.site.texScale;
  const maxSheetW = mode === 'hud' ? config.hud.maxSheetWidth : config.site.maxSheetWidth;
  const enableWatch = Boolean(opts.watch);

  const sseClients = new Set<http.ServerResponse>();
  let watcher: fs.FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let baking = false;
  let pendingBake = false;

  const triggerAutoBake = async () => {
    if (baking) {
      pendingBake = true;
      return;
    }
    baking = true;
    const t0 = Date.now();
    try {
      await bakeSite(config);
      opts.onAutoBake?.({ ok: true, durationMs: Date.now() - t0 });
    } catch (err) {
      opts.onAutoBake?.({ ok: false, durationMs: Date.now() - t0, error: (err as Error)?.message ?? String(err) });
    } finally {
      baking = false;
      if (pendingBake) {
        pendingBake = false;
        void triggerAutoBake();
      }
    }
  };

  if (enableWatch && fs.existsSync(rootDir)) {
    watcher = fs.watch(rootDir, { recursive: true }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const res of sseClients) {
          try {
            res.write('data: reload\n\n');
          } catch {}
        }
        if (opts.autoBake && mode === 'site') {
          void triggerAutoBake();
        }
      }, 250);
    });
  }

  const server = http.createServer((req, res) => {
    const rawRel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (enableWatch && rawRel === '/__bui_events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    const rel = rawRel === '/' ? entryName : rawRel.replace(/^\/+/, '');
    const file = path.resolve(rootDir, rel);

    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      let html = fs.readFileSync(file, 'utf8');
      const snippet = buildInspectorSnippet(texScale, maxSheetW, enableWatch);
      html = html.includes('</body>') ? html.replace('</body>', `${snippet}</body>`) : html + snippet;
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }).end(html);
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actualPort}/`,
        close: () =>
          new Promise<void>((done) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            try { watcher?.close(); } catch {}
            for (const c of sseClients) {
              try { c.end(); } catch {}
            }
            sseClients.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
