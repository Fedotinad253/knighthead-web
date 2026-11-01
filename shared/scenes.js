// Сцены — общие для сервера (движение босса, укрытия) и браузера (рисование, столкновения богатыря).
// Координаты как в Unity-версии: X вправо, Z на север (вверх по экрану), метры.
import { WEAPONS } from './data.js';

const circle = (x, z, r, extra = {}) => ({ type: 'circle', x, z, r, ...extra });
const box = (x, z, w, d, extra = {}) => ({ type: 'box', x, z, w, d, ...extra });

// ---------------------------------------------------------------- Таверна (внутри избушки)

function tavern() {
  const obstacles = [
    box(-10.5, -3, 1.2, 7), box(0, 10.2, 3, 1), box(-10.5, 6.5, 2, 1.2), box(10.5, 3.5, 1.2, 0.6), box(11.5, 7, 2, 2),
    box(0, 5.5, 3.2, 2), circle(-9, 5, 0.45), circle(9, 5, 0.45),
  ];
  const tables = [[-4, -7], [4, -7], [0, 1.5]];
  for (const [x, z] of tables) {
    obstacles.push(circle(x, z, 0.9));
    for (let i = 0; i < 3; i++) {
      const a = (i * 120) * Math.PI / 180;
      obstacles.push(circle(x + Math.sin(a) * 1.5, z + Math.cos(a) * 1.5, 0.3, { stool: true }));
    }
  }
  const racks = WEAPONS.map((w, i) => ({ x: -4 + i * 2, z: -2.5 }));
  for (const r of racks) obstacles.push(box(r.x, r.z, 0.8, 0.8));

  const interactables = [
    { id: 'healer', kind: 'npc', x: -9, z: 5, radius: 2.2, speaker: 'Знахарка Милава', lines: [
      'Ну здравствуй, богатырь. Глаза у тебя усталые… Присядь-ка рядом, травами напою — глядишь, и сил прибавится.',
      'Отвары мои ещё настаиваются. Вернёшься живым — угощу. А не вернёшься… жалко будет такого молодца.',
      'Говорят, Кощееву смерть в игле ищут. А я скажу: всякую нечисть одолеть можно, коли знать, чем её взять.',
      'Скоро будут у меня зелья да обереги. А пока просто посиди со мной, не торопись в Навь.'] },
    { id: 'smith', kind: 'npc', x: 9, z: 5, radius: 2.2, speaker: 'Кузнец Добромир', lines: [
      'Железо любит жар да терпение. Твоё оружие скоро тоже полюбит.',
      'Кузню я только разжигаю. Приходи позже — перекую так, что сам Горыныч позавидует.',
      'Меч — для ловких, топор — для злых, булава — для упрямых. А лук… для тех, кто трусит подойти. Шучу. Почти.'] },
    ...racks.map((r, i) => ({ id: `rack${i}`, kind: 'rack', weapon: i, x: r.x, z: r.z, radius: 1.6 })),
    { id: 'map', kind: 'map', x: 0, z: 5.5, radius: 2.4, prompt: 'Склониться над картой' },
  ];

  return {
    id: 'tavern', title: 'Избушка на курьих ножках', camera: 16, background: '#0d0a08',
    bounds: { type: 'rect', minX: -12.4, maxX: 12.4, minZ: -10.4, maxZ: 10.4 },
    spawns: [[-1.5, -6], [1.5, -6]],
    obstacles, interactables, tables, racks,
    light: { ambient: 0.62, tint: 'rgba(255,170,90,0.10)' },
    lights: [
      { x: 0, z: 9, y: 1.5, color: '255,140,50', radius: 9, intensity: 0.55, flicker: true },
      { x: 11.5, z: 7, y: 2, color: '255,110,30', radius: 6, intensity: 0.5, flicker: true },
      { x: -9, z: 4, y: 2, color: '200,255,190', radius: 4, intensity: 0.25 },
      ...[-6, 0, 6].flatMap((z) => [{ x: -12.4, z, y: 2.2, color: '255,160,70', radius: 4.5, intensity: 0.4, flicker: true },
        { x: 12.4, z, y: 2.2, color: '255,160,70', radius: 4.5, intensity: 0.4, flicker: true }]),
      ...tables.map(([x, z]) => ({ x: x + 0.2, z: z + 0.1, y: 1, color: '255,190,110', radius: 3, intensity: 0.35, flicker: true })),
    ],
  };
}

