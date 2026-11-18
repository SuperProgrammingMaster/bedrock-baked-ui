// examples/guild-codex/packs/bp/src/main.ts
import { EntityComponentTypes as EntityComponentTypes2, ItemStack as ItemStack2, system as system3, world as world3 } from "@minecraft/server";

// dist/runtime/sim.js
var MENU_MARKER_ITEM = "minecraft:paper";
function isBakedMarkerTag(nameTag) {
  if (!nameTag)
    return false;
  return /^§[sh9]§\d(§\d)?/.test(nameTag);
}
function resolveRouteKey(manifest, route) {
  if (route) {
    const trimmed = route.trim();
    if (manifest.states[trimmed])
      return trimmed;
    const lower = trimmed.toLowerCase();
    if (manifest.states[lower])
      return lower;
    const found = Object.values(manifest.states).find((s) => s.key.toLowerCase() === lower || s.url.toLowerCase().includes(lower));
    if (found)
      return found.key;
  }
  return manifest.initialState;
}
function createMenuState(manifest, initialRoute) {
  return {
    bakedKey: resolveRouteKey(manifest, initialRoute),
    clicks: 0,
    openedTick: 0
  };
}
function getBakedState(manifest, state) {
  return manifest.states[state.bakedKey] ?? manifest.states[manifest.initialState];
}
function applyBakedButton(manifest, state, button) {
  state.clicks += 1;
  if (button.nextState && button.nextState in manifest.states) {
    state.bakedKey = button.nextState;
  }
  return getBakedState(manifest, state);
}
function formatDynTag(spec, text) {
  return `${spec.maskTag}\xA7r${text}`;
}
function buildInvSlotPlan(manifest, state, dynValues = {}) {
  const cur = getBakedState(manifest, state);
  const out = [{ slot: 1, nameTag: cur.tag }];
  for (let j = 0; j < cur.buttons.length && 2 + j < 27; j++) {
    out.push({ slot: 2 + j, nameTag: `${cur.buttons[j].hitTag}${cur.buttons[j].label}` });
  }
  if (cur.dynSlots?.length) {
    for (const ds of cur.dynSlots) {
      const raw = dynValues[ds.dynId] ?? "";
      const safe = raw.length > 240 ? raw.slice(0, 240) : raw;
      out.push({ slot: ds.slot, nameTag: formatDynTag(ds, safe) });
    }
  }
  return out;
}
function buildActionFormSpec(manifest, state) {
  const cur = getBakedState(manifest, state);
  return {
    title: `${manifest.routerTag}${cur.tag}${cur.url}`,
    body: `${cur.title} (${cur.key})`,
    buttons: cur.buttons.map((b) => ({
      text: `${b.hitTag}${b.label}`,
      action: b
    }))
  };
}
function textUnits(s) {
  let u = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 167) {
      i++;
      continue;
    }
    u += c < 8192 ? 1 : 2;
  }
  return u;
}
function fitText(s, maxUnits) {
  if (textUnits(s) <= maxUnits)
    return s;
  let out = "";
  let u = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 167) {
      out += s.slice(i, i + 2);
      i++;
      continue;
    }
    const w = c < 8192 ? 1 : 2;
    if (u + w > maxUnits - 1)
      break;
    out += s[i];
    u += w;
  }
  return out + "\u2026";
}
function spotInFront(head, view, distance, drop) {
  return {
    x: head.x + view.x * distance,
    y: head.y + view.y * distance - drop,
    z: head.z + view.z * distance
  };
}

