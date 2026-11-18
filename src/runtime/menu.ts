// Bedrock Behavior Pack Runtime Controller for HTML-Baked Entity Inventory UI + ActionFormData fallback.

import {
  Entity,
  EntityComponentTypes,
  EntityDamageCause,
  ItemStack,
  Player,
  system,
  world,
} from '@minecraft/server';
import type { BakedButton, BakedSiteManifest } from '../types.js';
import {
  applyBakedButton,
  buildActionFormSpec,
  buildInvSlotPlan,
  createMenuState,
  getBakedState,
  isBakedMarkerTag,
  MENU_MARKER_ITEM,
  resolveRouteKey,
  spotInFront,
  type BakedMenuState,
} from './sim.js';

export interface BakedMenuOptions {
  /** Optional hotbar item typeId that arms the zero-flicker chest menu while held (e.g. 'minecraft:compass'). */
  triggerItemId?: string;
  /** Optional exact nameTag check on the trigger item (if omitted, any item matching triggerItemId qualifies). */
  triggerItemNameTag?: string;
  /** Optional custom predicate to decide whether a player's menu should stay armed. */
  isTriggerHeld?: (player: Player) => boolean;
  /** Duration in ticks that `open(player)` keeps the menu armed even without holding a trigger item (default: 1200). */
  armTicks?: number;
  /** Dynamic `[data-dyn]` refresh interval in ticks (default: 10 = 0.5s). */
  dynRefreshTicks?: number;
  /** Orphan menu entity sweep interval in ticks (default: 100 = 5s). */
  orphanSweepTicks?: number;
  /** Forward melee swings & auto-dodge when a living target is in front of the player (default: true). */
  pvpDodge?: boolean;
  /** Resolves live string values for every `[data-dyn="id"]` present in the current state. */
  resolveDynamicValues?: (player: Player, state: BakedMenuState) => Record<string, string>;
  /** Called whenever a player clicks a baked button (after `state.bakedKey` advances to `button.nextState`). */
  onButtonClick?: (player: Player, button: BakedButton, state: BakedMenuState) => void;
  /** Called when a `data-special="close"` button is clicked or the menu is explicitly closed. */
  onClose?: (player: Player, state: BakedMenuState) => void;
  /** Optional error logger (defaults to silent safe handling so tick loops never crash). */
  onError?: (context: string, error: unknown) => void;
}

type InvContainer = {
  size: number;
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
};

function invOf(entity: { getComponent(id: string): unknown }): InvContainer | undefined {
  return (entity.getComponent(EntityComponentTypes.Inventory) as { container?: InvContainer } | undefined)?.container;
}

/**
 * Manages zero-flicker Entity Inventory UI menus (plus optional ActionFormData fallback)
 * for all online players in a Minecraft Bedrock Behavior Pack.
 */
export class BakedMenuManager {
  readonly manifest: BakedSiteManifest;
  readonly entityId: string;
  private readonly opts: BakedMenuOptions;
  private readonly armTicks: number;
  private readonly dynRefreshTicks: number;
  private readonly orphanSweepTicks: number;
  private readonly pvpDodge: boolean;

  private readonly playerStates = new Map<string, BakedMenuState>();
  private readonly menuEntities = new Map<string, Entity>();
  private readonly parkUntilTick = new Map<string, number>();
  private readonly armedUntil = new Map<string, number>();
  private readonly lastHeld = new Map<string, boolean>();
  private readonly lastTakenMarker = new Map<string, { tag: string; tick: number }>();
  private readonly formTokens = new Map<string, number>();

  private installed = false;
  private pollRunId: number | undefined;
  private sweepRunId: number | undefined;

  constructor(manifest: BakedSiteManifest, opts: BakedMenuOptions = {}) {
    this.manifest = manifest;
    this.entityId = manifest.entityId;
    this.opts = opts;
    this.armTicks = opts.armTicks ?? 1200;
    this.dynRefreshTicks = Math.max(1, opts.dynRefreshTicks ?? 10);
    this.orphanSweepTicks = Math.max(20, opts.orphanSweepTicks ?? 100);
    this.pvpDodge = opts.pvpDodge ?? true;
  }

  private logErr(context: string, err: unknown): void {
    try {
      this.opts.onError?.(context, err);
    } catch {}
  }

  /** Gets or initializes the player's menu state. */
  getState(player: Player): BakedMenuState {
    let st = this.playerStates.get(player.name);
    if (!st) {
      st = createMenuState(this.manifest);
      this.playerStates.set(player.name, st);
    }
    return st;
  }

