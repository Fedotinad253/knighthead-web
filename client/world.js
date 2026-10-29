// Рисование сцен (таверна, ночной лес, арена) и всех, кто в них: богатыри, боссы, снаряды, капканы.
// Порядок — от дальнего к ближнему (больший Z — дальше), как в 3D.
import { WEAPONS, PLAYER_COLORS, WORLDS, BOSSES } from '../shared/data.js';
import { SCENES } from '../shared/scenes.js';
import { assets } from './assets.js';
import { shade, SIN } from './view.js';
import { drawParryRing } from './vfx.js';

const NPC_ART = { healer: ['characters/Healer.png', 2.05], smith: ['characters/Smith.png', 2.15] };

export function drawWorld(game) {
  const { view } = game;
  const ctx = view.ctx;
  const scene = game.sceneData;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, view.w, view.h);

  if (scene.id === 'tavern') drawTavernFloor(view);
  else drawRoundGround(view, scene, game);

  // На земле: подсказки атак, капканы, кольца игроков, тени.
  game.vfx.drawGround(view);
  for (const h of game.liveHazards()) if (h.type === 'zone' && h.kind === 'trap') drawTrap(view, h);
  for (const p of game.players) {
    if (!p.visible) continue;
    view.groundEllipse(p.x, p.z, 0.55, 0.55, hexAlpha(PLAYER_COLORS[p.slot] ?? '#888', p.downed ? 0.25 : 0.55));
    view.groundEllipse(p.x, p.z, 0.42, 0.42, 'rgba(0,0,0,0.35)');
    if (p.anim?.parry > 0) drawParryRing(view, p.x, p.z, p.anim.parry);
  }

  const drawables = [];
  const add = (key, draw) => drawables.push({ key, draw });

  if (scene.id === 'tavern') addTavernProps(game, add);
  if (scene.id === 'forest') addForestProps(game, add);
  if (scene.id === 'arena') addArenaProps(game, add);
  for (const item of scene.interactables ?? []) if (item.kind === 'exit') add(item.z + 1, () => drawExit(view, item, game.now));

  for (const p of game.players) if (p.visible) add(p.z, () => drawPlayer(game, p));
  for (const p of game.players) if (p.dropped) add(p.dropped[1], () => drawDroppedWeapon(view, p));
  if (game.boss) {
    const b = game.boss;
    // Спрятавшееся Лихо рисуется раньше своего куста — куст его закрывает.
    const hidden = b.pose === 'Hidden' || b.pose === 'Peek';
    add(b.z + (hidden ? 0.6 : 0), () => drawBoss(game, b));
  }
  for (const h of game.liveHazards()) if (h.type === 'proj') add(h.z, () => drawOrb(view, h, game.now));
  for (const a of game.liveArrows()) add(a.z, () => drawArrow(view, a));

  drawables.sort((a, b) => b.key - a.key);
  for (const d of drawables) d.draw();

  // Свет: источники сцены, светлячки, горящий глаз Лиха.
  const lights = [...scene.lights.map((l) => ({ ...l, intensity: l.intensity }))];
  if (scene.id === 'forest') for (const l of lights) { l.x += Math.sin(game.now * 0.5 + l.z) * 1.2; l.z += Math.cos(game.now * 0.4 + l.x) * 0.8; }
  for (const p of game.players) if (p.visible) lights.push({ x: p.x, z: p.z, y: 1, radius: 3.2, intensity: 0.35 });
  if (game.boss?.eye) lights.push(game.boss.eye);
  view.lighting(scene.light.ambient, lights, scene.light.tint, game.now);

  if (game.boss?.eyeGlowAt) drawEyeGlow(view, game.boss);

  // Подписи и всплывающий текст — поверх света.
  if (scene.id === 'tavern') drawTavernLabels(game);
  for (const item of scene.interactables ?? []) if (item.kind === 'exit') view.label(item.x, item.z, 2.4, 'Бегство', '#ffbf66', 0.45);
  for (const p of game.players) {
    if (!p.visible) continue;
    if (p.slippery) view.label(p.x, p.z, 3.1, '!', `rgba(217,115,255,${0.4 + 0.6 * Math.abs(Math.sin(game.now * 9))})`, 0.9);
    if (p.downed) view.label(p.x, p.z, 1.4, 'Пал — поднимите (удерживать E)', '#ff8a80', 0.34);
  }
  for (const p of game.players) if (p.dropped) view.label(p.dropped[0], p.dropped[1], 1.3, 'Подобрать', '#d973ff', 0.36);
  if (game.boss?.finisherReady) view.label(game.boss.x, game.boss.z, 3.4, '[E] Выколоть глаз', '#ffd94d', 0.5);
  if (game.boss?.kind === 'dummy') view.label(game.boss.x, game.boss.z, 3.4, game.boss.name, '#ffe9a8', 0.4);
  game.vfx.drawTop(view);
}

