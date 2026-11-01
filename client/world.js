// Рисование сцен (таверна, ночной лес, арена) и всех, кто в них: богатыри, боссы, снаряды, капканы.
// Порядок — от дальнего к ближнему (больший Z — дальше), как в 3D.
import { WEAPONS, WORLDS, BOSSES } from '../shared/data.js';
import { SCENES } from '../shared/scenes.js';
import { assets } from './assets.js';
import { shade, SIN, ORB_LIFT, ORB_RADIUS } from './view.js';
import { drawClearingProps, drawYaga, drawHut, drawWideProjectile, drawFireZone, drawFlat, drawStars, drawGroundTile } from './yagaview.js';
import { bogatyrPose } from './rig.js';
import { drawParryRing } from './vfx.js';
import { keyName } from './input.js';

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
  const effects = game.latest?.effects ?? [];
  for (const e of effects) drawEffect(view, e, game.now);
  for (const h of game.liveHazards()) {
    if (h.type !== 'zone') continue;
    if (h.kind === 'trap' && trapVisible(game, h)) drawTrap(view, h);
    else if (h.kind === 'fire') drawFireZone(view, h, game.now);
  }
  for (const p of game.players) {
    if (!p.visible) continue;
    if (p.anim?.parry > 0) drawParryRing(view, p.x, p.z, p.anim.parry);
  }

  const drawables = [];
  const add = (key, draw) => drawables.push({ key, draw });

  if (scene.id === 'tavern') addTavernProps(game, add);
  if (scene.id === 'forest') addForestProps(game, add);
  if (scene.id === 'arena') addArenaProps(game, add);
  if (scene.id === 'clearing') drawClearingProps(game, add);
  const exits = game.session?.firstYaga ? [] : (scene.interactables ?? []).filter((item) => item.kind === 'exit');
  for (const item of exits) add(item.z + 1, () => drawExit(view, item, game.now));

  for (const p of game.players) if (p.visible) add(p.z, () => drawPlayer(game, p));
  // Морок: полупрозрачный двойник того, кто его наслал.
  const decoy = game.latest?.decoy, caster = decoy && game.players.find((p) => p.id === decoy.owner);
  if (caster) add(decoy.z, () => {
    view.ctx.globalAlpha = Math.min(1, decoy.left / 0.6) * (0.5 + Math.sin(game.now * 6) * 0.1);
    drawPlayer(game, { ...caster, x: decoy.x, z: decoy.z, anim: {}, flashUntil: 0 });
    view.ctx.globalAlpha = 1;
  });
  for (const p of game.players) if (p.dropped) add(p.dropped[1], () => drawDroppedWeapon(view, p));
  if (game.boss) {
    const b = game.boss;
    // Спрятавшееся Лихо рисуется раньше своего куста — куст его закрывает.
    const hidden = b.pose === 'Hidden' || b.pose === 'Peek';
    if (b.hut) add(b.hut.z, () => drawHut(game, b.hut));
    // Яга на крыше рисуется поверх избушки.
    add(b.onRoof ? b.hut.z - 0.5 : b.z + (hidden ? 0.6 : 0), () => (b.kind === 'yaga' ? drawYaga(game, b) : drawBoss(game, b)));
  }
  for (const h of game.liveHazards()) if (h.type === 'proj') add(h.z, () => (h.wide || h.look ? drawWideProjectile(view, h, game.now, game.local) : drawOrb(view, h, game.now)));
  for (const a of game.liveArrows()) add(a.z, () => drawArrow(view, a));

  drawables.sort((a, b) => b.key - a.key);
  for (const d of drawables) d.draw();

  // Свет: источники сцены, светлячки, горящий глаз Лиха.
  const lights = [...scene.lights.map((l) => ({ ...l, intensity: l.intensity }))];
  if (scene.id === 'forest') for (const l of lights) { l.x += Math.sin(game.now * 0.5 + l.z) * 1.2; l.z += Math.cos(game.now * 0.4 + l.x) * 0.8; }
  for (const p of game.players) if (p.visible) lights.push({ x: p.x, z: p.z, y: 1, radius: 3.2, intensity: 0.35 });
  if (game.boss?.eye) lights.push(game.boss.eye);
  for (const e of effects) if (e.kind === 'coals') lights.push({ x: e.x, z: e.z, y: 0.6, radius: e.r + 2, intensity: 0.55, color: '255,140,50', flicker: true });
  view.lighting(scene.light.ambient, lights, scene.light.tint, game.now);

  if (game.boss?.eyeGlowAt) drawEyeGlow(view, game.boss);
  // Куриный бог: сквозь камень с дыркой видно спрятавшееся Лихо.
  const b = game.boss;
  if (b?.kind === 'likho' && game.me?.charm === 'chicken' && HIDING.has(b.pose)) {
    const pulse = 0.6 + Math.sin(game.now * 5) * 0.25;
    view.groundEllipse(b.x, b.z, 0.85, 0.85, null, `rgba(255,220,90,${pulse})`, 0.05);
    view.label(b.x, b.z, 1.9, '◉', `rgba(255,217,77,${pulse})`, 0.55);
  }
  // Бельмо и темнота после чёрного всадника.
  if (game.session?.curses?.includes('cataract') || game.session?.dark) drawCataract(game);

  // Подписи и всплывающий текст — поверх света.
  if (scene.id === 'tavern') drawTavernLabels(game);
  for (const item of exits) view.label(item.x, item.z, 2.4, 'Бегство', '#ffbf66', 0.45);
  for (const p of game.players) {
    if (!p.visible) continue;
    if (p.slippery) view.label(p.x, p.z, 3.1, '!', `rgba(217,115,255,${0.4 + 0.6 * Math.abs(Math.sin(game.now * 9))})`, 0.9);
    if (p.downed) view.label(p.x, p.z, 1.4, 'Пал', '#ff8a80', 0.4);
  }
  for (const p of game.players) if (p.dropped) view.label(p.dropped[0], p.dropped[1], 1.3, 'Подобрать', '#d973ff', 0.36);
  if (game.boss?.finisherReady) view.label(game.boss.x, game.boss.z, 3.4, `[${keyName(game.input.bindings.interact[0])}] ${game.boss.finisherLabel ?? 'Выколоть глаз'}`, '#ffd94d', 0.5);
  if (game.boss?.kind === 'dummy') view.label(game.boss.x, game.boss.z, 3.4, game.boss.name, '#ffe9a8', 0.4);
  game.vfx.drawTop(view);
  if (game.showHitboxes) drawHitboxes(game);
}