  /** Returns the current menu state by player name if initialized. */
  getStateByName(playerName: string): BakedMenuState | undefined {
    return this.playerStates.get(playerName);
  }

  /** Returns true if the player currently has an active menu entity spawned. */
  isOpen(playerName: string): boolean {
    try {
      return this.menuEntities.get(playerName)?.isValid === true;
    } catch {
      return false;
    }
  }

  /** Installs tick polling, tick-late marker sweep, orphan entity cleanup, and PvP melee pass-through. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.sweepOrphanMenus();

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

    // Marker sweep rule: playerInventoryItemChange can fire a tick late; always re-read the slot before clearing
    // so an item rewarded by the same button click is never erased.
    world.afterEvents.playerInventoryItemChange.subscribe((ev) => {
      try {
        const it = ev.itemStack;
        if (it?.typeId !== MENU_MARKER_ITEM || !isBakedMarkerTag(it.nameTag)) return;
        if (it.nameTag) {
          this.lastTakenMarker.set(ev.player.name, { tag: it.nameTag, tick: system.currentTick });
        }
        const c = invOf(ev.player);
        const now = c?.getItem(ev.slot);
        if (now?.typeId === MENU_MARKER_ITEM && isBakedMarkerTag(now.nameTag)) {
          c?.setItem(ev.slot, undefined);
        }
      } catch {}
    });

    if (this.pvpDodge) {
      world.afterEvents.entityHitEntity.subscribe((ev) => {
        try {
          if (ev.hitEntity?.typeId !== this.entityId) return;
          const rawAttacker = ev.damagingEntity;
          if (!rawAttacker || rawAttacker.typeId !== 'minecraft:player' || !rawAttacker.isValid) return;
          const attacker = rawAttacker as Player;
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
            target.applyKnockback({ x: (v.x / len) * 0.4, z: (v.z / len) * 0.4 }, 0.36);
          }
        } catch {}
      });
    }

    world.afterEvents.playerLeave.subscribe((ev) => {
      this.closeByName(ev.playerName);
      this.playerStates.delete(ev.playerName);
    });
  }

  /** Arms the zero-flicker Entity Inventory UI for `player` and navigates to `route` if given. */
  open(player: Player, route?: string): void {
    if (!player.isValid) return;
    const st = this.getState(player);
    if (route) st.bakedKey = resolveRouteKey(this.manifest, route);

    const now = system.currentTick;
    this.armedUntil.set(player.name, now + this.armTicks);

    // If a trigger item is configured and present on hotbar, focus it for smoother UX
    if (this.opts.triggerItemId) {
      const c = invOf(player);
      if (c) {
        for (let i = 0; i < Math.min(9, c.size); i++) {
          const it = c.getItem(i);
          if (
            it?.typeId === this.opts.triggerItemId &&
            (!this.opts.triggerItemNameTag || it.nameTag === this.opts.triggerItemNameTag)
          ) {
            try {
              player.selectedSlotIndex = i;
            } catch {}
            break;
          }
        }
      }
    }

    this.lastHeld.set(player.name, this.isHoldingTrigger(player));
    const entity = this.ensureMenuEntity(player);
    if (entity) this.syncContainer(entity, st, player);
  }

  /** Immediately refreshes the player's menu container (e.g. after external game state changes). */
  refresh(player: Player): void {
    const e = this.menuEntities.get(player.name);
    if (!e?.isValid || !player.isValid) return;
    this.syncContainer(e, this.getState(player), player);
  }

  /** Navigates a player's menu to `route` in-place (zero flicker) without reopening. */
  navigate(player: Player, route: string): void {
    const st = this.getState(player);
    st.bakedKey = resolveRouteKey(this.manifest, route);
    this.refresh(player);
  }

  /** Closes the menu entity for `player`. */
  close(player: Player): void {
    this.armedUntil.delete(player.name);
    this.lastTakenMarker.delete(player.name);
    this.removeMenuEntity(player.name);
    const st = this.playerStates.get(player.name);
    if (st) this.opts.onClose?.(player, st);
  }

