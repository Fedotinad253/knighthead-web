// Рисунки поляны Бабы-Яги, самой Яги, избушки и атак (assets/yaga/), общие помощники для плоских рисунков.
// Размеры: Яга около 2 м, избушка с ногами около 8 м — в 4 раза выше.
import { SCENES } from '../shared/scenes.js';
import { SIN } from './view.js';
import { assets } from './assets.js';

const LEG_HEIGHT = 3.2, HUT_WIDTH = 6.4;

/** Рисунок высотой height м, стоит на земле в точке (x, z). */
function drawStanding(view, path, x, z, height, flip = false, lift = 0) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx;
  const [px, py] = view.project(x, z, lift);
  const h = height * view.s, w = h * image.naturalWidth / image.naturalHeight;
  ctx.save();
  ctx.translate(px, py);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(image, -w / 2, -h, w, h);
  ctx.restore();
}

/** Рисунок шириной width м с центром в экранной точке (px, py). */
export function drawFlat(view, path, px, py, width, angle = 0, flip = false) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx, w = width * view.s, h = w * image.naturalHeight / image.naturalWidth;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Звёзды над оглушённым. */
export function drawStars(view, x, z, y, now) {
  const [px, py] = view.project(x, z, y);
  drawFlat(view, 'likho/fx_stars.png', px, py, 1.4, Math.sin(now * 3) * 0.15);
}

const baked = new Map();
/** Сколько пикселей на метр в заранее нарисованной земле. */
const GROUND_DENSITY = 40;

/**
 * Земля из повторяющегося рисунка в круге радиуса r; один повтор — meters метров. False, если рисунок ещё не загружен.
 * Собирать её из плитки каждый кадр дорого, поэтому круг рисуется один раз, потом только копируется.
 */
export function drawGroundTile(view, path, r, meters) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return false;
  let canvas = baked.get(path);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = Math.ceil(r * 2 * GROUND_DENSITY);
    canvas.height = Math.ceil(r * 2 * SIN * GROUND_DENSITY);
    const bake = canvas.getContext('2d');
    bake.beginPath();
    bake.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2);
    bake.clip();
    const tileW = meters * GROUND_DENSITY, tileH = tileW * SIN;
    for (let x = 0; x < canvas.width; x += tileW) for (let y = 0; y < canvas.height; y += tileH) bake.drawImage(image, x, y, tileW, tileH);
    baked.set(path, canvas);
  }
  const [px, py] = view.project(0, 0);
  const w = r * 2 * view.s, h = r * 2 * SIN * view.s;
  view.ctx.drawImage(canvas, px - w / 2, py - h / 2, w, h);
  return true;
}

/** Забор из костей с черепами, ворота и печь. Пока босса нет (выбор снаряжения), избушка сидит на своём месте. */
export function drawClearingProps(game, add) {
  const { view } = game;
  const { stove, gate, hutHome } = SCENES.clearing;
  const boss = game.boss;
  for (let i = 0; i < 28; i++) {
    const a = i * Math.PI * 2 / 28, x = Math.sin(a) * 15.5, z = Math.cos(a) * 15.5;
    if (Math.hypot(x - gate.x, z - gate.z) < 2.5) continue;
    add(z, () => {
      drawStanding(view, 'yaga/fence.png', x, z, 2.1, i % 2 === 0);
      if (i % 4 === 0) drawStanding(view, 'yaga/skull_lit.png', x, z - 0.1, 2.2);
    });
  }
  add(stove.z, () => drawStanding(view, boss?.stoveLit ? 'yaga/stove_fire.png' : 'yaga/stove.png', stove.x, stove.z, 3.6));
  add(gate.z, () => drawStanding(view, boss?.gateBite ? 'yaga/gate_bite.png' : 'yaga/gate_closed.png', gate.x, gate.z, 3.4));
  if (!boss) add(hutHome.z, () => drawHut(game, { x: hutHome.x, z: hutHome.z, seated: true }));
}

/** Часть ноги от точки a до точки b: верх рисунка в a, низ в b. */
function drawLimb(view, path, ax, ay, bx, by, width) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx, length = Math.hypot(bx - ax, by - ay), w = width * view.s;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(by - ay, bx - ax) - Math.PI / 2);
  ctx.drawImage(image, -w / 2, 0, w, length);
  ctx.restore();
}

