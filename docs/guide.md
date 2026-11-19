# Bedrock Baked UI: Technical Architecture & Limits Guide

This guide explains how `bedrock-baked-ui` works under the hood, every hard limit imposed by Minecraft Bedrock's JsonUI engine, and production best practices for reliable multiplayer addons.

---

## 1. Architecture Overview

### Fullscreen Menu Pipeline (`bakeSite`)
1. **Crawl (`window.__BAKE__`)**: Headless Chrome/Edge (over raw CDP WebSocket) loads your HTML at `1056×594` CSS px (default 16:9) with `deviceScaleFactor = texScale` (default `2` → `2112×1188` PNGs). Starting from `getStateKey()`, it BFS-crawls every `[data-hit]` button via `clickHit(hitId)`.
2. **Extract**: For each state, the compiler captures:
   - The full state PNG (optionally quantized to 256-color indexed PNG in pure Node.js).
   - `[data-hit]` bounding boxes converted to percentage offsets (`xPct`, `yPct`, `wPct`, `hPct`) and deduplicated into `§h§00..§h§99`.
   - `[data-dyn]` live text regions and their nearest opaque ancestor `background-color` (encoded as mask variant tags `§9§0..§9§9`).
   - `[data-anim]` elements stepped through `phase = f / frames` (`0 <= phase < 1`) and stitched horizontally into `flip_book` spritesheets.
   - `[data-motion]` elements hidden during static state capture (preventing frozen ghosts) and then isolated on a transparent background to capture a single 32-bit RGBA PNG paired with chained native JsonUI `offset`, `size`, `alpha`, and `wait` animations.
3. **Emit JsonUI & Entity**:
   - `ui/<ns>.json` defines `inv_overlay`, `inv_window`, `inv_hitbox_btn`, `inv_exit_btn`, `flip_book` animations, and (if enabled) `browser_window` for `ActionFormData`.
   - `ui/chest_screen.json` & `ui/pocket_containers.json` inject `<ns>.inv_overlay` and hide vanilla chest UI whenever `$container_title == invTitleTag`.
   - `ui/server_form.json` routes `ActionFormData` titles containing `routerTag` to `<ns>.browser_window`.
   - BP `entities/<ns>_<name>.json` + RP client entity/geo/render_controller provide an invisible, zero-collision 27-slot container entity.

### Zero-Flicker Click Loop (`BakedMenuManager`)
- When a player holds the configured trigger item (or `menu.open(player)` is called), an invisible 27-slot entity spawns slightly in front of the player's view (`spotInFront`).
- Right-clicking (interacting) opens its chest screen, which `chest_screen.json` / `pocket_containers.json` immediately replaces with your baked fullscreen UI.
- Clicking a button triggers `button.container_auto_place`, moving that slot's hidden `minecraft:paper` marker item into the player's inventory.
- On the next tick, `BakedMenuManager`:
  1. Verifies Slot 1 (`§s§XX`) first so state transitions never register as phantom clicks.
  2. Detects the moved button slot, sweeps the marker item (re-reading slots in `playerInventoryItemChange` so rewards granted on the same click are never erased), advances `state.bakedKey`, fires `onButtonClick`, and updates container slots **in place** with zero flicker.
- **Multiplayer ownership guard:** each menu entity belongs to exactly one player. `world.beforeEvents.playerInteractWithEntity` cancels any right-click on a menu entity by someone other than its owner (and on orphaned menu entities), so a nearby player can never open or drive your menu. Use `onForeignInteract(player, ownerName)` to show feedback when this happens.
- If a living enemy/mob enters the player's crosshair, `BakedMenuManager` automatically parks the invisible menu entity behind the player (`pvpDodge: true`) and forwards accidental swings via `entityHitEntity`.

---

## 2. Hard Limits & Design Rules

### Slot Budget (27-Slot Chest)
- `slot 0`: Reserved empty (prevents client first-slot selection artifacts).
- `slot 1`: Active state screenshot tag (`§s§00..§s§99`).
- `slot 2..26` (**25 slots**): Shared between current page buttons (`[data-hit]`) and globally unique `[data-dyn]` placements:

```
maxButtonsPerPage = 25 - (number of globally unique [data-dyn] (dynId, x, y, w, h) tuples)
```

**Tip**: Keep `[data-dyn]` boxes at identical pixel coordinates across pages (e.g., a persistent top wallet bar and bottom status dock). Matching coordinates share a single chest slot globally.

### State Explosion Prevention (`MAX_STATES`)
- Hard tag ceiling: **100 states** (`§s§00..§s§99`), default `maxStates: 64`.
- **Keep `getStateKey()` additive, not multiplicative.**
  - Bad: `tab + '_' + itemA + '_' + itemB + '_' + soundOn` → explodes combinatorially.
  - Good: Only encode the visible page/tab (e.g., `en_shop_p0`, `en_shop_p1`) in `getStateKey()`, and display the currently selected card, price, or toggle state via a `[data-dyn]` line managed on the server.
- For bilingual/multilingual menus, separate state keys by language prefix (`en_home`, `ko_home`) instead of cramming two languages onto one image.

### Dynamic Text (`[data-dyn]`) Rules
1. Always give `[data-dyn]` (or its immediate parent) an **opaque solid `background-color`** (`alpha > 0.85`, no CSS gradient). At runtime, JsonUI draws a tinted `white_fill` patch over the baked placeholder before rendering `#hover_text`.
2. In your HTML, hide placeholder text when `window.__BAKE_HEADLESS__` is true (`el.style.color = 'transparent'`) so placeholder glyphs never bleed around the mask edges.
3. Make `[data-dyn]` containers at least **5.5% of viewport height** (~33px at 594px height) and keep `data-dyn-scale <= 1.0` so smooth fonts don't clip vertically.
4. Keep formatted text within Bedrock's **255-character** `ItemStack.nameTag` limit and use `fitText(text, maxUnits)` for CJK-aware truncation.