// dist/runtime/menu.js
import { EntityComponentTypes, EntityDamageCause, ItemStack, system, world } from "@minecraft/server";
function invOf(entity) {
  return entity.getComponent(EntityComponentTypes.Inventory)?.container;
}
var BakedMenuManager = class {
  manifest;
  entityId;
  opts;
  armTicks;
  dynRefreshTicks;
  orphanSweepTicks;
  pvpDodge;
  playerStates = /* @__PURE__ */ new Map();
  menuEntities = /* @__PURE__ */ new Map();
  parkUntilTick = /* @__PURE__ */ new Map();
  armedUntil = /* @__PURE__ */ new Map();
  lastHeld = /* @__PURE__ */ new Map();
  lastTakenMarker = /* @__PURE__ */ new Map();
  formTokens = /* @__PURE__ */ new Map();
  installed = false;
  pollRunId;
  sweepRunId;
  constructor(manifest, opts = {}) {
    this.manifest = manifest;
    this.entityId = manifest.entityId;
    this.opts = opts;
    this.armTicks = opts.armTicks ?? 1200;
    this.dynRefreshTicks = Math.max(1, opts.dynRefreshTicks ?? 10);
    this.orphanSweepTicks = Math.max(20, opts.orphanSweepTicks ?? 100);
    this.pvpDodge = opts.pvpDodge ?? true;
  }
  logErr(context, err) {
    try {
      this.opts.onError?.(context, err);
    } catch {
    }
  }
  /** Gets or initializes the player's menu state. */
  getState(player) {
    let st = this.playerStates.get(player.name);
    if (!st) {
      st = createMenuState(this.manifest);
      this.playerStates.set(player.name, st);
    }
    return st;
  }
  /** Returns the current menu state by player name if initialized. */
  getStateByName(playerName) {
    return this.playerStates.get(playerName);
  }
  /** Returns true if the player currently has an active menu entity spawned. */
  isOpen(playerName) {
    try {
      return this.menuEntities.get(playerName)?.isValid === true;
    } catch {
      return false;
    }
  }
  /** Installs tick polling, tick-late marker sweep, orphan entity cleanup, and PvP melee pass-through. */
  install() {
    if (this.installed)
      return;
    this.installed = true;
    system.run(() => {
      try {
        this.sweepOrphanMenus();
      } catch (err) {
        this.logErr("sweep.init", err);
      }
    });
    this.pollRunId = system.runInterval(() => {
      for (const p of world.getAllPlayers()) {
        try {
          this.pollPlayer(p);
        } catch (err) {
          this.logErr(`poll(${p.name})`, err);
        }
      }
    }, 1);
    this.sweepRunId = system.runInterval(() => this.sweepOrphanMenus(), this.orphanSweepTicks);
    world.afterEvents.playerInventoryItemChange.subscribe((ev) => {
      try {
        const it = ev.itemStack;
        if (it?.typeId !== MENU_MARKER_ITEM || !isBakedMarkerTag(it.nameTag))
          return;
        if (it.nameTag) {
          this.lastTakenMarker.set(ev.player.name, { tag: it.nameTag, tick: system.currentTick });
        }
        const c = invOf(ev.player);
        const now = c?.getItem(ev.slot);
        if (now?.typeId === MENU_MARKER_ITEM && isBakedMarkerTag(now.nameTag)) {
          c?.setItem(ev.slot, void 0);
        }
      } catch {
      }
    });
    if (this.pvpDodge) {
      world.afterEvents.entityHitEntity.subscribe((ev) => {
        try {
          if (ev.hitEntity?.typeId !== this.entityId)
            return;
          const rawAttacker = ev.damagingEntity;
          if (!rawAttacker || rawAttacker.typeId !== "minecraft:player" || !rawAttacker.isValid)
            return;
          const attacker = rawAttacker;
          this.parkUntilTick.set(attacker.name, system.currentTick + 15);
          const owned = this.menuEntities.get(attacker.name);
          if (owned?.isValid) {
            owned.teleport(spotInFront(attacker.getHeadLocation(), attacker.getViewDirection(), -1.5, 0.2));
          }
          const target = this.findPvpTargetInView(attacker);
          if (target) {
            target.applyDamage(1, { cause: EntityDamageCause.entityAttack, damagingEntity: attacker });
            const v = attacker.getViewDirection();
            const len = Math.hypot(v.x, v.z) || 1;
            target.applyKnockback({ x: v.x / len * 0.4, z: v.z / len * 0.4 }, 0.36);
          }
        } catch {
        }
      });
    }
    world.afterEvents.playerLeave.subscribe((ev) => {
      this.closeByName(ev.playerName);
      this.playerStates.delete(ev.playerName);
    });
  }
  /** Arms the zero-flicker Entity Inventory UI for `player` and navigates to `route` if given. */
  open(player, route) {
    if (!player.isValid)
      return;
    const st = this.getState(player);
    if (route)
      st.bakedKey = resolveRouteKey(this.manifest, route);
    const now = system.currentTick;
    this.armedUntil.set(player.name, now + this.armTicks);
    if (this.opts.triggerItemId) {
      const c = invOf(player);
      if (c) {
        for (let i = 0; i < Math.min(9, c.size); i++) {
          const it = c.getItem(i);
          if (it?.typeId === this.opts.triggerItemId && (!this.opts.triggerItemNameTag || it.nameTag === this.opts.triggerItemNameTag)) {
            try {
              player.selectedSlotIndex = i;
            } catch {
            }
            break;
          }
        }
      }
    }
    this.lastHeld.set(player.name, this.isHoldingTrigger(player));
    const entity = this.ensureMenuEntity(player);
    if (entity)
      this.syncContainer(entity, st, player);
  }
  /** Immediately refreshes the player's menu container (e.g. after external game state changes). */
  refresh(player) {
    const e = this.menuEntities.get(player.name);
    if (!e?.isValid || !player.isValid)
      return;
    this.syncContainer(e, this.getState(player), player);
  }
  /** Navigates a player's menu to `route` in-place (zero flicker) without reopening. */
  navigate(player, route) {
    const st = this.getState(player);
    st.bakedKey = resolveRouteKey(this.manifest, route);
    this.refresh(player);
  }
  /** Closes the menu entity for `player`. */
  close(player) {
    this.armedUntil.delete(player.name);
    this.lastTakenMarker.delete(player.name);
    this.removeMenuEntity(player.name);
    const st = this.playerStates.get(player.name);
    if (st)
      this.opts.onClose?.(player, st);
  }
  /** Closes and cleans up menu state by player name. */
  closeByName(playerName) {
    this.armedUntil.delete(playerName);
    this.lastHeld.delete(playerName);
    this.lastTakenMarker.delete(playerName);
    this.formTokens.set(playerName, (this.formTokens.get(playerName) ?? 0) + 1);
    this.removeMenuEntity(playerName);
  }
  /**
   * Opens the baked menu using `@minecraft/server-ui` `ActionFormData` (`ui/server_form.json` fallback).
   * Useful for chat commands or environments where Entity Inventory UI is unavailable.
   */
  async openActionFormFallback(player, route) {
    if (!player.isValid)
      return;
    this.removeMenuEntity(player.name);
    const serverUi = await import("@minecraft/server-ui");
    const ActionFormData = serverUi.ActionFormData;
    const FormCancelationReason = serverUi.FormCancelationReason;
    const st = this.getState(player);
    if (route)
      st.bakedKey = resolveRouteKey(this.manifest, route);
    const token = (this.formTokens.get(player.name) ?? 0) + 1;
    this.formTokens.set(player.name, token);
    let retries = 0;
    while (player.isValid && this.formTokens.get(player.name) === token) {
      const view = buildActionFormSpec(this.manifest, st);
      const form = new ActionFormData().title(view.title).body(view.body);
      for (const btn of view.buttons)
        form.button(btn.text);
      let res;
      try {
        res = await form.show(player);
      } catch (err) {
        this.logErr(`actionForm.show(${player.name})`, err);
        return;
      }
      if (!player.isValid || this.formTokens.get(player.name) !== token)
        return;
      if (res.canceled) {
        if (res.cancelationReason === FormCancelationReason.UserBusy && retries < 2) {
          retries += 1;
          await new Promise((resolve) => system.runTimeout(() => resolve(), 4));
          continue;
        }
        return;
      }
      retries = 0;
      const picked = res.selection !== void 0 ? view.buttons[res.selection]?.action : void 0;
      if (!picked || picked.special === "close") {
        this.opts.onClose?.(player, st);
        return;
      }
      applyBakedButton(this.manifest, st, picked);
      this.opts.onButtonClick?.(player, picked, st);
    }
  }
  /** Removes all active menu entities and clears intervals (useful for tests or hot reload). */
  dispose() {
    for (const name of [...this.menuEntities.keys()])
      this.removeMenuEntity(name);
    for (const id of [this.pollRunId, this.sweepRunId]) {
      if (id !== void 0) {
        try {
          system.clearRun(id);
        } catch {
        }
      }
    }
    this.pollRunId = void 0;
    this.sweepRunId = void 0;
    this.installed = false;
    this.playerStates.clear();
    this.parkUntilTick.clear();
    this.armedUntil.clear();
    this.lastHeld.clear();
    this.lastTakenMarker.clear();
    this.formTokens.clear();
  }
  isHoldingTrigger(player) {
    if (this.opts.isTriggerHeld)
      return this.opts.isTriggerHeld(player);
    if (!this.opts.triggerItemId)
      return false;
    const c = invOf(player);
    if (!c)
      return false;
    const held = c.getItem(player.selectedSlotIndex);
    if (held?.typeId !== this.opts.triggerItemId)
      return false;
    if (this.opts.triggerItemNameTag && held.nameTag !== this.opts.triggerItemNameTag)
      return false;
    return true;
  }
  sweepMarkerItems(player) {
    const c = invOf(player);
    if (!c)
      return;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it?.typeId === MENU_MARKER_ITEM && isBakedMarkerTag(it.nameTag)) {
        c.setItem(i, void 0);
      }
    }
  }
  syncContainer(entity, state, player) {
    const c = invOf(entity);
    if (!c)
      return;
    const dynValues = this.opts.resolveDynamicValues ? this.opts.resolveDynamicValues(player, state) : {};
    const plan = buildInvSlotPlan(this.manifest, state, dynValues);
    const wanted = /* @__PURE__ */ new Map();
    for (const s of plan)
      wanted.set(s.slot, s.nameTag);
    if (c.getItem(0) !== void 0)
      c.setItem(0, void 0);
    for (let slot = 1; slot < Math.min(27, c.size); slot++) {
      const tag = wanted.get(slot);
      if (!tag) {
        if (c.getItem(slot) !== void 0)
          c.setItem(slot, void 0);
        continue;
      }
      const existing = c.getItem(slot);
      if (existing?.typeId === MENU_MARKER_ITEM && existing.nameTag === tag)
        continue;
      const item = new ItemStack(MENU_MARKER_ITEM, 1);
      item.nameTag = tag;
      c.setItem(slot, item);
    }
  }
  clearEntitySafely(e) {
    try {
      if (!e.isValid)
        return;
      const c = invOf(e);
      if (c) {
        for (let i = 0; i < c.size; i++) {
          if (c.getItem(i) !== void 0)
            c.setItem(i, void 0);
        }
      }
      e.remove();
    } catch (err) {
      this.logErr("entity.remove", err);
    }
  }
  removeMenuEntity(playerName) {
    this.parkUntilTick.delete(playerName);
    const e = this.menuEntities.get(playerName);
    this.menuEntities.delete(playerName);
    if (e)
      this.clearEntitySafely(e);
  }
  findPvpTargetInView(player) {
    try {
      const hits = player.getEntitiesFromViewDirection({
        maxDistance: 3.8,
        excludeTypes: [this.entityId]
      });
      for (const h of hits) {
        const target = h.entity;
        if (!target?.isValid || target.id === player.id)
          continue;
        if (target.getComponent(EntityComponentTypes.Health))
          return target;
      }
    } catch {
    }
    return void 0;
  }
  desiredMenuSpot(player) {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const parked = this.pvpDodge && (system.currentTick < (this.parkUntilTick.get(player.name) ?? 0) || this.findPvpTargetInView(player) !== void 0);
    return parked ? spotInFront(head, view, -1.5, 0.2) : spotInFront(head, view, 1.35, 0.5);
  }
  ensureMenuEntity(player) {
    let e = this.menuEntities.get(player.name);
    const pos = this.desiredMenuSpot(player);
    if (!e || !e.isValid) {
      try {
        e = player.dimension.spawnEntity(this.entityId, pos);
        e.nameTag = this.manifest.invTitleTag;
        try {
          e.addEffect("invisibility", 2e7, { showParticles: false });
        } catch {
        }
        this.menuEntities.set(player.name, e);
        const st = this.getState(player);
        st.openedTick = system.currentTick;
        this.syncContainer(e, st, player);
      } catch (err) {
        this.logErr(`entity.spawn(${player.name})`, err);
        return void 0;
      }
    } else {
      try {
        e.teleport(pos);
      } catch {
      }
    }
    return e;
  }
  pollPlayer(player) {
    if (!player.isValid)
      return;
    const held = this.isHoldingTrigger(player);
    const now = system.currentTick;
    const armed = (this.armedUntil.get(player.name) ?? 0) > now;
    const prevHeld = this.lastHeld.get(player.name) ?? false;
    if (prevHeld !== held) {
      this.lastHeld.set(player.name, held);
      if (!held && (this.opts.triggerItemId || this.opts.isTriggerHeld)) {
        this.armedUntil.delete(player.name);
        if (this.menuEntities.has(player.name))
          this.removeMenuEntity(player.name);
        return;
      }
    }
    if (!held && !armed) {
      if (this.menuEntities.has(player.name))
        this.removeMenuEntity(player.name);
      return;
    }
    const menu = this.ensureMenuEntity(player);
    const c = menu ? invOf(menu) : void 0;
    if (!menu || !c)
      return;
    const state = this.getState(player);
    const cur = getBakedState(this.manifest, state);
    const slot1 = c.getItem(1);
    if (slot1?.typeId !== MENU_MARKER_ITEM || slot1.nameTag !== cur.tag) {
      this.sweepMarkerItems(player);
      this.syncContainer(menu, state, player);
      return;
    }
    for (let j = 0; j < cur.buttons.length && 2 + j < 27; j++) {
      const slot = 2 + j;
      const item = c.getItem(slot);
      const expected = `${cur.buttons[j].hitTag}${cur.buttons[j].label}`;
      if (item?.typeId === MENU_MARKER_ITEM && item.nameTag === expected)
        continue;
      const taken = this.lastTakenMarker.get(player.name);
      this.lastTakenMarker.delete(player.name);
      if (taken && now - taken.tick <= 2 && taken.tag !== expected) {
        this.sweepMarkerItems(player);
        this.syncContainer(menu, state, player);
        return;
      }
      this.sweepMarkerItems(player);
      const btn = cur.buttons[j];
      if (btn.special === "close") {
        this.close(player);
        return;
      }
      if (armed)
        this.armedUntil.set(player.name, now + this.armTicks);
      applyBakedButton(this.manifest, state, btn);
      this.opts.onButtonClick?.(player, btn, state);
      if (!player.isValid)
        return;
      const still = this.menuEntities.get(player.name);
      if (still?.isValid)
        this.syncContainer(still, state, player);
      return;
    }
    if (cur.dynSlots?.length && now % this.dynRefreshTicks === 0) {
      this.syncContainer(menu, state, player);
    }
  }
  sweepOrphanMenus() {
    const online = new Set(world.getAllPlayers().filter((p) => p.isValid).map((p) => p.name));
    const owned = /* @__PURE__ */ new Set();
    for (const [name, e] of [...this.menuEntities.entries()]) {
      let valid = false;
      try {
        valid = Boolean(e?.isValid) && online.has(name);
      } catch {
        valid = false;
      }
      if (!valid) {
        this.removeMenuEntity(name);
        continue;
      }
      owned.add(e.id);
    }
    for (const dimId of ["overworld", "nether", "the_end"]) {
      try {
        for (const e of world.getDimension(dimId).getEntities({ type: this.entityId })) {
          if (!owned.has(e.id))
            this.clearEntitySafely(e);
        }
      } catch {
      }
    }
  }
};