// ---------------------------------------------------------------- Ночной лес — арена Лиха

/** Дерево. Деревья на поляне (hide) — старые дубы с толстым стволом: за ними прячется Лихо. */
function tree(x, z, size, hide) {
  const thickness = (hide ? 1.5 : 0.7) * size;
  const crown = hide ? 0.8 : 1;
  return {
    x, z, size, r: thickness / 2, height: 4 * size, hide,
    crownY: ((hide ? 3.4 : 4.2) + crown) * size, crownW: 2.8 * size * crown, crownH: 2.4 * size * crown,
  };
}

function forest() {
  const trees = [];
  for (let i = 0; i < 36; i++) {
    const a = i * 10 * Math.PI / 180, d = 16.2 + (i % 2) * 0.9;
    trees.push(tree(Math.sin(a) * d, Math.cos(a) * d, 1 + (i % 3) * 0.15, false));
  }
  for (const [x, z] of [[-7, 4], [6, 6], [-4, -3.5], [8, -4], [0.5, 9.5], [-10, -6], [10.5, 2], [-12, 5]])
    trees.push(tree(x, z, 0.9, true));
  const bushes = [[-8.6, 5.4], [7.3, 7.5], [-2.5, -4.7], [9.7, -5.3], [2.1, 10.4], [-11.3, -4.7], [12.1, 3.6], [-13.1, 7],
    [12.4, -8.6], [-3.2, 12.6], [-12.6, -1], [5, -1]].map(([x, z]) => ({ x, z }));

  const hidePoints = [
    ...trees.filter((t) => t.hide).map((t) => ({ x: t.x, z: t.z, behindTree: true, treeOffset: t.r * 2 * 0.15 })),
    ...bushes.map((b) => ({ x: b.x, z: b.z, behindTree: false })),
  ];

  return {
    id: 'forest', title: 'Ночной лес', camera: 17, background: '#081410',
    bounds: { type: 'circle', r: 15.3 }, bossRadius: 14.5,
    spawns: [[-1.5, -9], [1.5, -9]], bossSpawn: { x: 0, z: 6, fx: 0, fz: -1 },
    obstacles: trees.map((t) => circle(t.x, t.z, t.r, { tree: true })),
    trees, bushes, hidePoints,
    /** Примерный радиус куста на рисунке: огонь и молния жгут куст, когда его касаются. */
    bushRadius: 1.4,
    interactables: [{ id: 'exit', kind: 'exit', x: 0, z: -14.2, radius: 2.2, prompt: 'Сбежать к избушке' }],
    ground: { r: 17, color: '#2b3a21' },
    light: { ambient: 0.42, tint: 'rgba(40,70,120,0.18)' },
    lights: [[-6, -2], [5, 3], [-2, 8], [9, -8]].map(([x, z]) =>
      ({ x, z, y: 1.8, color: '150,255,130', radius: 5, intensity: 0.35, flicker: true })),
  };
}

// ---------------------------------------------------------------- Обычная арена (для Чучела-заглушки)

function arena() {
  return {
    id: 'arena', title: 'Арена', camera: 16, background: '#0f0f14',
    bounds: { type: 'circle', r: 14.6 }, bossRadius: 13,
    spawns: [[-1.5, -8], [1.5, -8]], bossSpawn: { x: 0, z: 5, fx: 0, fz: -1 },
    obstacles: [], stones: Array.from({ length: 36 }, (_, i) => i * 10),
    interactables: [{ id: 'exit', kind: 'exit', x: 0, z: -12.5, radius: 2.2, prompt: 'Сбежать к избушке' }],
    ground: { r: 15, color: '#5a7340' },
    light: { ambient: 0.85, tint: null },
    lights: [],
  };
}