/** Отладка: зоны урона (красные), тело босса (жёлтое), сам богатырь (зелёный). */
function drawHitboxes(game) {
  const { view } = game;
  for (const h of game.liveHazards()) view.groundEllipse(h.x, h.z, h.r, h.r, null, h.parry ? '#ff59c7' : '#ff3b2f', 0.05);
  if (game.boss) view.groundEllipse(game.boss.x, game.boss.z, game.boss.radius, game.boss.radius, null, '#ffd94d', 0.05);
  const me = game.local;
  view.groundEllipse(me.x, me.z, 0.45, 0.45, null, '#5bff7a', 0.05);
  // Хитбокс богатыря для снарядов — очертания рисунка в текущей позе.
  const avatar = game.avatars.get(game.myId);
  if (avatar) {
    const ctx = view.ctx;
    const [px, py] = view.project(avatar.x, avatar.z);
    ctx.fillStyle = 'rgba(91,255,122,0.28)';
    ctx.beginPath();
    for (const quad of avatar.rig.hitboxCells(bogatyrPose(avatar))) {
      quad.forEach(([x, y], i) => (i ? ctx.lineTo(px + x * view.s, py - y * view.s) : ctx.moveTo(px + x * view.s, py - y * view.s)));
      ctx.closePath();
    }
    ctx.fill();
  }
  for (const o of game.sceneData.obstacles) {
    if (o.type === 'circle') view.groundEllipse(o.x, o.z, o.r, o.r, null, 'rgba(120,200,255,0.7)', 0.04);
  }
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
  // Лес и поляна — земля из рисунка.
  if (scene.groundTile && drawGroundTile(view, scene.groundTile, scene.ground.r, scene.groundMeters)) return;
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
  const burnt = new Set(game.latest?.burnt ?? []);
  scene.trees.forEach((t, i) => add(t.z - 0.1, () => {
    // Дерево перед богатырём (ближе к камере) просвечивает, чтобы его было видно.
    const front = me && t.z < me.z && me.z - t.z < (t.hide ? 7 : 11) && Math.abs(t.x - me.x) < (t.hide ? 3 : 2.4);
    view.ctx.globalAlpha = front ? 0.4 : 1;
    const art = t.hide ? `oak${i % 2 + 1}` : `tree${i % 2 + 1}`;
    drawSprite(view, `forest/${art}${t.hide && burnt.has(i) ? '_burnt' : ''}.png`, t.x, t.z, t.hide ? 5.6 * t.size : 6.5 * t.size, i % 3 === 0);
    view.ctx.globalAlpha = 1;
  }));
  for (const d of DECOR) add(d.z + 0.3, () => drawSprite(view, `forest/${d.art}.png`, d.x, d.z, d.h, d.flip));
  const cut = new Set(game.latest?.cut ?? []), burntBushes = new Set(game.latest?.burntBushes ?? []);
  scene.bushes.forEach((b, i) => {
    if (burntBushes.has(i)) add(b.z + 0.2, () => drawSprite(view, 'forest/bush_burnt.png', b.x, b.z, 1.2, i % 2 === 0));
    else if (cut.has(i)) add(b.z + 0.2, () => drawSprite(view, 'forest/bush_cut.png', b.x, b.z, 1.3, i % 2 === 0));
    else add(b.z - 0.3, () => drawSprite(view, `forest/bush${i % 2 + 1}.png`, b.x, b.z, 2.8, i % 3 === 0));
  });
}