// dist/runtime/hud.js
import { system as system2, world as world2 } from "@minecraft/server";

// examples/guild-codex/packs/bp/src/generated/baked_site.json
var baked_site_default = {
  version: 1,
  namespace: "guild_codex",
  entityId: "guild_codex:menu",
  routerTag: "\xA7w\xA7b",
  invTitleTag: "\xA7b\xA7w\xA7n\xA7h",
  viewport: [
    352,
    198
  ],
  sourceScale: 3,
  texScale: 2,
  initialState: "en_home",
  hitboxCount: 32,
  stateCount: 8,
  animCount: 2,
  dynCount: 4,
  animations: {
    tactical_reticle: {
      animKey: "tactical_reticle",
      animId: "tactical_reticle",
      flipBook: "fb_tactical_reticle",
      texture: "textures/ui/guild_codex/anim_tactical_reticle",
      texturePng: "textures/ui/guild_codex/anim_tactical_reticle.png",
      frames: 12,
      fps: 6,
      frameW: 224,
      frameH: 224,
      sheetW: 2688,
      sheetH: 224,
      placements: [
        {
          x: 219.67,
          y: 57.67,
          w: 37.33,
          h: 37.33,
          states: [
            "en_home",
            "ko_home"
          ]
        }
      ]
    },
    forge_flame: {
      animKey: "forge_flame",
      animId: "forge_flame",
      flipBook: "fb_forge_flame",
      texture: "textures/ui/guild_codex/anim_forge_flame",
      texturePng: "textures/ui/guild_codex/anim_forge_flame.png",
      frames: 10,
      fps: 6,
      frameW: 272,
      frameH: 152,
      sheetW: 2720,
      sheetH: 152,
      placements: [
        {
          x: 14.67,
          y: 28,
          w: 45.33,
          h: 25.33,
          states: [
            "en_shop",
            "ko_shop"
          ]
        }
      ]
    }
  },
  states: {
    en_home: {
      key: "en_home",
      index: 0,
      tag: "\xA7s\xA70\xA70",
      texture: "textures/ui/guild_codex/s_00_en_home",
      texturePng: "textures/ui/guild_codex/s_00_en_home.png",
      url: "codex://en_home",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "FIELD STUDY",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "ARMORY",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "CONTRACTS",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "BUILD NOTES",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "\uD55C\uAD6D\uC5B4",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "Deploy",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "Close",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "en_home",
          special: "close"
        },
        {
          hitId: "act_daily",
          hitTag: "\xA7h\xA70\xA77",
          label: "Daily +150G",
          x: 9,
          y: 107,
          w: 65,
          h: 14,
          xPct: "2.652%",
          yPct: "54.209%",
          wPct: "18.371%",
          hPct: "7.071%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "act_class_knight",
          hitTag: "\xA7h\xA70\xA78",
          label: "Vanguard",
          x: 210,
          y: 148,
          w: 32,
          h: 11,
          xPct: "59.659%",
          yPct: "74.916%",
          wPct: "9.186%",
          hPct: "5.724%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "act_class_arcanist",
          hitTag: "\xA7h\xA70\xA79",
          label: "Arcanist",
          x: 245,
          y: 148,
          w: 32,
          h: 11,
          xPct: "69.602%",
          yPct: "74.916%",
          wPct: "9.186%",
          hPct: "5.724%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "act_class_ranger",
          hitTag: "\xA7h\xA71\xA70",
          label: "Ranger",
          x: 280,
          y: 148,
          w: 28,
          h: 11,
          xPct: "79.545%",
          yPct: "74.916%",
          wPct: "7.955%",
          hPct: "5.724%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "act_class_cleric",
          hitTag: "\xA7h\xA71\xA71",
          label: "Cleric",
          x: 310,
          y: 148,
          w: 28,
          h: 11,
          xPct: "88.163%",
          yPct: "74.916%",
          wPct: "7.955%",
          hPct: "5.724%",
          nextState: "en_home",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    en_shop: {
      key: "en_shop",
      index: 1,
      tag: "\xA7s\xA70\xA71",
      texture: "textures/ui/guild_codex/s_01_en_shop",
      texturePng: "textures/ui/guild_codex/s_01_en_shop.png",
      url: "codex://en_shop",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "FIELD STUDY",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "ARMORY",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "CONTRACTS",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "BUILD NOTES",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "\uD55C\uAD6D\uC5B4",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "Deploy",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "Close",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "en_shop",
          special: "close"
        },
        {
          hitId: "act_buy",
          hitTag: "\xA7h\xA71\xA72",
          label: "Purchase Relic",
          x: 266,
          y: 33,
          w: 70,
          h: 15,
          xPct: "75.663%",
          yPct: "16.667%",
          wPct: "19.886%",
          hPct: "7.407%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_0",
          hitTag: "\xA7h\xA71\xA73",
          label: "Dragonfang Blade",
          x: 9,
          y: 62,
          w: 107,
          h: 45,
          xPct: "2.652%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_1",
          hitTag: "\xA7h\xA71\xA74",
          label: "Aegis of Dawn",
          x: 123,
          y: 62,
          w: 107,
          h: 45,
          xPct: "34.848%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_2",
          hitTag: "\xA7h\xA71\xA75",
          label: "Zephyr Striders",
          x: 236,
          y: 62,
          w: 107,
          h: 45,
          xPct: "67.045%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_3",
          hitTag: "\xA7h\xA71\xA76",
          label: "Chrono Hourglass",
          x: 9,
          y: 113,
          w: 107,
          h: 45,
          xPct: "2.652%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_4",
          hitTag: "\xA7h\xA71\xA77",
          label: "Phoenix Elixir",
          x: 123,
          y: 113,
          w: 107,
          h: 45,
          xPct: "34.848%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "pick_5",
          hitTag: "\xA7h\xA71\xA78",
          label: "Starlight Lantern",
          x: 236,
          y: 113,
          w: 107,
          h: 45,
          xPct: "67.045%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "en_shop",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    en_quests: {
      key: "en_quests",
      index: 2,
      tag: "\xA7s\xA70\xA72",
      texture: "textures/ui/guild_codex/s_02_en_quests",
      texturePng: "textures/ui/guild_codex/s_02_en_quests.png",
      url: "codex://en_quests",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "FIELD STUDY",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "ARMORY",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "CONTRACTS",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "BUILD NOTES",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "\uD55C\uAD6D\uC5B4",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "Deploy",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "Close",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "en_quests",
          special: "close"
        },
        {
          hitId: "act_accept_quest",
          hitTag: "\xA7h\xA71\xA79",
          label: "Track Quest",
          x: 271,
          y: 33,
          w: 71,
          h: 14,
          xPct: "77.083%",
          yPct: "16.835%",
          wPct: "20.265%",
          hPct: "7.071%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "quest_0",
          hitTag: "\xA7h\xA72\xA70",
          label: "Slay the Crimson Wyrm",
          x: 9,
          y: 61,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "30.64%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "quest_1",
          hitTag: "\xA7h\xA72\xA71",
          label: "Hold the Northern Bastion",
          x: 9,
          y: 95,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "48.148%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "quest_2",
          hitTag: "\xA7h\xA72\xA72",
          label: "Recover Astral Shards",
          x: 9,
          y: 130,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "65.657%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "en_quests",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    en_profile: {
      key: "en_profile",
      index: 3,
      tag: "\xA7s\xA70\xA73",
      texture: "textures/ui/guild_codex/s_03_en_profile",
      texturePng: "textures/ui/guild_codex/s_03_en_profile.png",
      url: "codex://en_profile",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "FIELD STUDY",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "ARMORY",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "CONTRACTS",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "BUILD NOTES",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "\uD55C\uAD6D\uC5B4",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "Deploy",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "Close",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "en_profile",
          special: "close"
        },
        {
          hitId: "act_toggle_sfx",
          hitTag: "\xA7h\xA72\xA73",
          label: "UI Audio Feedback",
          x: 123,
          y: 37,
          w: 107,
          h: 55,
          xPct: "35.038%",
          yPct: "18.519%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "act_toggle_aura",
          hitTag: "\xA7h\xA72\xA74",
          label: "Sanctuary Aura",
          x: 235,
          y: 37,
          w: 107,
          h: 55,
          xPct: "66.856%",
          yPct: "18.519%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "act_cycle_title",
          hitTag: "\xA7h\xA72\xA75",
          label: "Guild Standing Title",
          x: 123,
          y: 98,
          w: 107,
          h: 55,
          xPct: "35.038%",
          yPct: "49.495%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "act_reset_demo",
          hitTag: "\xA7h\xA72\xA76",
          label: "Reset Session Data",
          x: 235,
          y: 98,
          w: 107,
          h: 55,
          xPct: "66.856%",
          yPct: "49.495%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "en_profile",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    ko_home: {
      key: "ko_home",
      index: 4,
      tag: "\xA7s\xA70\xA74",
      texture: "textures/ui/guild_codex/s_04_ko_home",
      texturePng: "textures/ui/guild_codex/s_04_ko_home.png",
      url: "codex://ko_home",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "\uC804\uC7A5 \uBE0C\uB9AC\uD551",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "\uC720\uBB3C \uBB34\uAE30\uACE0",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "\uD604\uC0C1\uAE08 \uC758\uB8B0",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "\uC124\uC815 \xB7 \uAE30\uB85D",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "English",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "en_home",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "\uCD9C\uACA9",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "\uB2EB\uAE30",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "ko_home",
          special: "close"
        },
        {
          hitId: "act_daily",
          hitTag: "\xA7h\xA72\xA77",
          label: "\uC77C\uC77C +150G",
          x: 9,
          y: 101,
          w: 65,
          h: 14,
          xPct: "2.652%",
          yPct: "50.842%",
          wPct: "18.371%",
          hPct: "7.071%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "act_class_knight",
          hitTag: "\xA7h\xA72\xA78",
          label: "\uC120\uBD09 \uAE30\uC0AC",
          x: 242,
          y: 148,
          w: 21,
          h: 11,
          xPct: "68.845%",
          yPct: "74.916%",
          wPct: "6.061%",
          hPct: "5.724%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "act_class_arcanist",
          hitTag: "\xA7h\xA72\xA79",
          label: "\uB9C8\uB3C4\uC0AC",
          x: 266,
          y: 148,
          w: 25,
          h: 11,
          xPct: "75.568%",
          yPct: "74.916%",
          wPct: "7.008%",
          hPct: "5.724%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "act_class_ranger",
          hitTag: "\xA7h\xA73\xA70",
          label: "\uAD81\uC218",
          x: 293,
          y: 148,
          w: 21,
          h: 11,
          xPct: "83.333%",
          yPct: "74.916%",
          wPct: "6.061%",
          hPct: "5.724%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "act_class_cleric",
          hitTag: "\xA7h\xA73\xA71",
          label: "\uC0AC\uC81C",
          x: 317,
          y: 148,
          w: 21,
          h: 11,
          xPct: "90.057%",
          yPct: "74.916%",
          wPct: "6.061%",
          hPct: "5.724%",
          nextState: "ko_home",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    ko_shop: {
      key: "ko_shop",
      index: 5,
      tag: "\xA7s\xA70\xA75",
      texture: "textures/ui/guild_codex/s_05_ko_shop",
      texturePng: "textures/ui/guild_codex/s_05_ko_shop.png",
      url: "codex://ko_shop",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "\uC804\uC7A5 \uBE0C\uB9AC\uD551",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "\uC720\uBB3C \uBB34\uAE30\uACE0",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "\uD604\uC0C1\uAE08 \uC758\uB8B0",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "\uC124\uC815 \xB7 \uAE30\uB85D",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "English",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "en_shop",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "\uCD9C\uACA9",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "\uB2EB\uAE30",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "ko_shop",
          special: "close"
        },
        {
          hitId: "act_buy",
          hitTag: "\xA7h\xA71\xA72",
          label: "\uC720\uBB3C \uAD6C\uB9E4",
          x: 266,
          y: 33,
          w: 70,
          h: 15,
          xPct: "75.663%",
          yPct: "16.667%",
          wPct: "19.886%",
          hPct: "7.407%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_0",
          hitTag: "\xA7h\xA71\xA73",
          label: "\uC6A9\uC544 \uB300\uAC80",
          x: 9,
          y: 62,
          w: 107,
          h: 45,
          xPct: "2.652%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_1",
          hitTag: "\xA7h\xA71\xA74",
          label: "\uC5EC\uBA85\uC758 \uC774\uC9C0\uC2A4",
          x: 123,
          y: 62,
          w: 107,
          h: 45,
          xPct: "34.848%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_2",
          hitTag: "\xA7h\xA71\xA75",
          label: "\uC11C\uD48D\uC758 \uC7A5\uD654",
          x: 236,
          y: 62,
          w: 107,
          h: 45,
          xPct: "67.045%",
          yPct: "31.313%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_3",
          hitTag: "\xA7h\xA71\xA76",
          label: "\uC2DC\uAC04\uC758 \uBAA8\uB798\uC2DC\uACC4",
          x: 9,
          y: 113,
          w: 107,
          h: 45,
          xPct: "2.652%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_4",
          hitTag: "\xA7h\xA71\xA77",
          label: "\uBD88\uC0AC\uC870 \uC601\uC57D",
          x: 123,
          y: 113,
          w: 107,
          h: 45,
          xPct: "34.848%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "pick_5",
          hitTag: "\xA7h\xA71\xA78",
          label: "\uBCC4\uBE5B \uB4F1\uBD88",
          x: 236,
          y: 113,
          w: 107,
          h: 45,
          xPct: "67.045%",
          yPct: "57.239%",
          wPct: "30.303%",
          hPct: "22.896%",
          nextState: "ko_shop",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    ko_quests: {
      key: "ko_quests",
      index: 6,
      tag: "\xA7s\xA70\xA76",
      texture: "textures/ui/guild_codex/s_06_ko_quests",
      texturePng: "textures/ui/guild_codex/s_06_ko_quests.png",
      url: "codex://ko_quests",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "\uC804\uC7A5 \uBE0C\uB9AC\uD551",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "\uC720\uBB3C \uBB34\uAE30\uACE0",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "\uD604\uC0C1\uAE08 \uC758\uB8B0",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "\uC124\uC815 \xB7 \uAE30\uB85D",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "English",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "en_quests",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "\uCD9C\uACA9",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "\uB2EB\uAE30",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "ko_quests",
          special: "close"
        },
        {
          hitId: "act_accept_quest",
          hitTag: "\xA7h\xA71\xA79",
          label: "\uC758\uB8B0 \uC218\uB77D",
          x: 271,
          y: 33,
          w: 71,
          h: 14,
          xPct: "77.083%",
          yPct: "16.835%",
          wPct: "20.265%",
          hPct: "7.071%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "quest_0",
          hitTag: "\xA7h\xA72\xA70",
          label: "\uC9C4\uD64D\uBE5B \uC640\uC774\uBC88 \uD1A0\uBC8C",
          x: 9,
          y: 61,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "30.64%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "quest_1",
          hitTag: "\xA7h\xA72\xA71",
          label: "\uBD81\uBD80 \uC131\uCC44 \uBC29\uC5B4\uC804",
          x: 9,
          y: 95,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "48.148%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "quest_2",
          hitTag: "\xA7h\xA72\xA72",
          label: "\uBCC4\uBE5B \uD30C\uD3B8 \uD68C\uC218",
          x: 9,
          y: 130,
          w: 333,
          h: 29,
          xPct: "2.652%",
          yPct: "65.657%",
          wPct: "94.697%",
          hPct: "14.815%",
          nextState: "ko_quests",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    },
    ko_profile: {
      key: "ko_profile",
      index: 7,
      tag: "\xA7s\xA70\xA77",
      texture: "textures/ui/guild_codex/s_07_ko_profile",
      texturePng: "textures/ui/guild_codex/s_07_ko_profile.png",
      url: "codex://ko_profile",
      title: "Aetherium Field Codex",
      buttons: [
        {
          hitId: "nav_home",
          hitTag: "\xA7h\xA70\xA70",
          label: "\uC804\uC7A5 \uBE0C\uB9AC\uD551",
          x: 95,
          y: 4,
          w: 39,
          h: 10,
          xPct: "27.083%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_home",
          special: null
        },
        {
          hitId: "nav_shop",
          hitTag: "\xA7h\xA70\xA71",
          label: "\uC720\uBB3C \uBB34\uAE30\uACE0",
          x: 137,
          y: 4,
          w: 39,
          h: 10,
          xPct: "38.826%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_shop",
          special: null
        },
        {
          hitId: "nav_quests",
          hitTag: "\xA7h\xA70\xA72",
          label: "\uD604\uC0C1\uAE08 \uC758\uB8B0",
          x: 178,
          y: 4,
          w: 39,
          h: 10,
          xPct: "50.568%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_quests",
          special: null
        },
        {
          hitId: "nav_profile",
          hitTag: "\xA7h\xA70\xA73",
          label: "\uC124\uC815 \xB7 \uAE30\uB85D",
          x: 219,
          y: 4,
          w: 39,
          h: 10,
          xPct: "62.311%",
          yPct: "2.02%",
          wPct: "10.985%",
          hPct: "5.051%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "set_lang",
          hitTag: "\xA7h\xA70\xA74",
          label: "English",
          x: 269,
          y: 4,
          w: 24,
          h: 11,
          xPct: "76.326%",
          yPct: "1.852%",
          wPct: "6.818%",
          hPct: "5.387%",
          nextState: "en_profile",
          special: null
        },
        {
          hitId: "act_deploy",
          hitTag: "\xA7h\xA70\xA75",
          label: "\uCD9C\uACA9",
          x: 295,
          y: 4,
          w: 35,
          h: 11,
          xPct: "83.902%",
          yPct: "1.852%",
          wPct: "9.848%",
          hPct: "5.387%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "close_menu",
          hitTag: "\xA7h\xA70\xA76",
          label: "\uB2EB\uAE30",
          x: 333,
          y: 4,
          w: 11,
          h: 11,
          xPct: "94.508%",
          yPct: "1.852%",
          wPct: "3.03%",
          hPct: "5.387%",
          nextState: "ko_profile",
          special: "close"
        },
        {
          hitId: "act_toggle_sfx",
          hitTag: "\xA7h\xA72\xA73",
          label: "\uBA54\uB274 \uD6A8\uACFC\uC74C \uC804\uD658",
          x: 123,
          y: 37,
          w: 107,
          h: 55,
          xPct: "35.038%",
          yPct: "18.519%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "act_toggle_aura",
          hitTag: "\xA7h\xA72\xA74",
          label: "\uC131\uC18C \uC624\uB77C \uC774\uD399\uD2B8",
          x: 235,
          y: 37,
          w: 107,
          h: 55,
          xPct: "66.856%",
          yPct: "18.519%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "act_cycle_title",
          hitTag: "\xA7h\xA72\xA75",
          label: "\uAE38\uB4DC \uCE6D\uD638 \uC21C\uD658",
          x: 123,
          y: 98,
          w: 107,
          h: 55,
          xPct: "35.038%",
          yPct: "49.495%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "ko_profile",
          special: null
        },
        {
          hitId: "act_reset_demo",
          hitTag: "\xA7h\xA72\xA76",
          label: "\uB370\uBAA8 \uB370\uC774\uD130 \uCD08\uAE30\uD654",
          x: 235,
          y: 98,
          w: 107,
          h: 55,
          xPct: "66.856%",
          yPct: "49.495%",
          wPct: "30.303%",
          hPct: "27.609%",
          nextState: "ko_profile",
          special: null
        }
      ],
      dynSlots: [
        {
          slot: 26,
          dynId: "gold",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 25,
          dynId: "gems",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 24,
          dynId: "status_primary",
          maskTag: "\xA79\xA70",
          tone: "main"
        },
        {
          slot: 23,
          dynId: "status_secondary",
          maskTag: "\xA79\xA70",
          tone: "main"
        }
      ]
    }
  }
};

// examples/guild-codex/packs/bp/src/main.ts
var TITLES = [
  { en: "Mythic III", ko: "\uC2E0\uD654 III" },
  { en: "Citadel Warden", ko: "\uC131\uCC44 \uC218\uD638\uC790" },
  { en: "Astral Sage", ko: "\uC131\uC88C \uD604\uC790" }
];
var CLASSES = {
  knight: { en: "Vanguard Knight", ko: "\uC120\uBD09 \uAE30\uC0AC", stats: "HP 26 \xB7 ATK 8" },
  arcanist: { en: "Astral Arcanist", ko: "\uBE44\uC804 \uB9C8\uB3C4\uC0AC", stats: "HP 18 \xB7 MAG 12" },
  ranger: { en: "Windwalker", ko: "\uBC14\uB78C \uAD81\uC218", stats: "HP 20 \xB7 SPD +20%" },
  cleric: { en: "Dawncleric", ko: "\uC5EC\uBA85 \uC0AC\uC81C", stats: "HP 22 \xB7 HEAL +6" }
};
var RELICS = [
  { en: "Dragonfang Blade", ko: "\uC6A9\uC544 \uB300\uAC80", gold: 420, gems: 0, perkEn: "Ignites targets on crit strikes.", perkKo: "\uCE58\uBA85\uD0C0 \uC801\uC911 \uC2DC \uD654\uC5FC \uC810\uD654." },
  { en: "Aegis of Dawn", ko: "\uC5EC\uBA85\uC758 \uC774\uC9C0\uC2A4", gold: 310, gems: 0, perkEn: "Absorbs 35% projectile impact.", perkKo: "\uD22C\uC0AC\uCCB4 \uD53C\uD574 35% \uACBD\uAC10." },
  { en: "Zephyr Striders", ko: "\uC11C\uD48D\uC758 \uC7A5\uD654", gold: 240, gems: 0, perkEn: "Grants Swiftness II in sprints.", perkKo: "\uC9C8\uC8FC \uC2DC \uC2E0\uC18D II \uBD80\uC5EC." },
  { en: "Chrono Hourglass", ko: "\uC2DC\uAC04\uC758 \uBAA8\uB798\uC2DC\uACC4", gold: 0, gems: 6, perkEn: "Cuts skill cooldowns by 25%.", perkKo: "\uC2A4\uD0AC \uC7AC\uC0AC\uC6A9 \uB300\uAE30 25% \uB2E8\uCD95." },
  { en: "Phoenix Elixir", ko: "\uBD88\uC0AC\uC870 \uC601\uC57D", gold: 160, gems: 0, perkEn: "Instant +10 HP & Fire Resist.", perkKo: "\uC989\uC2DC \uCCB4\uB825 +10 \uBC0F \uD654\uC5FC \uC800\uD56D." },
  { en: "Starlight Lantern", ko: "\uBCC4\uBE5B \uB4F1\uBD88", gold: 0, gems: 4, perkEn: "Reveals hidden dungeon chests.", perkKo: "\uC228\uACA8\uC9C4 \uB358\uC804 \uBCF4\uBB3C \uC0C1\uC790 \uD0D0\uC9C0." }
];
var QUESTS = [
  { en: "Slay the Crimson Wyrm (S-Rank)", ko: "\uC9C4\uD64D\uBE5B \uC640\uC774\uBC88 \uD1A0\uBC8C (S\uB4F1\uAE09)", reward: "+600 G \xB7 +3 Gems" },
  { en: "Hold the Northern Bastion (A-Rank)", ko: "\uBD81\uBD80 \uC131\uCC44 \uBC29\uC5B4\uC804 (A\uB4F1\uAE09)", reward: "+380 G \xB7 +2 Gems" },
  { en: "Recover Astral Shards (B-Rank)", ko: "\uBCC4\uBE5B \uD30C\uD3B8 \uD68C\uC218 (B\uB4F1\uAE09)", reward: "+220 G \xB7 +1 Gem" }
];
var profiles = /* @__PURE__ */ new Map();
function profileOf(name) {
  let p = profiles.get(name);
  if (!p) {
    p = {
      gold: 2450,
      gems: 18,
      heroClass: "knight",
      selectedRelic: 0,
      ownedRelics: /* @__PURE__ */ new Set(),
      selectedQuest: 0,
      activeQuest: null,
      sfx: true,
      aura: true,
      titleIdx: 0,
      dailyClaimed: false
    };
    profiles.set(name, p);
  }
  return p;
}
function playUiSound(player, profile, soundId, pitch = 1) {
  if (!profile.sfx) return;
  try {
    player.playSound(soundId, { volume: 0.55, pitch });
  } catch {
  }
}
var codexMenu = new BakedMenuManager(baked_site_default, {
  triggerItemId: "minecraft:compass",
  resolveDynamicValues(player, state) {
    const p = profileOf(player.name);
    const ko = state.bakedKey.startsWith("ko_");
    const tab = state.bakedKey.slice(3);
    const cls = CLASSES[p.heroClass];
    const title = TITLES[p.titleIdx % TITLES.length];
    let line1 = "";
    let line2 = "";
    if (tab === "shop") {
      const relic = RELICS[p.selectedRelic] ?? RELICS[0];
      const owned = p.ownedRelics.has(p.selectedRelic);
      const priceStr = relic.gold > 0 ? `${relic.gold} G` : `${relic.gems} Gems`;
      const afford = p.gold >= relic.gold && p.gems >= relic.gems;
      line1 = ko ? `\xA76\uC120\uD0DD \uC720\uBB3C: \xA7f${relic.ko} \xA77(${priceStr}) ${owned ? "\xA7a[\uBCF4\uC720\uC911]" : afford ? "\xA7a\u2713 \uAD6C\uB9E4\uAC00\uB2A5" : "\xA7c\u2717 \uC7AC\uD654\uBD80\uC871"}` : `\xA76Selected: \xA7f${relic.en} \xA77(${priceStr}) ${owned ? "\xA7a[OWNED]" : afford ? "\xA7a\u2713 Ready" : "\xA7c\u2717 Insufficient"}`;
      line2 = ko ? `\xA77\uD6A8\uACFC: \xA7f${relic.perkKo}` : `\xA77Perk: \xA7f${relic.perkEn}`;
    } else if (tab === "quests") {
      const q = QUESTS[p.selectedQuest] ?? QUESTS[0];
      const tracked = p.activeQuest === p.selectedQuest;
      line1 = ko ? `\xA76\uC120\uD0DD \uC758\uB8B0: \xA7f${q.ko} ${tracked ? "\xA7a[\uCD94\uC801\uC911]" : "\xA7e[\uBBF8\uC218\uB77D]"}` : `\xA76Selected Quest: \xA7f${q.en} ${tracked ? "\xA7a[TRACKING]" : "\xA7e[AVAILABLE]"}`;
      line2 = ko ? `\xA77\uBCF4\uC0C1: \xA7e${q.reward} \xA77| \uC6B0\uCE21 \uC0C1\uB2E8 \uBC84\uD2BC\uC73C\uB85C \uC758\uB8B0 \uC218\uB77D` : `\xA77Reward: \xA7e${q.reward} \xA77| Click ACCEPT & TRACK to begin`;
    } else if (tab === "profile") {
      line1 = ko ? `\xA76\uAE38\uB4DC\uC6D0: \xA7f${player.name} \xA77| \uCE6D\uD638: \xA7b${title.ko} \xA77| \uBCF4\uC720 \uC720\uBB3C: \xA7e${p.ownedRelics.size}/6` : `\xA76Member: \xA7f${player.name} \xA77| Title: \xA7b${title.en} \xA77| Relics: \xA7e${p.ownedRelics.size}/6`;
      line2 = ko ? `\xA77\uD6A8\uACFC\uC74C: ${p.sfx ? "\xA7aON" : "\xA7cOFF"} \xA77| \uC131\uC18C \uC624\uB77C: ${p.aura ? "\xA7dON" : "\xA7cOFF"} \xA77| \uD074\uB9AD \uC218: \xA7f${state.clicks}` : `\xA77UI SFX: ${p.sfx ? "\xA7aON" : "\xA7cOFF"} \xA77| Aura: ${p.aura ? "\xA7dON" : "\xA7cOFF"} \xA77| Clicks: \xA7f${state.clicks}`;
    } else {
      line1 = ko ? `\xA76\uBCD1\uACFC: \xA7f${cls.ko} \xA77(${cls.stats}) | \uCE6D\uD638: \xA7b${title.ko}` : `\xA76Class: \xA7f${cls.en} \xA77(${cls.stats}) | Title: \xA7b${title.en}`;
      line2 = ko ? `\xA77\uC77C\uC77C \uACF5\uBB3C: ${p.dailyClaimed ? "\xA7a\uC218\uB839 \uC644\uB8CC" : "\xA7e\uC218\uB839 \uAC00\uB2A5 (+150 G)"} \xA77| \uC758\uB8B0: ${p.activeQuest !== null ? "\xA7b\uC9C4\uD589\uC911" : "\xA77\uC5C6\uC74C"}` : `\xA77Daily Tribute: ${p.dailyClaimed ? "\xA7aClaimed" : "\xA7eAvailable (+150 G)"} \xA77| Quest: ${p.activeQuest !== null ? "\xA7bActive" : "\xA77None"}`;
    }
    return {
      gold: `\xA76\xA7l${p.gold.toLocaleString("en-US")} G`,
      gems: `\xA7b\xA7l${p.gems} Gems`,
      status_primary: fitText(line1, 58),
      status_secondary: fitText(line2, 58)
    };
  },
  onButtonClick(player, button, state) {
    const p = profileOf(player.name);
    const ko = state.bakedKey.startsWith("ko_");
    const id = button.hitId;
    if (id.startsWith("act_class_")) {
      const cls = id.slice(10);
      if (cls in CLASSES) {
        p.heroClass = cls;
        playUiSound(player, p, "random.orb", 1.25);
      }
      return;
    }
    if (id === "act_deploy") {
      playUiSound(player, p, "mob.enderdragon.growl", 1.1);
      player.sendMessage(ko ? "\xA7a[\uAE38\uB4DC] \uD751\uC694\uC11D \uC131\uCC44\uB85C \uCD9C\uACA9 \uC900\uBE44\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!" : "\xA7a[Guild] Ready to deploy to the Obsidian Citadel!");
      codexMenu.close(player);
      return;
    }
    if (id === "act_daily") {
      if (p.dailyClaimed) {
        playUiSound(player, p, "note.bass", 0.7);
      } else {
        p.dailyClaimed = true;
        p.gold += 150;
        playUiSound(player, p, "random.levelup", 1.3);
      }
      return;
    }
    if (id.startsWith("pick_")) {
      p.selectedRelic = Number(id.slice(5)) || 0;
      playUiSound(player, p, "random.click", 1.1);
      return;
    }
    if (id === "act_buy") {
      const relic = RELICS[p.selectedRelic];
      if (!relic || p.ownedRelics.has(p.selectedRelic) || p.gold < relic.gold || p.gems < relic.gems) {
        playUiSound(player, p, "note.bass", 0.65);
        return;
      }
      p.gold -= relic.gold;
      p.gems -= relic.gems;
      p.ownedRelics.add(p.selectedRelic);
      playUiSound(player, p, "random.anvil_use", 1.15);
      return;
    }
    if (id.startsWith("quest_")) {
      p.selectedQuest = Number(id.slice(6)) || 0;
      playUiSound(player, p, "random.click", 1.05);
      return;
    }
    if (id === "act_accept_quest") {
      p.activeQuest = p.selectedQuest;
      playUiSound(player, p, "random.levelup", 1.15);
      return;
    }
    if (id === "act_toggle_sfx") {
      p.sfx = !p.sfx;
      playUiSound(player, p, "random.orb", 1.1);
      return;
    }
    if (id === "act_toggle_aura") {
      p.aura = !p.aura;
      playUiSound(player, p, "random.orb", 1.3);
      return;
    }
    if (id === "act_cycle_title") {
      p.titleIdx = (p.titleIdx + 1) % TITLES.length;
      playUiSound(player, p, "random.orb", 1.2);
      return;
    }
    if (id === "act_reset_demo") {
      profiles.delete(player.name);
      playUiSound(player, profileOf(player.name), "random.levelup", 0.9);
      return;
    }
    playUiSound(player, p, "random.click", 1);
  }
});
codexMenu.install();
world3.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  try {
    const inv = p.getComponent(EntityComponentTypes2.Inventory)?.container;
    if (inv) {
      let hasCompass = false;
      for (let i = 0; i < inv.size; i++) {
        if (inv.getItem(i)?.typeId === "minecraft:compass") {
          hasCompass = true;
          break;
        }
      }
      if (!hasCompass) {
        const compass = new ItemStack2("minecraft:compass", 1);
        compass.nameTag = "\xA7aAetherium Codex";
        inv.addItem(compass);
      }
    }
    p.sendMessage("\xA7a[Aetherium] \xA7fHold the Compass and Right-Click to open the Codex, or type \xA7e!codex \xA7f/ \xA7e!codex ko");
  } catch {
  }
});
world3.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim().toLowerCase();
  if (msg === "!codex") {
    ev.cancel = true;
    system3.run(() => codexMenu.open(ev.sender, "en_home"));
  } else if (msg === "!codex ko") {
    ev.cancel = true;
    system3.run(() => codexMenu.open(ev.sender, "ko_home"));
  } else if (msg === "!codex form") {
    ev.cancel = true;
    system3.run(() => {
      void codexMenu.openActionFormFallback(ev.sender);
    });
  }
});
export {
  codexMenu
};