/** Куриная нога. phase — шаг, height — на какой высоте стоит дом. */
function drawLeg(view, x, z, side, phase, height = LEG_HEIGHT) {
  const footX = x + side * 1.5 + Math.sin(phase) * 0.7, lift = Math.max(0, Math.cos(phase)) * 0.5;
  const [fx, fy] = view.project(footX, z, lift + 0.5);
  const [kx, ky] = view.project(x + side * 2, z, height * 0.56);
  const [hx, hy] = view.project(x + side * 1.3, z, height + 0.4);
  drawLimb(view, 'yaga/leg_shin.png', kx, ky, fx, fy, 1.1);
  drawLimb(view, 'yaga/leg_thigh.png', hx, hy, kx, ky, 2);
  drawStanding(view, 'yaga/leg_foot.png', footX, z, 1.5, side < 0, lift);
}

/** Насколько избушка поднялась на ногах: 0 — сидит, 1 — стоит. Встаёт и садится не мгновенно. */
let hutLift = 0, hutLiftAt = 0;

/** Избушка. Сидит с ногами под собой, встаёт на анимированные ноги, падает, отворачивается. */
export function drawHut(game, hut) {
  const { view } = game, ctx = view.ctx, { x, z } = hut;
  // Если за избушкой стоит богатырь или Яга на земле, избушка становится прозрачной.
  const covers = (e) => e && z < e.z && e.z - z < 9 && Math.abs(x - e.x) < HUT_WIDTH / 2 + 0.6;
  const inFront = !hut.onMap && (covers(game.local) || (game.boss && !game.boss.onRoof && covers(game.boss)));
  ctx.save();
  ctx.globalAlpha = inFront ? 0.5 : 1;
  view.groundEllipse(x, z, 3.6, 2.4, 'rgba(0,0,0,0.3)');
  const liftStep = Math.max(0, game.now - hutLiftAt) * 1.5;
  hutLiftAt = game.now;
  hutLift = hut.seated || hut.fallen ? Math.max(0, hutLift - liftStep) : Math.min(1, hutLift + liftStep);
  const open = game.boss?.stoveLit || hut.doorOpen;
  if (hut.fallen) drawStanding(view, 'yaga/hut_fallen.png', x, z, 5);
  else if (hut.seated && hutLift <= 0) drawStanding(view, open ? 'yaga/hut_door_open.png' : 'yaga/hut_idle.png', x, z, open ? 4.4 : 6.2);
  else {
    const phase = hut.moving ? game.now * (hut.charging ? 16 : 7) : 0, height = LEG_HEIGHT * hutLift;
    drawLeg(view, x, z - 1, -1, phase, height);
    drawLeg(view, x, z - 1, 1, phase + Math.PI, height);
    drawStanding(view, hut.turned ? 'yaga/hut_back.png' : 'yaga/hut_front.png', x, z - 1, 4.6, false, height);
  }
  ctx.restore();
}

/** Яга в ступе: из рисунков. В полёте покачивается, на крыше сидит над избушкой, сбитая лежит. */
export function drawYaga(game, b) {
  if (b.hidden) return;
  const { view } = game, ctx = view.ctx, s = view.s;
  const flash = game.now < (b.flashUntil ?? 0);
  // Высота меняется плавно: на крышу взлетает, а не прыгает.
  const wantY = b.onRoof ? LEG_HEIGHT + 3.4 : b.airborne ? 2.4 + Math.sin(game.now * 3) * 0.2 : 0;
  const y = b.flyY = (b.flyY ?? wantY) + (wantY - (b.flyY ?? wantY)) * 0.14;
  if (!b.onRoof) view.groundEllipse(b.x, b.z, 0.8, 0.6, 'rgba(0,0,0,0.35)');
  const flip = b.flip ?? b.fx < 0;
  const down = b.pose === 'Stunned' || b.pose === 'Exhausted' || b.pose === 'Dead';
  const [px, py] = view.project(b.x, b.z, down ? 0.5 : y);
  const part = (path, ox, oy, height) => {
    const image = assets.image(path);
    if (!image?.naturalWidth) return;
    const h = height * s, w = h * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, ox * s - w / 2, -oy * s - h, w, h);
  };
  ctx.save();
  if (flash) ctx.globalAlpha = 0.55;
  ctx.translate(px, py);
  if (flip) ctx.scale(-1, 1);
  if (down) ctx.rotate(Math.PI / 2);
  else if (b.pose === 'Dive') ctx.rotate(0.5);
  else if (b.pose === 'Stuck') ctx.rotate(0.25);
  // Рука и помело сзади, потом тело в ступе, голова сверху.
  part('yaga/arm_back.png', 0.45, 0.85, 1);
  ctx.save();
  ctx.translate(s * 0.65, -s * 0.2);
  ctx.rotate(-0.35);
  part('yaga/broom.png', 0, -0.6, 2.2);
  ctx.restore();
  part('yaga/torso.png', 0, 0.8, 1);
  part('yaga/stupa.png', 0, 0, 1.25);
  part('yaga/arm_front.png', 0.4, 0.85, 0.95);
  part('yaga/head.png', 0.1, 1.55, 0.85);
  ctx.restore();
  if (b.pose === 'Stuck' || b.pose === 'Stunned' || b.pose === 'Tired') drawStars(view, b.x, b.z, y + 2.5, game.now);
}

