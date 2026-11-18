# Aetherium Guild Codex (Showcase Example)

A self-contained, high-craft Minecraft Bedrock menu built with **`bedrock-baked-ui`**:

- **8 additive states** (`4` pages x `2` languages `en_*` / `ko_*`)
- **4 shared `[data-dyn]` live slots** (`gold`, `gems`, `status_primary`, `status_secondary`), leaving up to **21 buttons per page**
- **2 crisp 2x HiDPI `flip_book` Canvas animations** (`portal_core` 10 frames & `forge_flame` 8 frames, both under `2800px` sheet width with zero downscaling)
- **Custom multi-layered inline SVG emblems** for 4 classes, 6 shop relics, 3 bounty quests, and settings tiles
- **Complete Behavior Pack script** ([packs/bp/src/main.ts](packs/bp/src/main.ts)) wired to `BakedMenuManager`

## Run Locally

From the repository root (`bedrock-baked-ui`):

```bash
# 1. Preview in browser (press Shift+I to toggle hitbox/slot budget inspector)
node dist/cli.js dev --config examples/guild-codex

# 2. Bake HTML -> Bedrock RP JsonUI + BP manifest & invisible menu entity
node dist/cli.js bake --config examples/guild-codex

# 3. Validate all Bedrock limits (slots <= 25, states <= 64, flip_book <= 2800px)
node dist/cli.js validate --config examples/guild-codex
```
