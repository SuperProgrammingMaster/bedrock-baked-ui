// Minimal in-memory stand-in for `@minecraft/server`, just enough to drive BakedMenuManager in Node tests.

function signal() {
  const subs = [];
  return {
    subs,
    subscribe(fn) {
      subs.push(fn);
      return fn;
    },
    unsubscribe(fn) {
      const i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    },
    fire(ev) {
      for (const fn of [...subs]) fn(ev);
      return ev;
    },
  };
}

export const EntityComponentTypes = { Inventory: 'minecraft:inventory', Health: 'minecraft:health' };
export const EntityDamageCause = { entityAttack: 'entityAttack' };

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
  }
}

export class MockContainer {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
  }
  getItem(i) {
    return this.slots[i];
  }
  setItem(i, item) {
    this.slots[i] = item;
  }
}

let nextEntityId = 1;
export const allEntities = [];

export class MockEntity {
  constructor(typeId, location) {
    this.id = String(-(nextEntityId++));
    this.typeId = typeId;
    this.location = location;
    this.isValid = true;
    this.nameTag = '';
    this.container = new MockContainer(27);
    allEntities.push(this);
  }
  getComponent(id) {
    return id === EntityComponentTypes.Inventory ? { container: this.container } : undefined;
  }
  addEffect() {}
  teleport(loc) {
    this.location = loc;
  }
  remove() {
    this.isValid = false;
    const i = allEntities.indexOf(this);
    if (i >= 0) allEntities.splice(i, 1);
  }
}

const dimension = {
  spawnEntity(typeId, location) {
    return new MockEntity(typeId, location);
  },
  getEntities({ type } = {}) {
    return allEntities.filter((e) => !type || e.typeId === type);
  },
};

export class MockPlayer {
  constructor(name) {
    this.name = name;
    this.id = `player-${name}`;
    this.typeId = 'minecraft:player';
    this.isValid = true;
    this.dimension = dimension;
    this.selectedSlotIndex = 0;
    this.container = new MockContainer(36);
  }
  getComponent(id) {
    return id === EntityComponentTypes.Inventory ? { container: this.container } : undefined;
  }
  getHeadLocation() {
    return { x: 0, y: 65.6, z: 0 };
  }
  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }
  getEntitiesFromViewDirection() {
    return [];
  }
}

export const players = [];

const queued = [];
export const system = {
  currentTick: 0,
  run(fn) {
    queued.push(fn);
    return queued.length;
  },
  runTimeout(fn) {
    queued.push(fn);
    return queued.length;
  },
  runInterval() {
    return 0;
  },
  clearRun() {},
  /** Test helper: drains every callback queued through `system.run`. */
  flush() {
    while (queued.length) queued.shift()();
  },
};

export const world = {
  afterEvents: {
    playerInventoryItemChange: signal(),
    entityHitEntity: signal(),
    playerLeave: signal(),
  },
  beforeEvents: {
    playerInteractWithEntity: signal(),
  },
  getAllPlayers() {
    return players.filter((p) => p.isValid);
  },
  getDimension() {
    return dimension;
  },
};

export class Entity {}
export class Player {}