### Native 60fps Motion Animations (`[data-motion]`)
- Use `[data-motion="<id>"]` in either Menus or HUDs whenever an icon, emblem, card, aura, or slider moves, breathes, glows, or enters smoothly. Unlike `flip_book`, it stores only **one transparent RGBA PNG** per unique `data-motion-key` and lets Bedrock's native UI engine interpolate at 60fps with zero 2800px width cap and zero chest-slot cost.
- Composable effects via `data-motion-type`:
  - **Looping**: `float` / `bob` (`offset` vertical), `slide-x` / `sway` (`offset` horizontal), `slide-y` (`offset` vertical), `pulse` / `breathe` (`size`), `glow` / `fade` (`alpha`)
  - **One-Shot Entrance**: `enter-up`, `enter-down`, `enter-left`, `enter-right`, `enter-fade`, `enter-pop` (delayed entrances hold their starting `from` pose during `data-motion-delay` so there is zero initial flash!)
  - Combine freely with `+`, e.g. `data-motion-type="enter-up+enter-fade"` or `data-motion-type="float+pulse+glow"`.
- **Shadows & Glow Padding**: Add `data-motion-pad="12"` (CSS px) when an element uses `box-shadow` or SVG `drop-shadow` so outer glow pixels are included inside the transparent PNG.
- **Live Browser Preview**: `baked-ui dev` simulates `[data-motion]` via CSS `@keyframes` right in your browser (`Motion: ON/OFF` toggle).

### Real CSS Button Hover/Press (`data-hit-fx="1"`) & Custom Sounds (`data-sound`)
- Add `data-hit-fx="1"` to any `[data-hit]` button to bake its real CSS `:hover` and `:active` appearance using CDP `CSS.forcePseudoState`. If `:active` pixels match `:hover`, the texture is deduplicated automatically.
- Add `data-sound="random.orb" data-sound-pitch="1.25" data-sound-volume="0.8"` to play distinct per-button Bedrock sounds on click.

### Real-Time Progress Bars (`[data-bar]`)
- Mark the **filled bar element** inside its track with `data-bar="hp" data-bar-dir="left"` (`left`, `right`, `up`, `down`).
- During bake, `[data-bar]` is hidden for the static track background and isolated into a single transparent RGBA PNG (`bar_<key>.png`).
- At runtime, pass `resolveBarValues(player, state) => ({ hp: 75 })` (`0..100`) to `BakedMenuManager`. Each unique `[data-bar]` placement uses 1 slot from the shared 25-slot budget (`buttons + dyn + bar <= 25`) and renders via 20 clean `clips_children: true` percentage panels (`5%` increments, zero gradient squishing).

### Flipbook Animations (`[data-anim]`)
- Horizontal sheet width is capped at `maxSheetWidth` (default `2800px`). If `w * texScale * frames > 2800`, frames are automatically downscaled.
- `frame 0` and `frame 1` must not be pixel-identical (enforced during bake).
- Use periodic math (`Math.sin(phase * Math.PI * 2)`, `Math.cos(...)`) for seamless loops, and scale `<canvas>` backing stores by `window.devicePixelRatio`.

### Free Text Input / Scrolling
- Entity Inventory UI detects discrete slot clicks; it cannot host native `<input>`, sliders, or smooth scrollbars.
- Use pagination buttons (`page_p0` / `page_p1`) for long lists, and use chat commands or `@minecraft/server-ui` `ModalFormData` whenever free-text input is needed.

---

## 3. Experimental Transparent HUD (`bake-hud`)

> **Status: Experimental.** Bedrock client updates (`1.26.65+`) have exhibited quirks where `#hud_subtitle_text_string` can arrive empty on some builds while `#hud_title_text_string` remains reliable.

### Transport Channels (`hud.channel`)
- **`subtitle` (default)**: Server arms HUD via `setTitle(hudTag, { subtitle: packed })` and streams diffs via `updateSubtitle(packed)`.
- **`title`**: Server sends `setTitle(hudTag + packed, ...)` and `bakeHud` automatically offsets JsonUI `('%.Ns' * #hud_title_text_string)` slices past `Buffer.byteLength(hudTag, 'utf8')`. Try `--channel title` if your target Bedrock build blanks out subtitle labels.

### Turning HUD Off Cleanly (`hudOffTag`)
- Never call `setTitle('')` to hide a baked HUD, because Bedrock retains the previous `#hud_title_text_string` in its global UI binding cache.
- `BakedHudManager.disable(player)` always sends the non-empty `manifest.hudOffTag` (e.g. `my_ui.off`), which `hud_screen.json` explicitly hides alongside `hudTag`.

### Byte-Aligned Slicing Rules
- JsonUI's `('%.Ns' * #str)` counts **UTF-8 bytes**, not characters.
- Every fixed `[data-hud-dyn]` field MUST contain single-byte ASCII (`0x20..0x7E`, no `§` codes). `sliceAsciiField()` enforces this automatically.
- Place CJK text, emojis, and `§` color codes only in the single optional `[data-dyn-tail="1"]` slot at the end of the payload.
- Use `hud.setDebug(player, true)` to fill fixed slots with `AAAA…`, `BBBB…`, `CCCC…` and the tail with `§aTAIL OK` for instant client vs. server diagnosis.