// ---------------------------------------------------------------- Земля

function drawTavernFloor(view) {
  const ctx = view.ctx;
  view.groundRect(0, 0, 26, 22, '#6b4a2e');
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(1, view.s * 0.03);
  for (let x = -13; x <= 13; x += 1.1) {
    const [px, top] = view.project(x, 11);
    const [, bottom] = view.project(x, -11);
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
  }
  // Ковёр посреди зала.
  view.groundRect(0, -2.5, 12, 6.5, '#5a2622');
  view.groundRect(0, -2.5, 11, 5.5, '#7a3a2a');
  // Стены: дальняя (север) и боковые.
  view.box(0, 11, 26, 0.5, 3, '#4d3320');
  view.box(-13, 0, 0.5, 22, 3, '#4d3320');
  view.box(13, 0, 0.5, 22, 3, '#4d3320');
}

function drawRoundGround(view, scene, game) {
  const ctx = view.ctx;
  const color = scene.id === 'arena' ? (WORLDS[BOSSES[game.session?.boss]?.world ?? 0]?.ground ?? scene.ground.color) : scene.ground.color;
  view.groundEllipse(0, 0, scene.ground.r + 6, scene.ground.r + 6, shade(color, 0.55));
  view.groundEllipse(0, 0, scene.ground.r, scene.ground.r, color);
  // Пятна травы — чтобы земля не была пустой (одинаковые у всех: от координат).
  for (let i = 0; i < 70; i++) {
    const a = i * 2.399, d = Math.sqrt(i / 70) * scene.ground.r * 0.95;
    view.groundEllipse(Math.cos(a) * d, Math.sin(a) * d, 0.6 + (i % 5) * 0.25, 0.4 + (i % 3) * 0.2,
      i % 2 ? shade(color, 1.15) : shade(color, 0.85));
  }
  void ctx;
}

// ---------------------------------------------------------------- Таверна

