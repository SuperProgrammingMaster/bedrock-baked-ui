import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const mockPath = path.join(here, 'fixtures', 'mc_server_mock.mjs');

// Bundle the compiled runtime against the in-memory @minecraft/server mock (one shared module instance).
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbui-menu-guard-'));
const outFile = path.join(outDir, 'bundle.mjs');
await esbuild.build({
  stdin: {
    contents: `export * from ${JSON.stringify(path.join(here, '..', 'dist', 'runtime', 'menu.js'))};\nexport * as mc from '@minecraft/server';`,
    resolveDir: here,
    loader: 'js',
  },
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  external: ['@minecraft/server-ui'],
  alias: { '@minecraft/server': mockPath },
});
const { BakedMenuManager, mc } = await import(pathToFileURL(outFile).href);

const MANIFEST = {
  version: 1,
  namespace: 'demo',
  entityId: 'demo:menu',
  routerTag: '§w§b',
  invTitleTag: '§b§w§n§h',
  viewport: [352, 198],
  sourceScale: 3,
  texScale: 2,
  initialState: 'home',
  hitboxCount: 1,
  stateCount: 1,
  animCount: 0,
  dynCount: 0,
  animations: {},
  states: {
    home: {
      key: 'home',
      index: 0,
      tag: '§s§00',
      texture: 'textures/ui/baked_ui/s_00_home',
      texturePng: 'textures/ui/baked_ui/s_00_home.png',
      url: 'baked://home',
      title: 'Home',
      buttons: [
        {
          hitId: 'nav_home',
          hitTag: '§h§00',
          label: 'Home',
          x: 10, y: 10, w: 50, h: 20,
          xPct: '10%', yPct: '10%', wPct: '20%', hPct: '10%',
          nextState: 'home',
          special: null,
        },
      ],
      dynSlots: [],
    },
  },
};

function interact(player, target) {
  return mc.world.beforeEvents.playerInteractWithEntity.fire({ player, target, itemStack: undefined, cancel: false });
}

test('menu entities can only be opened by their owner', () => {
  const blocked = [];
  const mgr = new BakedMenuManager(MANIFEST, {
    onForeignInteract: (player, ownerName) => blocked.push([player.name, ownerName]),
  });
  mgr.install();
  mc.system.flush();

  const alice = new mc.MockPlayer('Alice');
  const bob = new mc.MockPlayer('Bob');
  mc.players.push(alice, bob);

  mgr.open(alice);
  mgr.open(bob);
  const aliceMenu = mc.allEntities.find((e) => mgr.getOwnerName(e.id) === 'Alice');
  const bobMenu = mc.allEntities.find((e) => mgr.getOwnerName(e.id) === 'Bob');
  assert.ok(aliceMenu && bobMenu && aliceMenu !== bobMenu);

  // Owners open their own menus normally.
  assert.equal(interact(alice, aliceMenu).cancel, false);
  assert.equal(interact(bob, bobMenu).cancel, false);

  // A nearby player right-clicking someone else's menu is blocked before the container opens.
  assert.equal(interact(bob, aliceMenu).cancel, true);
  assert.equal(interact(alice, bobMenu).cancel, true);
  mc.system.flush();
  assert.deepEqual(blocked, [
    ['Bob', 'Alice'],
    ['Alice', 'Bob'],
  ]);

  // Unrelated entities are untouched.
  const cow = new mc.MockEntity('minecraft:cow', { x: 0, y: 64, z: 0 });
  assert.equal(interact(bob, cow).cancel, false);

  // Orphaned menu entities (not tracked by this manager) are blocked for everyone.
  const orphan = new mc.MockEntity('demo:menu', { x: 0, y: 64, z: 0 });
  assert.equal(interact(alice, orphan).cancel, true);

  // Once closed, the old entity id no longer maps to its former owner.
  mgr.close(alice);
  assert.equal(mgr.getOwnerName(aliceMenu.id), undefined);
  assert.equal(aliceMenu.isValid, false);
  assert.equal(mgr.getOwnerName(bobMenu.id), 'Bob');

  mgr.dispose();
  assert.equal(mgr.getOwnerName(bobMenu.id), undefined);
});