/** Мелочи на земле леса: только для вида, не мешают ходить. */
const DECOR = [
  ['fern', -5.5, -6.5, 1.2], ['mushrooms', 3.2, -6, 0.9], ['stone', 8, -9.5, 1.1], ['leaves', -3, 3, 0.7], ['root', 4, 1.5, 0.9], ['fern', 11, 7.5, 1.3],
  ['mushrooms', -12.5, 1.5, 0.8], ['stone', -8.5, -10, 0.9], ['leaves', 6, 11.5, 0.7], ['fern', -6, 11.5, 1.2], ['root', -9.5, 0.5, 0.8], ['leaves', 12, -2, 0.6],
].map(([art, x, z, h], i) => ({ art, x, z, h, flip: i % 2 === 0 }));

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
  drawSprite(view, 'forest/exit.png', item.x, item.z + 0.4, 2.2);
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
  softShadow(view, p.x, p.z, 0.55);
  const rig = p.rig;
  p.animator.setWeaponIfChanged(p.dropped ? null : WEAPONS[p.weapon]);
  // Перекат: кувырок вперёд вокруг середины тела с поджатием (см. bogatyrPose).
  const base = rig.base(view, p.x, p.z, bogatyrPose(p));
  const blink = p.anim?.blink > 0 && Math.floor(game.now * 5 * 2) % 2 === 1;
  const flash = game.now < (p.flashUntil ?? 0);
  rig.draw(ctx, base, {
    overlay: flash ? '#ffffff' : (blink || p.downed) ? '#000000' : null,
    overlayAlpha: flash ? 0.7 : blink ? 0.45 : p.downed ? 0.35 : 0,
  });
  if (p.anim?.stun) drawStars(view, p.x, p.z, 2.4, game.now);
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
    if (b.pose === 'Stunned') drawStars(view, b.x, b.z, 3.2, game.now);
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
  const y = py - (h.y ?? 1.2) * view.s * ORB_LIFT;
  const r = ORB_RADIUS * view.s * (1 + Math.sin(now * 20 + h.id) * 0.06);
  const color = h.parry ? [255, 89, 199] : [255, 140, 38];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, y, r * 0.5, px, y, r * 1.25);
  g.addColorStop(0, `rgba(${color},0.55)`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, y, r * 1.25, 0, Math.PI * 2); ctx.fill();
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

/** Позы, в которых Лихо сидит в укрытии. */
const HIDING = new Set(['Hidden', 'Peek', 'HiddenTree', 'PeekTree']);

/** Проклятие «Невидимые капканы»: капкан видно только вплотную (или сквозь Куриного бога). */
function trapVisible(game, h) {
  if (!game.session?.curses?.includes('hiddenTraps') || game.me?.charm === 'chicken') return true;
  return Math.hypot(h.x - game.local.x, h.z - game.local.z) < 2.6;
}

