// Персонажи из рисованных деталей (cut-out, как в Cult of the Lamb): кости — точки вращения,
// детали — картинки на них. Координаты скелета — пиксели исходного арта, Y вверх; поворот против часовой — плюс.
// Персонаж нарисован смотрящим вправо; влево — отражается целиком.
import { assets } from './assets.js';

// ---------------------------------------------------------------- Аффинные матрицы [a, b, c, d, e, f]

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const trs = (x, y, degrees, sx, sy) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
};
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const rot = (x, y, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

// ---------------------------------------------------------------- Силуэты для вспышки и затемнения

const silhouettes = new Map();
function silhouette(image, color) {
  const key = image.src + color;
  let canvas = silhouettes.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  silhouettes.set(key, canvas);
  return canvas;
}

// ---------------------------------------------------------------- Скелет

export class Rig {
  /** nodes: [{name, parent, pos:[x,y], z, rot, scale:[sx,sy], image?, pivot?, size?}] (родители — раньше детей). */
  constructor(nodes, k) {
    this.k = k;
    this.nodes = nodes.map((n) => ({ rot: 0, scale: [1, 1], z: 0, ...n, pose: { rot: 0, dx: 0, dy: 0 }, visible: true }));
    this.byName = new Map(this.nodes.map((n) => [n.name, n]));
    for (const n of this.nodes) n.parentNode = n.parent ? this.byName.get(n.parent) : null;
    for (const n of this.nodes) n.worldZ = n.z + (n.parentNode ? n.parentNode.worldZ : 0);
    this.order = this.nodes.filter((n) => n.image).sort((a, b) => b.worldZ - a.worldZ);
  }

  get(name) { return this.byName.get(name); }
  /** Поворот кости в позе (градусы, плюс — против часовой) и сдвиг (пиксели скелета). */
  pose(name, rotation = 0, dx = 0, dy = 0) {
    const n = this.byName.get(name);
    if (n) { n.pose.rot = rotation; n.pose.dx = dx; n.pose.dy = dy; }
  }

  compute() {
    for (const n of this.nodes) {
      const local = trs(n.pos[0] + n.pose.dx, n.pos[1] + n.pose.dy, n.rot + n.pose.rot, n.scale[0], n.scale[1]);
      n.world = n.parentNode ? mul(n.parentNode.world, local) : local;
    }
  }

  /** Матрица «пиксели скелета → экран» для персонажа, стоящего в (x, z). */
  base(view, x, z, { flip = false, lying = 0, spin = 0, spinCenter = 0, squash = 1 } = {}) {
    const [px, py] = view.project(x, z);
    const S = view.s * this.k;
    let m = [flip ? -S : S, 0, 0, -S, px, py];
    if (lying) m = mul(m, trs(0, 0, lying, 1, 1));
    // Кувырок: поворот вокруг середины тела (spinCenter — высота в метрах) и сжатие по высоте.
    if (spin || squash !== 1) {
      const c = spinCenter / this.k;
      m = mul(m, mul(trs(0, c * squash, spin, 1, squash), trs(0, -c, 0, 1, 1)));
    }
    return m;
  }

  /** Где на экране точка кости (например, глаз — для свечения). */
  screenPoint(base, name, x = 0, y = 0) {
    const n = this.byName.get(name);
    return n ? apply(mul(base, n.world), x, y) : [0, 0];
  }

  draw(ctx, base, { overlay = null, overlayAlpha = 0, alpha = 1 } = {}) {
    this.compute();
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const n of this.order) {
      if (!n.visible) continue;
      const image = assets.image(n.image);
      if (!image?.complete || !image.naturalWidth) continue;
      const m = mul(mul(base, n.world), [1, 0, 0, -1, 0, 0]);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const [w, h] = n.size;
      const [pu, pv] = n.pivot;
      ctx.drawImage(image, -pu * w, -(1 - pv) * h, w, h);
      if (overlay && overlayAlpha > 0) {
        ctx.globalAlpha = alpha * overlayAlpha;
        ctx.drawImage(silhouette(image, overlay), -pu * w, -(1 - pv) * h, w, h);
        ctx.globalAlpha = alpha;
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- Богатырь

const BOGATYR_HEIGHT = 2.1;
const BOGATYR_CANVAS = [980, 1840];
// Деталь: точка вращения (доли картинки), родитель, сдвиг от камеры (+) / к камере (−), левый верхний угол в раскладке, размер исходника.
const BOGATYR_PARTS = [
  ['cape', [0.5, 0.97], null, 0.03, [179, 400], [622, 876]],
  ['leg_back', [0.4, 0.92], null, 0.015, [470, 1080], [348, 738]],
  ['leg_front', [0.5, 0.92], null, 0.01, [210, 1080], [288, 746]],
  ['torso', [0.5, 0], null, 0, [214, 380], [553, 805]],
  ['arm_back', [0.17, 0.9], 'torso', -0.01, [600, 420], [340, 644]],
  ['arm_front', [0.72, 0.91], 'torso', -0.015, [60, 430], [304, 653]],
  ['helmet', [0.5, 0.05], 'torso', -0.02, [270, 85], [439, 415]],
];
const BOGATYR_FIST = [0.54, 0.096];

export function createBogatyr() {
  const [W, H] = BOGATYR_CANVAS;
  const joints = {};
  const nodes = [];
  for (const [name, pivot, parent, z, [left, top], size] of BOGATYR_PARTS) {
    // Сустав в пикселях раскладки → координаты скелета (Y вверх, ноль — середина низа).
    const joint = [left + pivot[0] * size[0] - W / 2, H - (top + (1 - pivot[1]) * size[1])];
    joints[name] = joint;
    const parentJoint = parent ? joints[parent] : [0, 0];
    nodes.push({ name, parent, pos: [joint[0] - parentJoint[0], joint[1] - parentJoint[1]], z,
      image: `characters/bogatyr/${name}.png`, pivot, size });
  }
  const arm = BOGATYR_PARTS.find((p) => p[0] === 'arm_front');
  nodes.push({ name: 'hand', parent: 'arm_front',
    pos: [(BOGATYR_FIST[0] - arm[1][0]) * arm[5][0], (BOGATYR_FIST[1] - arm[1][1]) * arm[5][1]], z: -0.006 });
  nodes.push({ name: 'weapon', parent: 'hand', pos: [0, 0], z: 0, image: null, pivot: [0.5, 0.5], size: [1, 1] });
  return new Rig(nodes, BOGATYR_HEIGHT / H);
}

/** Анимация богатыря: шаг (поочерёдный подъём ног, как у персонажа анфас), руки, плащ, взмах при атаке. */
export class BogatyrAnimator {
  constructor(rig) {
    this.rig = rig;
    this.phase = 0;
    this.blend = 0;
  }

  setWeapon(weapon) {
    const node = this.rig.get('weapon');
    if (!weapon) { node.image = null; return; }
    const image = assets.image(weapon.sprite);
    const h = weapon.height / this.rig.k;
    const aspect = image?.naturalWidth ? image.naturalWidth / image.naturalHeight : 0.25;
    node.image = weapon.sprite;
    node.size = [h * aspect, h];
    node.pivot = weapon.grip;
    // Порядок рисования мог измениться (картинка появилась впервые).
    this.rig.order = this.rig.nodes.filter((n) => n.image).sort((a, b) => b.worldZ - a.worldZ);
  }

  update(dt, speed, now, attack = 0, roll = 0) {
    const k = this.rig.k;
    if (roll > 0) {
      // Перекат: ноги и руки поджаты к телу.
      const tuck = Math.sin(Math.min(1, roll) * Math.PI);
      this.rig.pose('leg_front', 35 * tuck, 0, 0.25 / k * tuck);
      this.rig.pose('leg_back', 25 * tuck, 0, 0.2 / k * tuck);
      this.rig.pose('arm_front', 60 * tuck);
      this.rig.pose('arm_back', 45 * tuck);
      this.rig.pose('cape', -20 * tuck);
      this.rig.pose('torso', 0);
      return;
    }
    this.blend += Math.sign((speed > 0.4 ? 1 : 0) - this.blend) * Math.min(Math.abs((speed > 0.4 ? 1 : 0) - this.blend), dt * 6);
    this.phase += Math.min(speed, 12) * dt / 0.7 * Math.PI;
    const step = Math.sin(this.phase) * this.blend;
    const lift = 0.09 / k;
    this.rig.pose('leg_front', step * 5, 0, Math.max(0, step) * lift);
    this.rig.pose('leg_back', -step * 5, 0, Math.max(0, -step) * lift);
    // Взмах передней рукой при атаке: 0 → 1 → 0 за удар.
    this.rig.pose('arm_front', -step * 9 + attack * 75);
    this.rig.pose('arm_back', step * 9);
    this.rig.pose('cape', Math.sin(this.phase - 0.8) * 4 * this.blend + Math.sin(now * 1.3) * 0.8);
    this.rig.pose('torso', attack * -6, 0, Math.abs(Math.cos(this.phase)) * (0.012 / k) * this.blend);
  }
}

// ---------------------------------------------------------------- Лихо Одноглазое

const LIKHO_HEIGHT = 3.2;
const LIKHO_K = LIKHO_HEIGHT / 1780;
const LIKHO_SIZES = {
  head: [452, 536], eye: [177, 156], eye_glow: [181, 194], eye_blind: [173, 290], torso: [431, 789],
  arm_left: [234, 728], arm_right: [428, 528], hand: [347, 422], thigh: [286, 439], shin_left: [310, 667], shin_right: [287, 611],
};

/** Скелет Лиха — тот же, что собирал ProjectBuilder в Unity: суставы без наклона, наклон «в покое» — у картинок. */
export function createLikho() {
  const nodes = [];
  const joint = (name, parent, pos, z = 0) => nodes.push({ name, parent, pos, z });
  // Картинка в суставе; возвращает, где у неё точка `to` (следующий сустав) в координатах сустава.
  const part = (file, parent, pivot, scale, rest, mirror, to = null, name = file + '@' + parent) => {
    const size = [LIKHO_SIZES[file][0] * scale, LIKHO_SIZES[file][1] * scale];
    nodes.push({ name, parent, pos: [0, 0], z: 0, rot: rest, scale: [mirror ? -1 : 1, 1],
      image: `characters/likho/${file}.png`, pivot, size });
    if (!to) return null;
    let ox = (to[0] - pivot[0]) * size[0], oy = (to[1] - pivot[1]) * size[1];
    if (mirror) ox = -ox;
    return rot(ox, oy, rest);
  };

  joint('body', null, [0, 1010]);
  for (const [side, x, z, shin, shinPivot, shinScale] of [
    ['Left', -71, 0.016, 'shin_left', [0.27, 0.925], 1], ['Right', 71, 0.01, 'shin_right', [0.34, 0.925], 1.09]]) {
    joint('hip' + side, 'body', [x, -20], z);
    const thighPivot = [0.22, 0.86];
    const axis = [(0.80 - 0.22) * 286, (0.10 - 0.86) * 439];
    const left = side === 'Left';
    const rest = Math.atan2(axis[0], -axis[1]) * 180 / Math.PI * (left ? 1 : -1);
    const kneeAt = part('thigh', 'hip' + side, thighPivot, 1, rest, left, [0.80, 0.10]);
    joint('knee' + side, 'hip' + side, kneeAt, 0.001);
    part(shin, 'knee' + side, shinPivot, shinScale, 0, false);
  }

  joint('torso', 'body', [0, 0]);
  const torsoPivot = [0.49, 0.30], torsoSize = LIKHO_SIZES.torso;
  const onTorso = (u, v) => [(u - torsoPivot[0]) * torsoSize[0], (v - torsoPivot[1]) * torsoSize[1]];
  part('torso', 'torso', torsoPivot, 1, 0, false);

  // Руки: левая (у зрителя слева) — перед туловищем, правая — за ним.
  for (const [side, file, at, shoulderPivot, wristUv, scale, rest, z, handRest] of [
    ['Left', 'arm_left', onTorso(0.18, 0.785), [0.80, 0.93], [0.17, 0.04], 0.8, 0, -0.012, 22],
    ['Right', 'arm_right', onTorso(0.93, 0.77), [0.093, 0.92], [0.92, 0.04], 0.92, -30, 0.012, -20]]) {
    joint('shoulder' + side, 'torso', at, z);
    const wristAt = part(file, 'shoulder' + side, shoulderPivot, scale, rest, false, wristUv);
    joint('wrist' + side, 'shoulder' + side, wristAt, -0.002);
    part('hand', 'wrist' + side, [0.09, 0.93], 0.8, handRest, side === 'Left');
  }

  // Голова на шее, перед туловищем; глаз — поверх нарисованного.
  joint('neck', 'torso', onTorso(0.69, 0.95), -0.01);
  const eyeAt = part('head', 'neck', [0.45, 0.30], 0.7, 0, false, [0.615, 0.68]);
  joint('eye', 'neck', eyeAt, -0.004);
  part('eye', 'eye', [0.5, 0.5], 0.55, 0, false, null, 'eyeNormal');
  part('eye_glow', 'eye', [0.5, 0.5], 0.55, 0, false, null, 'eyeGlow');
  part('eye_blind', 'eye', [0.5, 0.75], 0.55, 0, false, null, 'eyeBlind');
  return new Rig(nodes, LIKHO_K);
}

const REST = { bodyRot: 0, bodyDrop: 0, shift: 0, lean: 0, head: 0, armL: 0, armR: 0, handL: 0, handR: 0, kneel: 0, glow: 0.7 };

/** Целевая поза (из LikhoVisual.cs). Наклон вперёд — минус, руки вперёд — плюс; bodyDrop и shift — метры. */
function target(pose, t) {
  const p = { ...REST };
  let shake = 0, flail = 0, crawlWalk = 0, wobble = 0;
  const breath = Math.sin(t * 2.2);
  const pulse = Math.abs(((t * 4) % 2) - 1) * -1 + 1;
  const set = (values) => Object.assign(p, values);
  switch (pose) {
    case 'Stand': set({ lean: -8 + breath * 2, armL: 4, armR: 4 }); break;
    case 'Hidden': set({ kneel: 1.6, bodyDrop: 1.4, shift: -0.45, lean: -92, head: -20, armL: 100, armR: 110, handL: 30, handR: 30, glow: 0 }); break;
    case 'Peek': set({ kneel: 1.6, bodyDrop: 1.12, shift: -0.45, lean: -80, head: 70 + breath * 3, armL: 95, armR: 105, handL: 25, handR: 25, glow: 1.3 + pulse }); shake = 0.03; break;
    case 'HiddenTree': set({ kneel: 1.6, bodyDrop: 1.32, shift: -0.1, lean: -10, head: -30, armL: 12, armR: 6, glow: 0 }); break;
    case 'PeekTree': set({ kneel: 1.4, bodyDrop: 0.97, shift: 0.35, lean: -40, head: -10, armL: 40, armR: 30, handL: 20, handR: 20, glow: 1.3 + pulse }); shake = 0.02; break;
    case 'Retreat': set({ kneel: 0.5, bodyDrop: 0.14, lean: -65, head: 25, armL: -35, armR: -30, glow: 0.4 }); break;
    case 'Lunge': set({ lean: -45, head: 10, armL: 80, armR: 95, handL: 20, handR: 20, glow: 1.6 }); break;
    case 'Tired': set({ lean: -28 + breath * 4, head: -18, armL: 10, armR: 12, bodyDrop: 0.05 + breath * 0.03, glow: 0.5 }); break;
    case 'Roar': set({ lean: 14, head: 22, armL: -145, armR: 150, handL: -20, handR: 20, glow: 2.1 }); shake = 0.06; break;
    case 'Crawl': set({ lean: -82, kneel: 0.8, bodyDrop: 0.35, armL: 78, armR: 92, handL: 20, handR: 20, head: 55, glow: 1 }); crawlWalk = 22; break;
    case 'Rise': set({ lean: 6, head: 10, armL: 15, armR: 165, handR: 30, glow: 1.4 }); break;
    case 'Swipe': set({ lean: -32, armL: 25, armR: 70 + Math.sin(t * 14) * 55, handR: 25, glow: 1.6 }); break;
    case 'Exhausted': set({ kneel: 1, bodyDrop: 0.52, lean: -50, head: -28, armL: 20, armR: 25, glow: 0.3 }); break;
    case 'Finisher': set({ kneel: 1, bodyDrop: 0.52, lean: -30, head: 25, armL: -60, armR: 70 }); shake = 0.08; break;
    case 'Blind': set({ lean: -10 + Math.sin(t * 3) * 8, head: Math.sin(t * 2.3) * 15, armL: -28, armR: 30 }); shake = 0.02; break;
    case 'Charge': set({ lean: -50, head: 15, armL: 70, armR: 75, handL: 15, handR: 15 }); break;
    case 'Stunned': set({ lean: -15, head: Math.sin(t * 5) * 20, armL: 6, armR: 8 }); wobble = 12; break;
    case 'Flail': set({ lean: -5 }); flail = 1; shake = 0.03; break;
    case 'Dead': set({ bodyRot: -88, bodyDrop: 1.25, armL: 70, armR: 85, head: -10, glow: 0 }); break;
  }
  return { p, shake, flail, crawlWalk, wobble };
}

/** Анимация Лиха (LikhoVisual.cs): плавно принимает позу с сервера, на ходу шагает ногами. */
export class LikhoAnimator {
  constructor(rig) {
    this.rig = rig;
    this.current = { ...REST };
    this.stepPhase = 0;
    this.walk = 0;
  }

  get glow() { return this.current.glow; }

  update(dt, pose, blind, speed, now) {
    const legsWalk = pose !== 'Dead' && pose !== 'Exhausted' && pose !== 'Finisher';
    const want = legsWalk && speed > 0.5 ? 1 : 0;
    this.walk += Math.sign(want - this.walk) * Math.min(Math.abs(want - this.walk), dt * 6);
    this.stepPhase += Math.min(speed, 20) * dt / 1.1 * Math.PI;

    const rate = pose === 'Dead' ? 2.5 : 10;
    const k = 1 - Math.exp(-rate * dt);
    const { p: goal, shake, flail, crawlWalk, wobble } = target(pose, now);
    for (const key of Object.keys(REST)) this.current[key] += (goal[key] - this.current[key]) * k;
    const p = this.current, K = this.rig.k;

    const jitterX = (Math.random() - 0.5) * shake * 2 / K, jitterY = (Math.random() - 0.5) * shake * 2 / K;
    this.rig.pose('body', p.bodyRot + Math.sin(now * 9) * wobble, p.shift / K + jitterX, -p.bodyDrop / K + jitterY);
    this.rig.pose('torso', p.lean);
    this.rig.pose('neck', p.head);

    const crawl = Math.sin(now * 7) * crawlWalk;
    const spin = now * 900 * flail;
    this.rig.pose('shoulderLeft', p.armL + crawl - spin);
    this.rig.pose('shoulderRight', p.armR - crawl + spin * 1.2);
    this.rig.pose('wristLeft', p.handL);
    this.rig.pose('wristRight', p.handR);

    // Ноги: шаг на ходу и присед. Колено гнётся назад (по часовой).
    const step = Math.sin(this.stepPhase) * this.walk;
    const liftLeft = Math.max(0, Math.cos(this.stepPhase)) * this.walk;
    const liftRight = Math.max(0, -Math.cos(this.stepPhase)) * this.walk;
    this.rig.pose('hipLeft', step * 26 + p.kneel * 45);
    this.rig.pose('hipRight', -step * 26 + p.kneel * 45);
    this.rig.pose('kneeLeft', -(liftLeft * 35 + p.kneel * 90));
    this.rig.pose('kneeRight', -(liftRight * 35 + p.kneel * 90));

    // Глаз: обычный, горящий (выглядывает, нападает) или выколотый.
    this.rig.get('eyeBlind').visible = blind;
    this.rig.get('eyeGlow').visible = !blind && p.glow > 1.1;
    this.rig.get('eyeNormal').visible = !blind && p.glow <= 1.1;
  }
}