function addTavernProps(game, add) {
  const { view } = game;
  const scene = SCENES.tavern;
  add(10.2, () => { view.box(0, 10.2, 3, 1, 1.4, '#59544d'); fire(view, 0, 9.8, 0.6, game.now); });
  add(-3, () => view.box(-10.5, -3, 1.2, 7, 1.2, '#4d3320'));
  add(-11, () => view.box(0, -11, 26, 0.5, 0.8, '#4d3320'));
  for (const o of scene.obstacles.filter((o) => o.stool)) add(o.z, () => view.cylinder(o.x, o.z, 0.3, 0.5, '#4d3320'));
  for (const [x, z] of scene.tables) add(z, () => {
    view.cylinder(x, z, 0.9, 0.9, '#73502e');
    candle(view, x + 0.2, z + 0.1, 0.9, game.now);
  });
  add(6.5, () => {
    view.box(-10.5, 6.5, 2, 1.2, 1, '#4d3320');
    view.blob(-10.9, 6.5, 1.15, 0.35, 0.35, 0.35, '#4dcc66');
    view.blob(-10.2, 6.7, 1.15, 0.3, 0.3, 0.3, '#cc4d99');
  });
  add(3.5, () => view.box(10.5, 3.5, 1.2, 0.6, 0.9, '#333338'));
  add(7, () => { view.box(11.5, 7, 2, 2, 1.6, '#4d403a'); fire(view, 11.5, 6.4, 0.5, game.now); });
  for (const [z, x] of [[-6, -12.6], [0, -12.6], [6, -12.6], [-6, 12.6], [0, 12.6], [6, 12.6]]) add(z + 0.4, () => torch(view, x, z, game.now));
  // Знахарка и кузнец — рисованные, во весь рост.
  for (const id of ['healer', 'smith']) {
    const npc = scene.interactables.find((i) => i.id === id);
    add(npc.z, () => drawSprite(view, NPC_ART[id][0], npc.x, npc.z, NPC_ART[id][1], id === 'smith'));
  }
  // Стойки с оружием.
  for (const item of scene.interactables.filter((i) => i.kind === 'rack')) add(item.z, () => {
    view.box(item.x, item.z, 0.8, 0.8, 1, '#4d3320');
    const w = WEAPONS[item.weapon];
    drawSprite(view, w.sprite, item.x, item.z - 0.1, w.height, false, 1 * 0.574 * 1.0 + 0.1);
  });
  // Стол с картой.
  add(5.5, () => {
    view.box(0, 5.5, 3.2, 2, 0.9, '#4d3320');
    const ctx = view.ctx;
    const [x0, y0] = view.project(-1.4, 6.3, 0.92), [x1, y1] = view.project(1.4, 4.7, 0.92);
    ctx.fillStyle = '#d9bf8c'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(90,60,30,0.6)'; ctx.lineWidth = view.s * 0.03;
    ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.6); ctx.bezierCurveTo(x0 + (x1 - x0) * 0.4, y0, x0 + (x1 - x0) * 0.6, y1, x1 - (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.4); ctx.stroke();
    view.box(-0.8, 5.3, 0.22, 0.22, 0.22, '#80542e', 0.92);
    candle(view, 1.3, 6.2, 0.93, game.now);
  });
}

function drawTavernLabels(game) {
  const { view } = game;
  const scene = SCENES.tavern;
  view.label(0, 5.5, 2.2, 'Карта', '#ffd980', 0.45);
  for (const item of scene.interactables.filter((i) => i.kind === 'rack')) view.label(item.x, item.z, 2.4, WEAPONS[item.weapon].name, '#fff', 0.36);
  view.label(-9, 5, 2.5, 'Знахарка Милава', '#c9f5c0', 0.38);
  view.label(9, 5, 2.6, 'Кузнец Добромир', '#ffd2a6', 0.38);
}

function candle(view, x, z, y, now) {
  view.box(x, z, 0.08, 0.08, 0.18, '#eee0c0', y);
  flame(view, x, z, y + 0.25, 0.12, now);
}

function torch(view, x, z, now) {
  view.box(x, z, 0.15, 0.15, 0.6, '#3d2815', 1.8);
  flame(view, x, z, 2.55, 0.25, now);
}

function fire(view, x, z, size, now) {
  for (let i = 0; i < 3; i++) flame(view, x + (i - 1) * size * 0.6, z, 0.5 + Math.sin(now * 9 + i) * 0.05, size, now + i);
}