/** Следы бытовой магии: соляной круг, рассыпанный горох, горящие угли. Под конец тускнеют. */
function drawEffect(view, e, now) {
  const fade = Math.min(1, e.left / 0.8);
  const ctx = view.ctx;
  if (e.kind === 'dust') {
    // Пыль Яги закрывает подсказки атак.
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996 + now * 0.2, r = e.r * Math.sqrt((i + 0.5) / 9) * 0.85;
      view.groundEllipse(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, e.r * 0.55, e.r * 0.55, `rgba(150,135,95,${0.75 * fade})`);
    }
    const [dx, dy] = view.project(e.x, e.z, 0.4);
    ctx.globalAlpha = fade;
    drawFlat(view, 'yaga/fx_dust.png', dx, dy, e.r * 2.6, 0, e.id % 2 === 0);
    ctx.globalAlpha = 1;
  } else if (e.kind === 'comb') {
    for (let i = 0; i < 14; i++) {
      const a = i * Math.PI * 2 / 14, x = e.x + Math.sin(a) * e.r, z = e.z + Math.cos(a) * e.r;
      view.cylinder(x, z, 0.18, 1.7 * fade, '#5a4426');
    }
  } else if (e.kind === 'towel') {
    view.groundEllipse(e.x, e.z, e.r, e.r, `rgba(70,130,180,${0.55 * fade})`, `rgba(190,225,240,${0.7 * fade})`, 0.05);
  } else if (e.kind === 'bread') {
    view.groundEllipse(e.x, e.z, 0.5, 0.35, `rgba(138,90,46,${fade})`, 'rgba(60,35,15,0.9)', 0.04);
  }
  if (e.kind === 'salt') {
    view.groundEllipse(e.x, e.z, e.r, e.r, `rgba(240,236,225,${0.12 * fade})`, `rgba(245,242,232,${0.9 * fade})`, 0.09);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24 + (i % 2) * 0.1, r = e.r * (0.92 + (i % 3) * 0.05);
      const [px, py] = view.project(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r);
      ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
      ctx.fillRect(px - view.s * 0.04, py - view.s * 0.02, view.s * 0.08, view.s * 0.05);
    }
  } else if (e.kind === 'peas') {
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39996, r = e.r * Math.sqrt((i + 0.5) / 40);
      const [px, py] = view.project(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r);
      ctx.fillStyle = `rgba(${i % 2 ? '190,205,95' : '160,180,70'},${fade})`;
      ctx.beginPath(); ctx.arc(px, py, view.s * 0.06, 0, Math.PI * 2); ctx.fill();
    }
  } else if (e.kind === 'coals') {
    const flicker = 0.8 + Math.sin(now * 13 + e.id) * 0.1 + Math.sin(now * 7.3) * 0.1;
    view.groundEllipse(e.x, e.z, e.r, e.r, `rgba(255,90,20,${0.28 * fade * flicker})`, `rgba(255,150,60,${0.7 * fade})`, 0.05);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996 + now * 0.3, r = e.r * Math.sqrt((i + 0.5) / 14) * 0.9;
      const lift = ((now * 0.9 + i * 0.37) % 1) * 1.2;
      const [px, py] = view.project(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, lift);
      ctx.fillStyle = `rgba(255,${150 + (i % 3) * 30},60,${fade * (1 - lift / 1.2)})`;
      ctx.fillRect(px - view.s * 0.03, py - view.s * 0.03, view.s * 0.06, view.s * 0.06);
    }
  }
}

/** Проклятие «Бельмо»: дальше нескольких шагов от богатыря — тьма. */
function drawCataract(game) {
  const { view } = game, ctx = view.ctx;
  const [px, py] = view.project(game.local.x, game.local.z, 1);
  const inner = view.s * 4.5, outer = view.s * 8.5;
  const g = ctx.createRadialGradient(px, py, inner, px, py, outer);
  g.addColorStop(0, 'rgba(6,6,10,0)');
  g.addColorStop(1, 'rgba(6,6,10,0.93)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

/** Капкан лежит на земле. Вид задан при броске. */
function drawTrap(view, h) {
  const [px, py] = view.project(h.x, h.z);
  drawFlat(view, `likho/trap_${h.look ?? 'a'}_open.png`, px, py, 2.3);
}

/** Мягкая тень у ног — без чёткого края, чтобы не выглядела кружком. */
function softShadow(view, x, z, r) {
  const ctx = view.ctx;
  const [px, py] = view.project(x, z);
  const rx = r * view.s;
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(1, SIN);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(0.6, 'rgba(0,0,0,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export { SIN };
