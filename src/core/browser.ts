// Cross-platform Headless Chromium (Edge / Chrome / Chromium) launcher & raw CDP client.
// Zero Puppeteer or Playwright dependencies; uses Node 22+ built-in WebSocket & fetch.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CdpSession {
  call<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  onceEvent<T = Record<string, unknown>>(method: string): Promise<T>;
  evalJs<T = unknown>(expression: string): Promise<T>;
  capturePng(clip?: { x: number; y: number; width: number; height: number; scale?: number }): Promise<Buffer>;
  close(): Promise<void>;
}

const WIN_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  path.join(os.homedir(), 'AppData/Local/Microsoft/Edge/Application/msedge.exe'),
];

const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

const LINUX_BINS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable',
];

function whichOnUnix(bin: string): string | undefined {
  try {
    const out = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/** Finds an installed Chromium-based browser executable across Windows, macOS, and Linux. */
export function findBrowser(explicitPath?: string): string {
  const envPath = explicitPath || process.env.BAKED_UI_BROWSER || process.env.CHROME_PATH;
  if (envPath) {
    if (fs.existsSync(envPath)) return envPath;
    throw new Error(`Configured browser executable does not exist: ${envPath}`);
  }

  if (process.platform === 'win32') {
    for (const p of WIN_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'darwin') {
    for (const p of MAC_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    for (const bin of LINUX_BINS) {
      const found = whichOnUnix(bin);
      if (found) return found;
    }
  }

  throw new Error(
    'Could not find Chrome, Microsoft Edge, or Chromium. Install Chrome/Edge or set BAKED_UI_BROWSER=/path/to/chrome.',
  );
}

/** Launches a headless Chromium instance and connects via Chrome DevTools Protocol (CDP). */
export async function launchCdp(browserExe: string, userDataDir: string): Promise<CdpSession> {
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    args.unshift('--no-sandbox');
  }

  const proc = spawn(browserExe, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const port = await new Promise<number>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Browser launch timed out:\n${stderr}`)), 15000);
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(stderr);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited early (${code}):\n${stderr}`));
    });
  });

  const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as Array<{
    type?: string;
    webSocketDebuggerUrl?: string;
  }>;
  const pageTarget = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!pageTarget?.webSocketDebuggerUrl) {
    try { proc.kill(); } catch {}
    throw new Error('No CDP page target found');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (err) => reject(err), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const waiters = new Map<string, Array<(p: unknown) => void>>();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string; code: number };
    };
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
      }
    } else if (msg.method && waiters.has(msg.method)) {
      const list = waiters.get(msg.method) ?? [];
      waiters.delete(msg.method);
      for (const res of list) res(msg.params);
    }
  });

  const call = <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP timeout waiting for ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const onceEvent = <T = Record<string, unknown>>(method: string): Promise<T> =>
    new Promise<T>((resolve) => {
      const list = waiters.get(method) ?? [];
      list.push((p) => resolve(p as T));
      waiters.set(method, list);
    });

  const evalJs = async <T = unknown>(expression: string): Promise<T> => {
    const res = await call<{
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Runtime.evaluate error';
      throw new Error(detail);
    }
    return res.result?.value as T;
  };

  const capturePng = async (clip?: { x: number; y: number; width: number; height: number; scale?: number }): Promise<Buffer> => {
    const params: Record<string, unknown> = { format: 'png' };
    if (clip) params.clip = { scale: 1, ...clip };
    for (let attempt = 0; ; attempt++) {
      try {
        const shot = await call<{ data: string }>('Page.captureScreenshot', params);
        return Buffer.from(shot.data, 'base64');
      } catch (err) {
        if (attempt >= 2) throw err;
        await call('Page.bringToFront').catch(() => {});
      }
    }
  };

  const close = async (): Promise<void> => {
    try { ws.close(); } catch {}
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 600);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
      try { proc.kill(); } catch { clearTimeout(timer); resolve(); }
    });
  };

  return { call, onceEvent, evalJs, capturePng, close };
}