function flame(view, x, z, y, size, now) {
  const ctx = view.ctx;
  const [px, py] = view.project(x, z, 0);
  const top = py - y * view.s;
  const r = size * view.s * (0.9 + Math.sin(now * 17) * 0.1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, top, 0, px, top, r * 2.2);
  g.addColorStop(0, 'rgba(255,230,150,0.95)'); g.addColorStop(0.35, 'rgba(255,140,40,0.6)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(px, top, r, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- Ночной лес

function addForestProps(game, add) {
  const { view } = game;
  const scene = SCENES.forest;
  const me = game.local;
  for (const t of scene.trees) add(t.z - 0.1, () => {
    // Дерево перед богатырём (ближе к камере) просвечивает, чтобы его было видно.
    const front = me && t.z < me.z && me.z - t.z < 7 && Math.abs(t.x - me.x) < t.crownW / 2 + 0.8;
    view.ctx.globalAlpha = front ? 0.4 : 1;
    view.cylinder(t.x, t.z, t.r, t.height, t.hide ? '#3d2c1e' : '#382819');
    view.blob(t.x, t.z, t.crownY, t.crownW, t.crownH, t.crownW, t.hide ? '#1d3a1f' : '#1a301a', 0.95);
    view.ctx.globalAlpha = 1;
  });
  for (const b of scene.bushes) add(b.z - 0.3, () => drawBush(view, b.x, b.z));
}

/** Куст в рост сложившегося пополам Лиха (~1.7 м) — три шара листвы. */
function drawBush(view, x, z) {
  const s = [1.5, 1.8, 1.5];
  const parts = [[-0.5, 0.3, -0.3, 1.1, 0.7, 1, 0.9], [0, 0.45, 0, 1.8, 1, 1.6, 1], [0.6, 0.35, 0.3, 1.2, 0.8, 1.1, 1.15]];
  // Сначала дальние шары.
  parts.sort((a, b) => b[2] - a[2]);
  for (const [ox, oy, oz, w, h, d, light] of parts)
    view.blob(x + ox * s[0], z + oz * s[2], oy * s[1], w * s[0], h * s[1], d * s[2], '#24501d', light);
}

// ---------------------------------------------------------------- Арена

function addArenaProps(game, add) {
  const { view } = game;
  for (const angle of SCENES.arena.stones) {
    const a = angle * Math.PI / 180, x = Math.sin(a) * 15.6, z = Math.cos(a) * 15.6;
    add(z, () => view.blob(x, z, 0.7, 2.6, 1.6, 1.4, '#66666b'));
  }
}

function drawExit(view, item, now) {
  const pulse = 0.5 + Math.sin(now * 3) * 0.15;
  view.groundEllipse(item.x, item.z, 1.3, 1.3, `rgba(255,190,100,${0.25 * pulse + 0.1})`, 'rgba(255,190,100,0.8)', 0.06);
}

// ---------------------------------------------------------------- Персонажи

function drawSprite(view, path, x, z, height, flip = false, lift = 0) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx;
  const [px, py] = view.project(x, z);
  const h = height * view.s, w = h * image.naturalWidth / image.naturalHeight;
  ctx.save();
  ctx.translate(px, py - lift * view.s);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(image, -w / 2, -h, w, h);
  ctx.restore();
}

function drawPlayer(game, p) {
  const { view } = game;
  const ctx = view.ctx;
  view.groundEllipse(p.x, p.z, 0.5, 0.5, 'rgba(0,0,0,0.3)');
  const rig = p.rig;
  p.animator.setWeaponIfChanged(p.dropped ? null : WEAPONS[p.weapon]);
  const base = rig.base(view, p.x, p.z, { flip: p.flip, lying: p.downed ? (p.flip ? -90 : 90) : 0 });
  const blink = p.anim?.blink > 0 && Math.floor(game.now * 5 * 2) % 2 === 1;
  const flash = game.now < (p.flashUntil ?? 0);
  rig.draw(ctx, base, {
    overlay: flash ? '#ffffff' : (blink || p.downed) ? '#000000' : null,
    overlayAlpha: flash ? 0.7 : blink ? 0.45 : p.downed ? 0.35 : 0,
  });
  if (p.anim?.stun) view.label(p.x, p.z, 2.5, '✦ ✦', '#ffb34d', 0.4);
}

function drawDroppedWeapon(view, p) {
  const w = WEAPONS[p.weapon];
  const image = assets.image(w.sprite);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx;
  const [px, py] = view.project(p.dropped[0], p.dropped[1]);
  const h = w.height * 0.8 * view.s, iw = h * image.naturalWidth / image.naturalHeight;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.PI / 2.4);
  ctx.drawImage(image, -iw / 2, -h / 2, iw, h);
  ctx.restore();
}

function drawBoss(game, b) {
  const { view } = game;
  const ctx = view.ctx;
  const flash = game.now < (b.flashUntil ?? 0);
  if (b.kind === 'likho') {
    const hiddenInBush = b.pose === 'Hidden';
    if (!hiddenInBush) view.groundEllipse(b.x, b.z, 0.9, 0.7, 'rgba(0,0,0,0.35)');
    const base = b.rig.base(view, b.x, b.z, { flip: b.flip });
    b.rig.draw(ctx, base, { overlay: flash ? '#ffffff' : null, overlayAlpha: flash ? 0.6 : 0 });
    // Горящий глаз светит в ночном лесу.
    const glow = b.eyeBlind ? 0 : b.animator.glow;
    if (glow > 0.35 && b.rig.get('eye').visible !== false) {
      const [ex, ey] = b.rig.screenPoint(base, 'eye');
      b.eye = { x: b.x, z: b.z, y: 3, radius: 2.2 + glow * 1.2, intensity: Math.min(1, glow * 0.35), color: '255,215,80' };
      b.eyeGlowAt = [ex, ey, glow];
    } else { b.eye = null; b.eyeGlowAt = null; }
  } else {
    drawDummy(view, b, flash);
  }
}