  /** Closes and cleans up menu state by player name. */
  closeByName(playerName: string): void {
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
  async openActionFormFallback(player: Player, route?: string): Promise<void> {
    if (!player.isValid) return;
    this.removeMenuEntity(player.name);

    const serverUi = await import('@minecraft/server-ui');
    const ActionFormData = serverUi.ActionFormData;
    const FormCancelationReason = serverUi.FormCancelationReason;

    const st = this.getState(player);
    if (route) st.bakedKey = resolveRouteKey(this.manifest, route);

    const token = (this.formTokens.get(player.name) ?? 0) + 1;
    this.formTokens.set(player.name, token);
    let retries = 0;

    while (player.isValid && this.formTokens.get(player.name) === token) {
      const view = buildActionFormSpec(this.manifest, st);
      const form = new ActionFormData().title(view.title).body(view.body);
      for (const btn of view.buttons) form.button(btn.text);

      let res;
      try {
        res = await form.show(player);
      } catch (err) {
        this.logErr(`actionForm.show(${player.name})`, err);
        return;
      }

      if (!player.isValid || this.formTokens.get(player.name) !== token) return;

      if (res.canceled) {
        if (res.cancelationReason === FormCancelationReason.UserBusy && retries < 2) {
          retries += 1;
          await new Promise<void>((resolve) => system.runTimeout(() => resolve(), 4));
          continue;
        }
        return;
      }

      retries = 0;
      const picked = res.selection !== undefined ? view.buttons[res.selection]?.action : undefined;
      if (!picked || picked.special === 'close') {
        this.opts.onClose?.(player, st);
        return;
      }

      applyBakedButton(this.manifest, st, picked);
      this.opts.onButtonClick?.(player, picked, st);
    }
  }

  /** Removes all active menu entities and clears intervals (useful for tests or hot reload). */
  dispose(): void {
    for (const name of [...this.menuEntities.keys()]) this.removeMenuEntity(name);
    for (const id of [this.pollRunId, this.sweepRunId]) {
      if (id !== undefined) {
        try {
          system.clearRun(id);
        } catch {}
      }
    }
    this.pollRunId = undefined;
    this.sweepRunId = undefined;
    this.installed = false;
    this.playerStates.clear();
    this.parkUntilTick.clear();
    this.armedUntil.clear();
    this.lastHeld.clear();
    this.lastTakenMarker.clear();
    this.formTokens.clear();
  }

  private isHoldingTrigger(player: Player): boolean {
    if (this.opts.isTriggerHeld) return this.opts.isTriggerHeld(player);
    if (!this.opts.triggerItemId) return false;
    const c = invOf(player);
    if (!c) return false;
    const held = c.getItem(player.selectedSlotIndex);
    if (held?.typeId !== this.opts.triggerItemId) return false;
    if (this.opts.triggerItemNameTag && held.nameTag !== this.opts.triggerItemNameTag) return false;
    return true;
  }

  private sweepMarkerItems(player: Player): void {
    const c = invOf(player);
    if (!c) return;
    for (let i = 0; i < c.size; i++) {
      const it = c.getItem(i);
      if (it?.typeId === MENU_MARKER_ITEM && isBakedMarkerTag(it.nameTag)) {
        c.setItem(i, undefined);
      }
    }
  }

  private syncContainer(entity: Entity, state: BakedMenuState, player: Player): void {
    const c = invOf(entity);
    if (!c) return;
    const dynValues = this.opts.resolveDynamicValues ? this.opts.resolveDynamicValues(player, state) : {};
    const plan = buildInvSlotPlan(this.manifest, state, dynValues);
    const wanted = new Map<number, string>();
    for (const s of plan) wanted.set(s.slot, s.nameTag);

    if (c.getItem(0) !== undefined) c.setItem(0, undefined);
    for (let slot = 1; slot < Math.min(27, c.size); slot++) {
      const tag = wanted.get(slot);
      if (!tag) {
        if (c.getItem(slot) !== undefined) c.setItem(slot, undefined);
        continue;
      }
      const existing = c.getItem(slot);
      if (existing?.typeId === MENU_MARKER_ITEM && existing.nameTag === tag) continue;
      const item = new ItemStack(MENU_MARKER_ITEM, 1);
      item.nameTag = tag;
      c.setItem(slot, item);
    }
  }

  private clearEntitySafely(e: Entity): void {
    try {
      if (!e.isValid) return;
      const c = invOf(e);
      if (c) {
        for (let i = 0; i < c.size; i++) {
          if (c.getItem(i) !== undefined) c.setItem(i, undefined);
        }
      }
      e.remove();
    } catch (err) {
      this.logErr('entity.remove', err);
    }
  }

  private removeMenuEntity(playerName: string): void {
    this.parkUntilTick.delete(playerName);
    const e = this.menuEntities.get(playerName);
    this.menuEntities.delete(playerName);
    if (e) this.clearEntitySafely(e);
  }

  private findPvpTargetInView(player: Player): Entity | undefined {
    try {
      const hits = player.getEntitiesFromViewDirection({
        maxDistance: 3.8,
        excludeTypes: [this.entityId],
      });
      for (const h of hits) {
        const target = h.entity;
        if (!target?.isValid || target.id === player.id) continue;
        if (target.getComponent(EntityComponentTypes.Health)) return target;
      }
    } catch {}
    return undefined;
  }

  private desiredMenuSpot(player: Player): { x: number; y: number; z: number } {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const parked =
      this.pvpDodge &&
      (system.currentTick < (this.parkUntilTick.get(player.name) ?? 0) ||
        this.findPvpTargetInView(player) !== undefined);
    return parked ? spotInFront(head, view, -1.5, 0.2) : spotInFront(head, view, 1.35, 0.5);
  }

  private ensureMenuEntity(player: Player): Entity | undefined {
    let e = this.menuEntities.get(player.name);
    const pos = this.desiredMenuSpot(player);
    if (!e || !e.isValid) {
      try {
        e = player.dimension.spawnEntity(this.entityId as Parameters<typeof player.dimension.spawnEntity>[0], pos);
        e.nameTag = this.manifest.invTitleTag;
        try {
          e.addEffect('invisibility', 20000000, { showParticles: false });
        } catch {}
        this.menuEntities.set(player.name, e);
        const st = this.getState(player);
        st.openedTick = system.currentTick;
        this.syncContainer(e, st, player);
      } catch (err) {
        this.logErr(`entity.spawn(${player.name})`, err);
        return undefined;
      }
    } else {
      try {
        e.teleport(pos);
      } catch {}
    }
    return e;
  }

  private pollPlayer(player: Player): void {
    if (!player.isValid) return;
    const held = this.isHoldingTrigger(player);
    const now = system.currentTick;
    const armed = (this.armedUntil.get(player.name) ?? 0) > now;

    const prevHeld = this.lastHeld.get(player.name) ?? false;
    if (prevHeld !== held) {
      this.lastHeld.set(player.name, held);
      if (!held && (this.opts.triggerItemId || this.opts.isTriggerHeld)) {
        // Disarm immediately when moving off the trigger item so right-clicking other items never opens the chest UI
        this.armedUntil.delete(player.name);
        if (this.menuEntities.has(player.name)) this.removeMenuEntity(player.name);
        return;
      }
    }

    if (!held && !armed) {
      if (this.menuEntities.has(player.name)) this.removeMenuEntity(player.name);
      return;
    }

    const menu = this.ensureMenuEntity(player);
    const c = menu ? invOf(menu) : undefined;
    if (!menu || !c) return;

    const state = this.getState(player);
    const cur = getBakedState(this.manifest, state);

    // Verify Slot 1 state marker BEFORE scanning button slots so page transitions never look like phantom clicks
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
      if (item?.typeId === MENU_MARKER_ITEM && item.nameTag === expected) continue;

      const taken = this.lastTakenMarker.get(player.name);
      this.lastTakenMarker.delete(player.name);
      if (taken && now - taken.tick <= 2 && taken.tag !== expected) {
        this.sweepMarkerItems(player);
        this.syncContainer(menu, state, player);
        return;
      }

      this.sweepMarkerItems(player);
      const btn = cur.buttons[j];
      if (btn.special === 'close') {
        this.close(player);
        return;
      }

      if (armed) this.armedUntil.set(player.name, now + this.armTicks);
      applyBakedButton(this.manifest, state, btn);
      this.opts.onButtonClick?.(player, btn, state);
      if (!player.isValid) return;

      const still = this.menuEntities.get(player.name);
      if (still?.isValid) this.syncContainer(still, state, player);
      return;
    }

    if (cur.dynSlots?.length && now % this.dynRefreshTicks === 0) {
      this.syncContainer(menu, state, player);
    }
  }

  private sweepOrphanMenus(): void {
    const online = new Set(world.getAllPlayers().filter((p) => p.isValid).map((p) => p.name));
    const owned = new Set<string>();
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

    for (const dimId of ['overworld', 'nether', 'the_end'] as const) {
      try {
        for (const e of world.getDimension(dimId).getEntities({ type: this.entityId })) {
          if (!owned.has(e.id)) this.clearEntitySafely(e);
        }
      } catch {}
    }
  }
}
