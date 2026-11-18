import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBakedButton,
  buildActionFormSpec,
  buildInvSlotPlan,
  createMenuState,
  fitText,
  getBakedState,
  isBakedMarkerTag,
  resolveRouteKey,
  spotInFront,
  textUnits,
} from '../dist/runtime/sim.js';
import { buildHudDebugPayload, packHudPayload, sliceAsciiField } from '../dist/runtime/hud_sim.js';

const MOCK_MANIFEST = {
  version: 1,
  namespace: 'demo',
  entityId: 'demo:menu',
  routerTag: '§w§b',
  invTitleTag: '§b§w§n§h',
  viewport: [352, 198],
  sourceScale: 3,
  texScale: 2,
  initialState: 'home',
  hitboxCount: 2,
  stateCount: 2,
  animCount: 0,
  dynCount: 2,
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
          hitId: 'nav_shop',
          hitTag: '§h§00',
          label: 'Shop',
          x: 10, y: 10, w: 50, h: 20,
          xPct: '10%', yPct: '10%', wPct: '20%', hPct: '10%',
          nextState: 'shop',
          special: null,
        },
        {
          hitId: 'close_menu',
          hitTag: '§h§01',
          label: 'Close',
          x: 300, y: 10, w: 30, h: 20,
          xPct: '85%', yPct: '10%', wPct: '8%', hPct: '10%',
          nextState: 'home',
          special: 'close',
        },
      ],
      dynSlots: [
        { slot: 26, dynId: 'coins', maskTag: '§9§0', tone: 'main' },
        { slot: 25, dynId: 'line1', maskTag: '§9§0', tone: 'main' },
      ],
    },
    shop: {
      key: 'shop',
      index: 1,
      tag: '§s§01',
      texture: 'textures/ui/baked_ui/s_01_shop',
      texturePng: 'textures/ui/baked_ui/s_01_shop.png',
      url: 'baked://shop',
      title: 'Shop',
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
      dynSlots: [{ slot: 26, dynId: 'coins', maskTag: '§9§0', tone: 'main' }],
    },
  },
};

test('menu sim builds 27-slot plan, transitions state, and detects markers', () => {
  const st = createMenuState(MOCK_MANIFEST);
  assert.equal(st.bakedKey, 'home');
  assert.equal(resolveRouteKey(MOCK_MANIFEST, 'SHOP'), 'shop');

  const plan = buildInvSlotPlan(MOCK_MANIFEST, st, { coins: '§6100 G', line1: 'Hello' });
  assert.deepEqual(plan, [
    { slot: 1, nameTag: '§s§00' },
    { slot: 2, nameTag: '§h§00Shop' },
    { slot: 3, nameTag: '§h§01Close' },
    { slot: 26, nameTag: '§9§0§r§6100 G' },
    { slot: 25, nameTag: '§9§0§rHello' },
  ]);

  for (const s of plan) {
    assert.equal(isBakedMarkerTag(s.nameTag), true);
  }
  assert.equal(isBakedMarkerTag('Diamond Sword'), false);

  const next = applyBakedButton(MOCK_MANIFEST, st, getBakedState(MOCK_MANIFEST, st).buttons[0]);
  assert.equal(next.key, 'shop');
  assert.equal(st.clicks, 1);

  const form = buildActionFormSpec(MOCK_MANIFEST, st);
  assert.equal(form.title, '§w§b§s§01baked://shop');
  assert.equal(form.buttons[0].text, '§h§00Home');
});

test('textUnits, fitText, and spotInFront handle CJK + section codes accurately', () => {
  assert.equal(textUnits('§6Hello'), 5);
  assert.equal(textUnits('§a한글AB'), 6);
  assert.equal(fitText('§a한글텍스트자르기', 7), '§a한글텍…');
  assert.deepEqual(spotInFront({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, 2, 0.5), { x: 2, y: 9.5, z: 0 });
});

test('HUD sim packs fixed single-byte ASCII fields and preserves UTF-8/color tail', () => {
  const hudManifest = {
    version: 2,
    experimental: true,
    namespace: 'demo_hud',
    channel: 'subtitle',
    hudTag: '§h§u§d',
    hudOffTag: 'demo.off',
    viewport: [1056, 594],
    scale: 3,
    widgetCount: 1,
    animCount: 0,
    dynCount: 3,
    fixedByteLen: 20,
    widgets: [],
    animations: [],
    dynFields: [
      { dynId: 'a', start: 0, end: 10, len: 10, tail: false },
      { dynId: 'b', start: 10, end: 20, len: 10, tail: false },
      { dynId: 'tail', start: 20, end: -1, len: 0, tail: true },
    ],
  };

  assert.equal(sliceAsciiField('§c한글HP', 8), '??HP    ');
  const packed = packHudPayload({ a: 'Steve', b: 'HP 20/20', tail: '§a퀘스트 완료' }, hudManifest);
  assert.equal(packed.slice(0, 10), 'Steve     ');
  assert.equal(packed.slice(10, 20), 'HP 20/20  ');
  assert.equal(packed.slice(20), '§a퀘스트 완료');

  const dbg = buildHudDebugPayload(hudManifest);
  assert.equal(dbg.slice(0, 10), 'AAAAAAAAAA');
  assert.equal(dbg.slice(10, 20), 'BBBBBBBBBB');
  assert.equal(dbg.slice(20), '§aTAIL OK');
});