function drawEyeGlow(view, b) {
  const ctx = view.ctx;
  const [ex, ey, glow] = b.eyeGlowAt;
  const r = view.s * (0.25 + glow * 0.22);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
  g.addColorStop(0, `rgba(255,240,140,${Math.min(0.9, glow * 0.45)})`);
  g.addColorStop(1, 'rgba(255,200,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Чучело-заглушка: шест, перекладина, мешок-голова, солома. */
function drawDummy(view, b, flash) {
  const ctx = view.ctx, s = view.s;
  view.groundEllipse(b.x, b.z, 0.9, 0.7, 'rgba(0,0,0,0.35)');
  const [px, py] = view.project(b.x, b.z);
  const straw = flash ? '#ffffff' : b.phase > 1 ? '#e0a050' : '#d9bf73';
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = '#6b4a2e';
  ctx.fillRect(-0.12 * s, -2.9 * s, 0.24 * s, 2.9 * s);
  ctx.fillRect(-1.2 * s, -2.3 * s, 2.4 * s, 0.2 * s);
  ctx.fillStyle = straw;
  ctx.beginPath(); ctx.ellipse(0, -1.8 * s, 0.6 * s, 0.75 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -2.95 * s, 0.38 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2615';
  ctx.beginPath(); ctx.arc(-0.13 * s, -3 * s, 0.05 * s, 0, Math.PI * 2); ctx.arc(0.13 * s, -3 * s, 0.05 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a2615'; ctx.lineWidth = 0.04 * s;
  ctx.beginPath(); ctx.moveTo(-0.15 * s, -2.82 * s); ctx.lineTo(0.15 * s, -2.82 * s); ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- Снаряды и капканы

function drawOrb(view, h, now) {
  const ctx = view.ctx;
  view.groundEllipse(h.x, h.z, 0.3, 0.3, 'rgba(0,0,0,0.3)');
  const [px, py] = view.project(h.x, h.z, 0);
  const y = py - (h.y ?? 1.2) * view.s * 0.75;
  const r = 0.32 * view.s * (1 + Math.sin(now * 20 + h.id) * 0.06);
  const color = h.parry ? [255, 89, 199] : [255, 140, 38];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, y, 0, px, y, r * 2);
  g.addColorStop(0, `rgba(${color},0.9)`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, y, r * 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = h.parry ? '#ffb3e6' : '#ffd099';
  ctx.beginPath(); ctx.arc(px, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
}

function drawArrow(view, a) {
  const ctx = view.ctx;
  const l = Math.hypot(a.vx, a.vz) || 1;
  const [x0, y0] = view.project(a.x - a.vx / l * 0.35, a.z - a.vz / l * 0.35, 1);
  const [x1, y1] = view.project(a.x + a.vx / l * 0.35, a.z + a.vz / l * 0.35, 1);
  ctx.strokeStyle = '#f2e6b3';
  ctx.lineWidth = Math.max(2, view.s * 0.06);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

/** Капкан: тёмное железное кольцо с зубьями. */
function drawTrap(view, h) {
  view.groundEllipse(h.x, h.z, h.r, h.r, 'rgba(30,25,22,0.55)', '#4a423b', 0.08);
  const ctx = view.ctx;
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI * 2 / 10;
    const [px, py] = view.project(h.x + Math.sin(a) * h.r * 0.8, h.z + Math.cos(a) * h.r * 0.8);
    ctx.fillStyle = '#8a8178';
    ctx.beginPath();
    ctx.moveTo(px - view.s * 0.06, py); ctx.lineTo(px, py - view.s * 0.22); ctx.lineTo(px + view.s * 0.06, py);
    ctx.fill();
  }
}

function hexAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}
export { SIN };
