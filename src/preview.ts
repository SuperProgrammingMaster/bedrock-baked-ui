// Local HTTP live preview server with an injected Baked UI Inspector overlay.
// Shows real-time slot budget (buttons + dyn <= 25), hitbox/dyn/anim outlines, and opaque-bg warnings.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ResolvedBakedUiConfig } from './types.js';

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

function buildInspectorSnippet(texScale: number, maxSheetW: number): string {
  return `
<!-- bedrock-baked-ui inspector overlay (dev preview only) -->
<script>
(function(){
  if (window.__BAKE_HEADLESS__) return;
  var enabled = false;
  var bar = document.createElement('div');
  bar.id = '__bui_dev_bar';
  bar.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:999999;background:rgba(15,18,28,0.92);color:#e2e8f0;font:12px/1.4 ui-monospace,Consolas,monospace;padding:8px 10px;border:1px solid #475569;border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,0.45);user-select:none;max-width:440px;';
  var overlay = document.createElement('div');
  overlay.id = '__bui_dev_overlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999998;display:none;';
  document.body.appendChild(overlay);
  document.body.appendChild(bar);

  function refresh() {
    var hits = [].slice.call(document.querySelectorAll('[data-hit]'));
    var dyns = [].slice.call(document.querySelectorAll('[data-dyn],[data-hud-dyn]'));
    var anims = [].slice.call(document.querySelectorAll('[data-anim]'));
    var total = hits.length + dyns.length;
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
      hits.forEach(function(el){ drawBox(el, '#facc15', 'hit:' + el.getAttribute('data-hit')); });
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
      anims.forEach(function(el){
        var r = el.getBoundingClientRect();
        var frames = parseInt(el.getAttribute('data-frames') || '8', 10) || 8;
        var id = el.getAttribute('data-anim');
        drawBox(el, '#f472b6', 'anim:' + id + ' (' + frames + 'f)');
        if (r.width * ${texScale} * frames > ${maxSheetW}) {
          warn.push('anim "' + id + '" exceeds ${maxSheetW}px sheet width (will downscale)');
        }
      });
    }

    var budgetColor = total > 25 ? '#f87171' : (total >= 22 ? '#fbbf24' : '#4ade80');
    bar.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">' +
      '<span><b>BakedUI</b> · <code>' + stateKey + '</code></span>' +
      '<button id="__bui_toggle" style="cursor:pointer;background:' + (enabled ? '#38bdf8' : '#334155') + ';color:' + (enabled ? '#0f172a' : '#f8fafc') + ';border:0;border-radius:4px;padding:2px 7px;font:bold 11px monospace;">' + (enabled ? 'Boxes: ON' : 'Boxes: OFF') + '</button>' +
      '</div>' +
      '<div style="margin-top:4px;color:' + budgetColor + ';">Slots: ' + hits.length + ' hit + ' + dyns.length + ' dyn = <b>' + total + '/25</b> · Anims: ' + anims.length + '</div>' +
      (warn.length ? '<div style="margin-top:4px;color:#fbbf24;">⚠ ' + warn.join(' | ') + '</div>' : '');
    var btn = document.getElementById('__bui_toggle');
    if (btn) btn.onclick = function(){ enabled = !enabled; overlay.style.display = enabled ? 'block' : 'none'; refresh(); };
  }

  window.addEventListener('keydown', function(e){
    if (e.shiftKey && e.key.toLowerCase() === 'i') {
      enabled = !enabled;
      overlay.style.display = enabled ? 'block' : 'none';
      refresh();
    }
  });
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
}

export function startPreviewServer(
  config: ResolvedBakedUiConfig,
  opts: PreviewServerOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const port = opts.port ?? 4173;
  const host = opts.host ?? '127.0.0.1';
  const entry = opts.mode === 'hud' ? config.hud.entry : config.site.entry;
  const rootDir = path.dirname(entry);
  const entryName = path.basename(entry);
  const texScale = opts.mode === 'hud' ? config.hud.texScale : config.site.texScale;
  const maxSheetW = opts.mode === 'hud' ? config.hud.maxSheetWidth : config.site.maxSheetWidth;

  const server = http.createServer((req, res) => {
    const rawRel = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = rawRel === '/' ? entryName : rawRel.replace(/^\/+/, '');
    const file = path.resolve(rootDir, rel);

    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      let html = fs.readFileSync(file, 'utf8');
      const snippet = buildInspectorSnippet(texScale, maxSheetW);
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
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