// ---------------------------------------------------------------- Карта (на столе в таверне)

export const MAP = {
  camera: 22,
  min: [-20.5, -10], max: [25.5, 10],
  /** X, где начинается мир 1, 2: пока мир закрыт, избушка не заходит дальше. */
  worldBorders: [-2.8, 13.1],
  hutSpeed: 7,
  regions: [
    { x: -12, z: 0, w: 19, d: 22, color: '#5c8545' },
    { x: 6.5, z: 0, w: 14, d: 22, color: '#382642' },
    { x: 20.5, z: 0, w: 11, d: 22, color: '#c7b880' },
  ],
  river: { x: -1.5, w: 2.6 },
  bridge: { x: -1.5, z: 1.5, w: 4, d: 2 },
  stairs: { x: 13.4, z: 1.5 },
  // Узел 0 — распутье (старт), дальше — логова боссов по порядку BOSSES.
  nodes: [[-18, -1], [-14, 4], [-12, -5], [-6, 1.5], [3, 4.5], [5, -5], [10, 1.5], [17, 4.5], [19, -5], [24, 1.5]],
  edges: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [7, 8], [7, 9], [8, 9]],
  nodeRadius: 2.2,
  barriers: [
    { world: 1, x: -1.5, z: 1.5, color: '#ff6619', text: 'Огненный туман' },
    { world: 2, x: 13.6, z: 1.5, color: '#fff299', text: 'Врата Прави закрыты' },
  ],
};

export function clampOnMap(x, z, isWorldUnlocked) {
  let maxX = MAP.max[0];
  for (let i = 0; i < MAP.worldBorders.length; i++) {
    if (isWorldUnlocked(i + 1)) continue;
    maxX = Math.min(maxX, MAP.worldBorders[i] - 0.8);
    break;
  }
  return [Math.min(Math.max(x, MAP.min[0]), maxX), Math.min(Math.max(z, MAP.min[1]), MAP.max[1])];
}

/** Ближайшее логово, до которого достаёт избушка: индекс узла или -1. */
export function nodeNear(x, z) {
  let best = -1, bestDistance = Infinity;
  MAP.nodes.forEach(([nx, nz], i) => {
    const d = Math.hypot(nx - x, nz - z);
    if (d <= MAP.nodeRadius && d < bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

export const SCENES = { tavern: tavern(), forest: forest(), arena: arena() };

/**
 * Не даёт кругу (x, z, radius) зайти в препятствия и за край сцены. Возвращает исправленную точку.
 * Сцена map сюда не попадает — там бегает избушка.
 */
export function resolveCollisions(scene, x, z, radius, extra = []) {
  for (const o of [...scene.obstacles, ...extra]) {
    if (o.type === 'circle') {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + radius;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : 1;
        x = o.x + nx * min; z = o.z + nz * min;
      }
    } else {
      const hx = o.w / 2 + radius, hz = o.d / 2 + radius;
      const dx = x - o.x, dz = z - o.z;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
        if (px < pz) x = o.x + Math.sign(dx || 1) * hx; else z = o.z + Math.sign(dz || 1) * hz;
      }
    }
  }
  const b = scene.bounds;
  if (b.type === 'rect') {
    x = Math.min(Math.max(x, b.minX), b.maxX);
    z = Math.min(Math.max(z, b.minZ), b.maxZ);
  } else {
    const d = Math.hypot(x, z);
    if (d > b.r) { x *= b.r / d; z *= b.r / d; }
  }
  return [x, z];
}

/** Ближайший предмет для взаимодействия в радиусе (или null). */
export function nearestInteractable(scene, x, z) {
  let best = null, bestDistance = Infinity;
  for (const item of scene.interactables ?? []) {
    const d = Math.hypot(item.x - x, item.z - z);
    if (d <= item.radius && d < bestDistance) { best = item; bestDistance = d; }
  }
  return best;
}