const THROWN = { throw_clod: ['likho/throw_clod.png', 1], throw_stone: ['likho/throw_stone.png', 0.95], throw_bone: ['likho/throw_bone.png', 1.25], bone: ['yaga/bone.png', 1.2], peck: ['yaga/leg_foot.png', 1.3] };
/**
 * Всадники из частей: туловище коня, задние и передние ноги, сам всадник. Части на общем холсте, точки — в пикселях холста:
 * back и front — плечи ног, waist — пояс всадника, hand — кисть, где держит меч.
 */
const RIDERS = {
  rider_white: { name: 'white', w: 335, h: 270, back: [143, 170], front: [242, 175], waist: [195, 120], hand: [218, 103] },
  rider_red: { name: 'red', w: 320, h: 247, back: [143, 148], front: [225, 153], waist: [178, 100], hand: [212, 73] },
  rider_black: { name: 'black', w: 310, h: 265, back: [140, 170], front: [220, 177], waist: [172, 123], hand: [202, 110] },
};

/** Скачет: ноги ходят, тело качается. Рядом с богатырём заносит меч и рубит. */
function drawRider(view, h, now, me) {
  const art = RIDERS[h.look], ctx = view.ctx;
  const image = (part) => assets.image(`yaga/rider_${art.name}_${part}.png`);
  const scale = 3.2 / 270 * view.s; // все трое с одного листа, масштаб один
  const stride = now * 15 + h.id;
  view.groundEllipse(h.x, h.z, 1.3, 0.8, 'rgba(0,0,0,0.35)');
  const [px, py] = view.project(h.x, h.z);
  // Чем ближе богатырь, тем дальше прошёл взмах: 0 — меч занесён, 1 — удар вниз.
  const distance = me ? Math.hypot(me.x - h.x, me.z - h.z) : 99;
  const swing = Math.min(1, Math.max(0, 1 - (distance - 1.5) / 3.5));
  ctx.save();
  ctx.translate(px, py - Math.abs(Math.sin(stride)) * 0.14 * view.s);
  if (h.vx < 0) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.translate(-art.w / 2, -art.h);
  ctx.translate(art.w / 2, art.h * 0.6);
  ctx.rotate(Math.sin(stride) * 0.035);
  ctx.translate(-art.w / 2, -art.h * 0.6);
  const part = (name, pivot, angle) => {
    const img = image(name);
    if (!img?.naturalWidth) return;
    ctx.save();
    ctx.translate(pivot[0], pivot[1]);
    ctx.rotate(angle);
    ctx.translate(-pivot[0], -pivot[1]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  part('back', art.back, Math.sin(stride) * 0.42);
  part('front', art.front, Math.sin(stride + 2.2) * 0.42);
  const body = image('body');
  if (body?.naturalWidth) ctx.drawImage(body, 0, 0);
  // Всадник наклоняется в удар, меч у него в кисти.
  const lean = 0.05 + swing * 0.3 + Math.sin(stride) * 0.03;
  ctx.save();
  ctx.translate(art.waist[0], art.waist[1]);
  ctx.rotate(lean);
  ctx.translate(-art.waist[0], -art.waist[1]);
  const sword = assets.image('weapons/Sword.png');
  if (sword?.naturalWidth) {
    const length = 120, width = length * sword.naturalWidth / sword.naturalHeight;
    ctx.save();
    ctx.translate(art.hand[0], art.hand[1]);
    // Лезвие вверх-назад → вперёд-вниз. На рисунке рукоять сверху, лезвие вниз.
    ctx.rotate(-Math.PI * 0.95 + swing * Math.PI * 0.75);
    ctx.drawImage(sword, -width / 2, -length * 0.1, width, length);
    ctx.restore();
  }
  const rider = image('rider');
  if (rider?.naturalWidth) ctx.drawImage(rider, 0, 0);
  ctx.restore();
  ctx.restore();
}

/** Крыло белого всадника: летит сбоку от него и ранит. Перья раскрываются наружу от коня. */
function drawWing(view, h, now) {
  const ctx = view.ctx, s = view.s, l = Math.hypot(h.vx, h.vz) || 1;
  const side = h.look === 'wing_left' ? 1 : -1;
  const nx = -h.vz / l * side, nz = h.vx / l * side;
  view.groundEllipse(h.x, h.z, h.r, h.r * 0.7, 'rgba(0,0,0,0.25)');
  const [bx, by] = view.project(h.x - nx * 0.9, h.z - nz * 0.9, 1.8);
  const [tx, ty] = view.project(h.x + nx * 1, h.z + nz * 1, 1.8);
  const angle = Math.atan2(ty - by, tx - bx), length = Math.hypot(tx - bx, ty - by);
  const flap = Math.sin(now * 12 + h.id) * 0.3;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(angle);
  ctx.fillStyle = '#e8e4d6';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(1.5, s * 0.04);
  // Перья веером, самое длинное впереди.
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.22 + flap * 0.5, len = Math.max(length, s * 1.9) * (1 - Math.abs(i - 1) * 0.12);
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.55, -s * 0.36, len, 0);
    ctx.quadraticCurveTo(len * 0.55, s * 0.36, 0, 0);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Брошенное и пролетающее: комья, камни, кости, всадники, лопата, гуси. */
export function drawWideProjectile(view, h, now, me) {
  const ctx = view.ctx, s = view.s;
  const flip = h.vx < 0;
  if (RIDERS[h.look]) drawRider(view, h, now, me);
  else if (h.look === 'wing_left' || h.look === 'wing_right') drawWing(view, h, now);
  else if (h.look === 'shovel') {
    const l = Math.hypot(h.vx, h.vz) || 1, dx = h.vx / l, dz = h.vz / l;
    const [x0, y0] = view.project(h.x, h.z, 0.6);
    const [x1, y1] = view.project(h.x + dx, h.z + dz, 0.6);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    view.groundEllipse(h.x, h.z, 0.9, 0.6, 'rgba(0,0,0,0.35)');
    const [cx, cy] = view.project(h.x - dx * 1.5, h.z - dz * 1.5, 0.6);
    drawFlat(view, 'yaga/shovel.png', cx, cy, 1.5, angle - Math.PI / 2);
  } else if (h.look === 'goose') {
    view.groundEllipse(h.x, h.z, 0.5, 0.3, 'rgba(0,0,0,0.3)');
    const [px, py] = view.project(h.x, h.z, 1.7);
    drawFlat(view, Math.sin(now * 16 + h.id) > 0 ? 'yaga/goose1.png' : 'yaga/goose2.png', px, py, 1.7, 0, flip);
  } else {
    const [path, width] = THROWN[h.look] ?? THROWN.bone;
    const [px, py] = view.project(h.x, h.z, (h.y ?? 1) * 0.75);
    view.groundEllipse(h.x, h.z, 0.3, 0.22, 'rgba(0,0,0,0.3)');
    drawFlat(view, path, px, py, width, now * 7 + h.id);
  }
}

/** Огонь на земле. */
export function drawFireZone(view, h, now) {
  const flicker = 0.85 + Math.sin(now * 13 + h.id) * 0.12;
  view.groundEllipse(h.x, h.z, h.r, h.r, `rgba(255,110,30,${0.4 * flicker})`);
  const [px, py] = view.project(h.x, h.z, 0.4);
  drawFlat(view, 'yaga/fx_fire.png', px, py, h.r * 2.3 * flicker, 0, h.id % 2 === 0);
}
