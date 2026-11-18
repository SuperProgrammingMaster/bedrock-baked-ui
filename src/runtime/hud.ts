// [EXPERIMENTAL] Bedrock Behavior Pack Runtime Controller for Transparent Baked HUD.

import { Player, system, world } from '@minecraft/server';
import type { BakedHudManifest } from '../types.js';
import { buildHudDebugPayload, packHudPayload } from './hud_sim.js';

export interface BakedHudOptions {
  /** Resolves dynamic field values (`dynId -> text`) for a player. */
  resolveValues: (player: Player) => Record<string, string>;
  /** Update interval in ticks (default: 10 = 0.5s). */
  refreshTicks?: number;
  /** Periodic full title re-arm interval in ticks (default: 6000 = 5 min). */
  rearmTicks?: number;
  /** Automatically enable HUD when players join/spawn (default: true). */
  autoEnableOnSpawn?: boolean;
  /** Optional error logger. */
  onError?: (context: string, error: unknown) => void;
}

const HUD_STAY_TICKS = 1_000_000;

/**
 * [Experimental] Streams packed telemetry strings to a baked JsonUI HUD (`ui/<ns>_hud.json`).
 * Supports both `subtitle` channel (classic) and `title` channel (1.26.65+ fallback) automatically
 * based on `manifest.channel`.
 */
export class BakedHudManager {
  readonly manifest: BakedHudManifest;
  private readonly opts: BakedHudOptions;
  private readonly refreshTicks: number;
  private readonly rearmTicks: number;
  private readonly autoEnableOnSpawn: boolean;

  private readonly enabledPlayers = new Set<string>();
  private readonly debugPlayers = new Set<string>();
  private readonly lastPayload = new Map<string, string>();
  private readonly armedTick = new Map<string, number>();
  private readonly hudGen = new Map<string, number>();

  private installed = false;
  private tickRunId: number | undefined;

  constructor(manifest: BakedHudManifest, opts: BakedHudOptions) {
    this.manifest = manifest;
    this.opts = opts;
    this.refreshTicks = Math.max(1, opts.refreshTicks ?? 10);
    this.rearmTicks = Math.max(200, opts.rearmTicks ?? 6000);
    this.autoEnableOnSpawn = opts.autoEnableOnSpawn ?? true;
  }

  isEnabled(playerName: string): boolean {
    return this.enabledPlayers.has(playerName);
  }

  enable(player: Player, forceArm = true): void {
    if (!player.isValid) return;
    this.enabledPlayers.add(player.name);
    this.hudGen.set(player.name, (this.hudGen.get(player.name) ?? 0) + 1);
    this.pushFrame(player, forceArm);
  }

  /**
   * Hides the HUD cleanly by sending the non-empty `manifest.hudOffTag` (hidden by `hud_screen.json`)
   * instead of an empty string, ensuring Bedrock overwrites its cached `#hud_title_text_string`.
   */
  disable(player: Player): void {
    this.enabledPlayers.delete(player.name);
    this.lastPayload.delete(player.name);
    this.armedTick.delete(player.name);
    this.hudGen.set(player.name, (this.hudGen.get(player.name) ?? 0) + 1);
    if (!player.isValid) return;
    try {
      player.onScreenDisplay.setTitle(this.manifest.hudOffTag, {
        fadeInDuration: 0,
        stayDuration: 1,
        fadeOutDuration: 0,
        subtitle: '',
      });
    } catch {}
  }

  toggle(player: Player): boolean {
    if (this.enabledPlayers.has(player.name)) {
      this.disable(player);
      return false;
    }
    this.enable(player, true);
    return true;
  }

  setDebug(player: Player, on: boolean): void {
    if (on) this.debugPlayers.add(player.name);
    else this.debugPlayers.delete(player.name);
    this.enable(player, true);
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    if (this.autoEnableOnSpawn) {
      world.afterEvents.playerSpawn.subscribe((ev) => {
        if (!ev.initialSpawn) return;
        const p = ev.player;
        this.enable(p, true);
        const gen = this.hudGen.get(p.name) ?? 0;
        system.runTimeout(() => {
          if (p.isValid && this.enabledPlayers.has(p.name) && this.hudGen.get(p.name) === gen) {
            this.enable(p, true);
          }
        }, 40);
      });

      system.run(() => {
        for (const p of world.getAllPlayers()) {
          if (p.isValid && !this.enabledPlayers.has(p.name)) {
            this.enable(p, true);
          }
        }
      });
    }

    world.afterEvents.playerLeave.subscribe((ev) => {
      this.enabledPlayers.delete(ev.playerName);
      this.debugPlayers.delete(ev.playerName);
      this.lastPayload.delete(ev.playerName);
      this.armedTick.delete(ev.playerName);
      this.hudGen.delete(ev.playerName);
    });

    this.tickRunId = system.runInterval(() => {
      for (const p of world.getAllPlayers()) {
        if (!p.isValid || !this.enabledPlayers.has(p.name)) continue;
        try {
          this.pushFrame(p, false);
        } catch (err) {
          try { this.opts.onError?.(`hud.tick(${p.name})`, err); } catch {}
        }
      }
    }, this.refreshTicks);
  }

  dispose(): void {
    if (this.tickRunId !== undefined) {
      try { system.clearRun(this.tickRunId); } catch {}
      this.tickRunId = undefined;
    }
    this.installed = false;
    this.enabledPlayers.clear();
    this.debugPlayers.clear();
    this.lastPayload.clear();
    this.armedTick.clear();
    this.hudGen.clear();
  }

  private computePayload(player: Player): string {
    if (this.debugPlayers.has(player.name)) {
      return buildHudDebugPayload(this.manifest);
    }
    return packHudPayload(this.opts.resolveValues(player), this.manifest);
  }

  private pushFrame(player: Player, forceArm: boolean): void {
    if (!player.isValid) return;
    const payload = this.computePayload(player);
    const prevArm = this.armedTick.get(player.name);
    const needsArm = forceArm || prevArm === undefined || system.currentTick - prevArm >= this.rearmTicks;

    if (this.manifest.channel === 'title') {
      if (!needsArm && this.lastPayload.get(player.name) === payload) return;
      try {
        player.onScreenDisplay.setTitle(`${this.manifest.hudTag}${payload}`, {
          fadeInDuration: 0,
          stayDuration: HUD_STAY_TICKS,
          fadeOutDuration: 0,
          subtitle: '',
        });
        this.armedTick.set(player.name, system.currentTick);
        this.lastPayload.set(player.name, payload);
      } catch {}
      return;
    }

    if (needsArm) {
      try {
        player.onScreenDisplay.setTitle(this.manifest.hudTag, {
          fadeInDuration: 0,
          stayDuration: HUD_STAY_TICKS,
          fadeOutDuration: 0,
          subtitle: payload,
        });
        this.armedTick.set(player.name, system.currentTick);
        this.lastPayload.set(player.name, payload);
      } catch {}
      return;
    }

    if (this.lastPayload.get(player.name) !== payload) {
      try {
        player.onScreenDisplay.updateSubtitle(payload);
        this.lastPayload.set(player.name, payload);
      } catch {}
    }
  }
}
