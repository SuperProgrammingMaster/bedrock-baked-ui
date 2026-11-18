// Emits the invisible, zero-collision 27-slot container entity used for zero-flicker Entity Inventory UI.

import fs from 'node:fs';
import path from 'node:path';
import { makeRgbaPng } from './png.js';

export function parseEntityId(entityId: string): { ns: string; name: string } {
  const parts = entityId.split(':');
  if (parts.length !== 2 || !/^[a-z0-9_]+$/i.test(parts[0]) || !/^[a-z0-9_]+$/i.test(parts[1])) {
    throw new Error(`Invalid entityId '${entityId}'. Expected format '<namespace>:<name>' (alphanumeric/underscore).`);
  }
  return { ns: parts[0], name: parts[1] };
}

export function writeMenuEntityFiles(bpDir: string, rpDir: string, entityId: string): void {
  const { ns, name } = parseEntityId(entityId);
  const fileStem = `${ns}_${name}`;

  // 1. Behavior Pack entity definition
  const bpEntity = {
    format_version: '1.21.40',
    'minecraft:entity': {
      description: {
        identifier: entityId,
        is_spawnable: false,
        is_summonable: true,
        is_experimental: false,
      },
      components: {
        'minecraft:type_family': {
          family: [`${ns}_${name}`, 'inanimate'],
        },
        'minecraft:health': {
          value: 9999,
          max: 9999,
        },
        'minecraft:collision_box': {
          width: 0.0,
          height: 0.0,
        },
        'minecraft:custom_hit_test': {
          hitboxes: [
            {
              width: 1.0,
              height: 1.0,
              pivot: [0, 0.5, 0],
            },
          ],
        },
        'minecraft:is_hidden_when_invisible': {},
        'minecraft:physics': {
          has_gravity: false,
          has_collision: false,
        },
        'minecraft:pushable': {
          is_pushable: false,
          is_pushable_by_piston: false,
        },
        'minecraft:knockback_resistance': {
          value: 1.0,
        },
        'minecraft:fire_immune': {},
        'minecraft:nameable': {
          allow_name_tag_renaming: false,
          always_show: false,
        },
        'minecraft:damage_sensor': {
          triggers: {
            cause: 'all',
            deals_damage: 'no',
          },
        },
        'minecraft:inventory': {
          container_type: 'container',
          inventory_size: 27,
          private: false,
          can_be_siphoned_from: false,
        },
      },
    },
  };

  const bpEntPath = path.join(bpDir, 'entities', `${fileStem}.json`);
  fs.mkdirSync(path.dirname(bpEntPath), { recursive: true });
  fs.writeFileSync(bpEntPath, JSON.stringify(bpEntity, null, 2) + '\n');

  // 2. Resource Pack invisible client entity + empty geometry + render controller + 4x4 transparent texture
  const emptyTexRel = `textures/entity/${ns}/empty`;
  const emptyTexPath = path.join(rpDir, `${emptyTexRel}.png`);
  fs.mkdirSync(path.dirname(emptyTexPath), { recursive: true });
  fs.writeFileSync(emptyTexPath, makeRgbaPng(4, 4, () => [0, 0, 0, 0]));

  const geoId = `geometry.${ns}.${name}`;
  const rcId = `controller.render.${ns}.${name}`;

  const rpEntity = {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: entityId,
        min_engine_version: '1.8.0',
        materials: { default: 'entity_alphatest' },
        textures: { default: emptyTexRel },
        geometry: { default: geoId },
        render_controllers: [rcId],
      },
    },
  };

  const rpGeo = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: geoId,
          texture_width: 16,
          texture_height: 16,
          visible_bounds_width: 1,
          visible_bounds_height: 1,
          visible_bounds_offset: [0, 0.5, 0],
        },
        bones: [{ name: 'root', pivot: [0, 0, 0] }],
      },
    ],
  };

  const rpRc = {
    format_version: '1.8.0',
    render_controllers: {
      [rcId]: {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.default' }],
        textures: ['Texture.default'],
        part_visibility: [{ '*': false }],
      },
    },
  };

  const writeJson = (p: string, data: unknown) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  };

  writeJson(path.join(rpDir, 'entity', `${fileStem}.entity.json`), rpEntity);
  writeJson(path.join(rpDir, 'models', 'entity', `${fileStem}.geo.json`), rpGeo);
  writeJson(path.join(rpDir, 'render_controllers', `${fileStem}.render_controllers.json`), rpRc);
}
