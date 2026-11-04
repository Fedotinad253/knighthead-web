// Рисование сцен (таверна, ночной лес, арена) и всех, кто в них: богатыри, боссы, снаряды, капканы.
// Порядок — от дальнего к ближнему (больший Z — дальше), как в 3D.
import { WEAPONS, WORLDS, BOSSES, SESSION } from '../shared/data.js';
import { SCENES } from '../shared/scenes.js';
import { assets } from './assets.js';
import { shade, SIN, ORB_LIFT, ORB_RADIUS } from './view.js';
import { drawClearingProps, drawYaga, drawHut, drawWideProjectile, drawFireZone, drawFlat, drawStars, drawGroundTile } from './yagaview.js';
import { bogatyrPose } from './rig.js';
import { drawShield, shieldPath } from './vfx.js';
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

  const drawables = [];
  const add = (key, draw) => drawables.push({ key, draw });

  if (scene.id === 'tavern') addTavernProps(game, add);
  if (scene.id === 'forest') addForestProps(game, add);
  if (scene.id === 'arena') addArenaProps(game, add);
  if (scene.id === 'clearing') drawClearingProps(game, add);
  const exits = game.session?.firstYaga ? [] : (scene.interactables ?? []).filter((item) => item.kind === 'exit');
  for (const item of exits) add(item.z + 1, () => drawExit(view, item, game.now));

  // В некоторых кат-сценах босс и богатырь рисуются поверх всего, чтобы их не заслоняли кусты.
  const front = game.boss?.cine?.front;
  for (const p of game.players) if (p.visible) add(front ? -1e6 - 1 : p.z, () => drawPlayer(game, p));
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
    add(front ? -1e6 : b.onRoof ? b.hut.z - 0.5 : b.z + (hidden ? 0.6 : 0), () => (b.kind === 'yaga' ? drawYaga(game, b) : drawBoss(game, b)));
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
  // В кат-сцене то, на что смотрим, должно быть видно и в ночном лесу.
  if (game.boss?.cine) lights.push({ x: game.boss.cine.x, z: game.boss.cine.z, y: 2.5, radius: 7, intensity: 0.6, color: '255,225,190' });
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
  if (game.local?.dustBlind > 0.01) drawCataract(game, '128,112,76', 0.96 * game.local.dustBlind, 2.2, 5.5);

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
  drawBossStatus(game);
  game.vfx.drawTop(view);
  drawEyeBlood(game);
  drawAwlGlow(game);
  drawCooldowns(game);
  drawScreenEffects(game);
  if (game.showHitboxes) drawHitboxes(game);
}

/** Кровь из выколотого глаза: брызги от удара, потом капает всю третью фазу. Координаты — метры от ног Лиха. */
function drawEyeBlood(game) {
  const b = game.boss, { view, now } = game;
  if (!b?.eyeAt || (!b.eyeBleed && !b.drops?.length)) return;
  const dt = Math.min(0.05, Math.max(0, now - (b.bloodAt ?? now)));
  b.bloodAt = now;
  const drops = b.drops ??= [], side = b.flip ? -1 : 1;
  const emit = (fast) => drops.push({
    x: b.eyeAt[0], y: b.eyeAt[1], r: 0.012 + Math.random() * 0.018,
    vx: fast ? side * (0.5 + Math.random() * 5) : side * Math.random() * 0.25, vy: fast ? Math.random() * 5 - 0.5 : 0,
  });
  for (; b.bloodBurst > 0; b.bloodBurst--) emit(true);
  if (b.eyeBleed && b.pose !== 'Dead') {
    b.dripDebt = (b.dripDebt ?? 0) + dt * (b.cine ? 14 : 1.5);
    for (; b.dripDebt >= 1 && drops.length < 160; b.dripDebt--) emit(false);
  }
  const [px, py] = view.project(b.x, b.z), ctx = view.ctx;
  ctx.strokeStyle = '#8c1410';
  ctx.lineCap = 'round';
  b.drops = drops.filter((d) => {
    d.vy -= 8 * dt;
    d.x += d.vx * dt; d.y += d.vy * dt;
    if (d.y <= 0) return false;
    // Капля вытянута вдоль полёта.
    const x = px + d.x * view.s, y = py - d.y * view.s;
    ctx.lineWidth = Math.max(1, d.r * 2 * view.s);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - d.vx * 0.018 * view.s, y + d.vy * 0.018 * view.s);
    ctx.stroke();
    return true;
  });
}

/** Шило в руке богатыря: рукоять и раскалённый к острию стержень. Смотрит в глаз Лиха, при ударе достаёт до него. */
function drawAwl(game, p, base) {
  const { view } = game, ctx = view.ctx, s = view.s, pose = p.anim.cine;
  const [hx, hy] = p.rig.screenPoint(base, 'weapon');
  const b = game.boss, side = p.flip ? -1 : 1;
  let dx = side * 0.7, dy = -0.7, length = 0.8 * s;
  if (b?.eyeAt && pose !== 'awlDraw') {
    const [bx, by] = view.project(b.x, b.z), ex = bx + b.eyeAt[0] * s - hx, ey = by - b.eyeAt[1] * s - hy, d = Math.hypot(ex, ey) || 1;
    dx = ex / d; dy = ey / d;
    if (pose === 'awlStrike' || pose === 'awlHold') length = Math.min(d, 1.25 * s);
  }
  const tx = hx + dx * length, ty = hy + dy * length, nx = -dy, ny = dx, w = s * 0.035;
  ctx.save();
  // Рукоять.
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2c1a0e';
  ctx.lineWidth = s * 0.11;
  ctx.beginPath(); ctx.moveTo(hx - dx * s * 0.14, hy - dy * s * 0.14); ctx.lineTo(hx + dx * s * 0.14, hy + dy * s * 0.14); ctx.stroke();
  // Стержень сужается к острию и раскаляется.
  const g = ctx.createLinearGradient(hx, hy, tx, ty);
  g.addColorStop(0, '#5a5650');
  g.addColorStop(0.45, '#c8481c');
  g.addColorStop(0.8, '#ffb040');
  g.addColorStop(1, '#fff6d8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(hx + nx * w, hy + ny * w);
  ctx.lineTo(tx, ty);
  ctx.lineTo(hx - nx * w, hy - ny * w);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  game.awlTip = { x: tx, y: ty, at: game.now };
}

/** Свечение острия шила — поверх темноты. */
function drawAwlGlow(game) {
  const tip = game.awlTip;
  if (!tip || game.now - tip.at > 0.05) return;
  const ctx = game.view.ctx, r = game.view.s * (0.34 + Math.sin(game.now * 30) * 0.04);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
  g.addColorStop(0, 'rgba(255,220,150,0.95)');
  g.addColorStop(0.35, 'rgba(255,130,40,0.45)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Под ногами богатыря: готовы ли перекат и щит. Пока идёт перезарядка, значок серый и вокруг него набирается дуга. */
function drawCooldowns(game) {
  const { view, local } = game, ctx = view.ctx, s = view.s;
  const me = game.avatars?.get(game.myId);
  if (!me?.visible || me.downed || game.session?.state !== SESSION.ARENA || game.cutscene) return;
  const [px, py] = view.project(me.x, me.z);
  const r = Math.max(12, s * 0.24), y = py + s * 0.5;
  const pip = (name, x, charge, color, icon) => {
    const ready = charge >= 1, pops = local.pipPops ??= {};
    if (ready && pops[name]?.ready === false) pops[name].at = game.now;
    pops[name] = { at: pops[name]?.at ?? -9, ready };
    const pop = 1 + 0.45 * Math.max(0, 1 - (game.now - pops[name].at) / 0.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(14,11,8,0.78)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.strokeStyle = ready ? color : 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    if (!ready) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge); ctx.stroke();
    }
    ctx.globalAlpha = ready ? 1 : 0.4;
    icon(ready ? color : '#cfcabd');
    ctx.restore();
  };
  pip('roll', px - r * 1.35, local.rollCharge, '#ffd966', (color) => {
    // Две стрелки, куда летит перекат.
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const x of [-r * 0.42, r * 0.08]) { ctx.moveTo(x, -r * 0.42); ctx.lineTo(x + r * 0.34, 0); ctx.lineTo(x, r * 0.42); }
    ctx.stroke();
  });
  // У щита дуга показывает его прочность; пробитый краснеет, пока не восстановится.
  pip('shield', px + r * 1.35, local.shieldCharge, local.shieldBroken ? '#ff6a50' : '#8fc7ff', (color) => {
    shieldPath(ctx, r * 1.25);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

/** Вспышка на весь экран и красный край, когда богатырь ранен. */
function drawScreenEffects(game) {
  const { view } = game, ctx = view.ctx, now = game.realNow ?? 0;
  const flash = game.screenFlash;
  if (flash && now < flash.until) {
    ctx.fillStyle = `rgba(${flash.rgb},${flash.alpha * (flash.until - now) / flash.seconds})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (now < (game.hurtUntil ?? 0)) {
    const k = (game.hurtUntil - now) / 0.35;
    const g = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.35, view.w / 2, view.h / 2, view.h * 0.8);
    g.addColorStop(0, 'rgba(190,20,20,0)');
    g.addColorStop(1, `rgba(190,20,20,${0.6 * k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

/** Что видно на боссе: оглушение — звёзды, огонь — пламя, кровотечение — капли. */
function drawBossStatus(game) {
  const status = game.latest?.status, b = game.boss, view = game.view;
  if (!status || !b || b.pose === 'Dead') return;
  const y = b.onRoof ? 9 : b.airborne ? 5 : 3.2, now = game.now;
  if (status.stun > 0) drawStars(view, b.x, b.z, y, now);
  // Огонь и кровь видны там, на кого наложены: на Яге, в том числе на крыше, или на избушке.
  const burn = (x, z, height) => {
    const [px, py] = view.project(x, z, height);
    drawFlat(view, 'yaga/fx_fire.png', px, py, 1.8, 0, Math.floor(now * 8) % 2 === 0);
  };
  const bleed = (x, z, height, stacks) => {
    const ctx = view.ctx;
    ctx.fillStyle = '#c21d1d';
    for (let i = 0; i < 2 + stacks * 2; i++) {
      const fall = (now * 1.4 + i * 0.41) % 1;
      const [px, py] = view.project(x + Math.sin(i * 2.4) * 0.5, z, height * (1 - fall));
      ctx.beginPath(); ctx.arc(px, py, view.s * 0.07, 0, Math.PI * 2); ctx.fill();
    }
  };
  if (status.burn > 0) burn(b.x, b.z, b.onRoof ? 7.4 : b.airborne ? 3.4 : 1);
  if (status.bleed > 0) bleed(b.x, b.z, b.onRoof ? 8 : 2, status.stacks);
  if (b.hut) {
    const raised = b.hut.fallen || b.hut.seated ? 0 : 3.2;
    if (status.hutBurn > 0) burn(b.hut.x, b.hut.z - 1, raised + 1.5);
    if (status.hutBleed > 0) bleed(b.hut.x, b.hut.z - 1, raised + 2, status.hutStacks);
  }
}

/** Отладка: зоны урона (красные), тело босса (жёлтое), сам богатырь (зелёный). */
function drawHitboxes(game) {
  const { view } = game;
  for (const h of game.liveHazards()) view.groundEllipse(h.x, h.z, h.r, h.r, null, h.block ? '#8fc7ff' : '#ff3b2f', 0.05);
  if (game.boss) view.groundEllipse(game.boss.x, game.boss.z, game.boss.radius, game.boss.radius, null, '#ffd94d', 0.05);
  // Яга: полоса, куда попадают стрелы. Избушка: только ноги.
  const arrowBox = game.boss?.arrowBox;
  if (arrowBox) {
    const [x0, y0] = view.project(game.boss.x - arrowBox.halfWidth, arrowBox.z1);
    const [x1, y1] = view.project(game.boss.x + arrowBox.halfWidth, arrowBox.z0);
    view.ctx.strokeStyle = '#ffd94d'; view.ctx.lineWidth = Math.max(1, view.s * 0.05);
    view.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  if (game.boss?.hut?.active) for (const leg of game.boss.hut.legs) view.groundEllipse(leg.x, leg.z, leg.r, leg.r, null, '#ffd94d', 0.05);
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

/** Пол и стены избушки. Плитка каждый кадр обходится дорого, поэтому пол собирается один раз. */
let hutFloor = null;
function drawTavernFloor(view) {
  const ctx = view.ctx, floor = assets.image('hut/floor.jpg'), back = assets.image('hut/wall_back.jpg'), side = assets.image('hut/wall_side.jpg');
  if (!floor?.naturalWidth || !back?.naturalWidth || !side?.naturalWidth) { view.groundRect(0, 0, 26, 22, '#3a2a1c'); return; }
  const density = 48, width = 26, depth = 22, tile = 5;
  if (!hutFloor) {
    hutFloor = document.createElement('canvas');
    hutFloor.width = width * density; hutFloor.height = Math.round(depth * SIN * density);
    const bake = hutFloor.getContext('2d'), w = tile * density, h = w * SIN;
    for (let x = 0; x < hutFloor.width; x += w) for (let y = 0; y < hutFloor.height; y += h) bake.drawImage(floor, x, y, w, h);
  }
  const [x0, y0] = view.project(-width / 2, depth / 2), [x1, y1] = view.project(width / 2, -depth / 2);
  ctx.drawImage(hutFloor, x0, y0, x1 - x0, y1 - y0);
  // Дальняя стена: брёвна от пола вверх.
  const wallHeight = 4.2, wallTile = wallHeight * back.naturalWidth / back.naturalHeight;
  for (let x = -width / 2 - 1; x < width / 2 + 1; x += wallTile) {
    const [px, py] = view.project(x, depth / 2);
    ctx.drawImage(back, px, py - wallHeight * view.s, wallTile * view.s + 1, wallHeight * view.s);
  }
  // Боковые стены, как их видно сверху: торцы брёвен.
  const sideWidth = 1.4, sideTile = sideWidth * 3;
  for (const x of [-width / 2 - sideWidth, width / 2]) for (let z = depth / 2; z > -depth / 2 - 1; z -= sideTile) {
    const [px, py] = view.project(x, z);
    ctx.drawImage(side, 210, 0, 610, side.naturalHeight, px, py, sideWidth * view.s, sideTile * SIN * view.s + 1);
  }
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
  /** Предмет стоит на полу: z — где его низ, height — высота в метрах. */
  const prop = (name, x, z, height, flip = false, lift = 0) => add(z, () => drawSprite(view, `hut/${name}.png`, x, z, height, flip, lift));
  // На дальней стене.
  const wall = 10.95;
  prop('door', 9.2, wall, 3.3);
  prop('window', -8.4, wall, 1.9, false, 1.1);
  prop('window', 5.8, wall, 1.9, false, 1.1);
  prop('herbs', -11, wall, 1.3, false, 2.2);
  prop('herbs', 3, wall, 1, true, 2.9);

  // Печь, рядом с ней Яга, прялка, зеркальце, ворон, кот и домовой в горшке.
  prop('oven_fire', 0, 9.4, 5);
  fireGlow(view, add, 0, 9.3, game.now);
  // Бывшая хозяйка сидит в своей ступе: те же рисунки, что и в бою.
  add(8.7, () => drawYaga(game, { x: -3.6, z: 8.7, fx: 1, pose: 'Stand', airborne: false, onRoof: false }));
  prop('spinning_wheel', -6.8, 8.7, 2.4);
  prop('mirror', 4.2, 8.8, 1.8);
  prop('raven', 6.4, 9.1, 1.9, true);
  prop('cat_sleep', 2.9, 7.4, 0.8);
  prop('domovoy_idle', -2.7, 7.4, 1.05);

  // Угол знахарки: лавка с кувшинами живой и мёртвой воды.
  prop('bench', -10.2, 7.4, 1.25);
  add(7.3, () => drawSprite(view, 'hut/water_jugs.png', -10.2, 7.3, 1, false, 0.72));
  // Кузня: горн и наковальня.
  prop('forge_fire', 10.6, 7.5, 2.7);
  prop('anvil', 10.6, 3, 1.7);
  // Полати, сундуки и домовой с монетами.
  prop('polati', -10, -3.8, 2.4);
  prop('chest_open', 10.6, -6.4, 1.5);
  prop('chest_closed', -10.8, -8.8, 1.3);
  prop('domovoy', 8.3, -6.4, 1.15, true);

  for (const o of scene.obstacles.filter((o) => o.stool)) prop('stool', o.x, o.z - 0.15, 0.75);
  for (const [x, z] of scene.tables) prop('table_feast', x, z - 0.55, 1.75);
  for (const [z, x] of [[-6, -12.6], [0, -12.6], [6, -12.6], [-6, 12.6], [0, 12.6], [6, 12.6]]) add(z + 0.4, () => torch(view, x, z, game.now));
  // Знахарка и кузнец — рисованные, во весь рост.
  for (const id of ['healer', 'smith']) {
    const npc = scene.interactables.find((i) => i.id === id);
    add(npc.z, () => drawSprite(view, NPC_ART[id][0], npc.x, npc.z, NPC_ART[id][1], id === 'smith'));
  }
  // Стойки с оружием.
  for (const item of scene.interactables.filter((i) => i.kind === 'rack')) {
    prop('weapon_rack', item.x, item.z - 0.1, 2.3);
    const w = WEAPONS[item.weapon];
    // Висит на крюках справа от столба, иначе тёмное оружие сливается с ним.
    add(item.z - 0.11, () => drawSprite(view, w.sprite, item.x + 0.3, item.z - 0.11, w.height * 1.25, false, 0.45));
  }
  // Круглый стол, на нём блюдечко с наливным яблочком: через него открывается карта.
  prop('table_cloth', 0, 4.9, 1.9);
  add(4.8, () => {
    const image = assets.image('map/saucer.png');
    if (!image?.naturalWidth) return;
    const [px, py] = view.project(0, 5.2, 1.45), w = 1.25 * view.s, h = w * 0.62;
    view.ctx.drawImage(image, px - w / 2, py - h / 2, w, h);
  });
  // Низкий передний край стены.
  add(-11, () => {
    const image = assets.image('hut/wall_back.jpg');
    if (!image?.naturalWidth) return;
    const [x0, y0] = view.project(-14.4, -11), [x1] = view.project(14.4, -11), height = 0.7 * view.s;
    view.ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight * 0.2, x0, y0 - height, x1 - x0, height);
  });
}

/** Отсвет огня в устье печи. */
function fireGlow(view, add, x, z, now) {
  add(z - 0.05, () => {
    const ctx = view.ctx, [px, py] = view.project(x, z, 1.5), r = view.s * (1.6 + Math.sin(now * 11) * 0.1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,150,60,0.28)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
}

function drawTavernLabels(game) {
  const { view } = game;
  const scene = SCENES.tavern;
  view.label(0, 5.2, 2.2, 'Блюдечко', '#ffd980', 0.45);
  for (const item of scene.interactables.filter((i) => i.kind === 'rack')) view.label(item.x, item.z, 2.4, WEAPONS[item.weapon].name, '#fff', 0.36);
  view.label(-9, 5, 2.5, 'Знахарка Милава', '#c9f5c0', 0.38);
  view.label(9, 5, 2.6, 'Кузнец Добромир', '#ffd2a6', 0.38);
  view.label(8.3, -6.4, 1.6, 'Домовой', '#e9dcb0', 0.36);
  view.label(-3.6, 8.7, 2.7, 'Баба-Яга', '#e9dcb0', 0.38);
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
  if (p.anim?.cine?.startsWith('awl')) drawAwl(game, p, base);
  // Щит вскидывается быстро и так же быстро опускается.
  p.shieldLift = (p.shieldLift ?? 0) + ((p.anim?.block ? 1 : 0) - (p.shieldLift ?? 0)) * 0.35;
  if (p.shieldLift > 0.03) {
    const size = view.s * 0.95 * (0.7 + 0.3 * p.shieldLift);
    const [sx, sy] = view.project(p.x + (p.flip ? -0.42 : 0.42), p.z, 1.05);
    const flashLeft = p.id === game.myId ? (game.local.shieldFlashUntil ?? 0) - game.now : 0;
    drawShield(ctx, sx, sy, size, { alpha: Math.min(1, p.shieldLift * 2), glow: 0.5, flash: Math.max(0, flashLeft / 0.18) });
  }
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
    const base = b.rig.base(view, b.x, b.z, { flip: b.flip, squash: b.squash ?? 1 });
    b.rig.draw(ctx, base, { overlay: flash ? '#ffffff' : null, overlayAlpha: flash ? 0.6 : 0 });
    // Где глаз, в метрах от ног: туда целится шило и оттуда течёт кровь.
    const [footX, footY] = view.project(b.x, b.z), [eyeX, eyeY] = b.rig.screenPoint(base, 'eye');
    b.eyeAt = [(eyeX - footX) / view.s, (footY - eyeY) / view.s];
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
  const color = [255, 140, 38];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, y, r * 0.5, px, y, r * 1.25);
  g.addColorStop(0, `rgba(${color},0.55)`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(px, y, r * 1.25, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffd099';
  ctx.beginPath(); ctx.arc(px, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
}

function drawArrow(view, a) {
  const ctx = view.ctx;
  if (a.big) {
    // Волна меча и большие болты: заметные, зажигательный — рыжий.
    const l = Math.hypot(a.vx, a.vz) || 1;
    const [bx, by] = view.project(a.x - a.vx / l * 0.7, a.z - a.vz / l * 0.7, 1);
    const [fx, fy] = view.project(a.x + a.vx / l * 0.7, a.z + a.vz / l * 0.7, 1);
    ctx.strokeStyle = a.burn ? '#ff9a3c' : '#fff3c4';
    ctx.lineWidth = Math.max(4, view.s * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.lineCap = 'butt';
    return;
  }
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
  if (e.kind === 'rain') {
    // Дождь стрел: круг и падающие стрелы.
    view.groundEllipse(e.x, e.z, e.r, e.r, `rgba(255,230,160,${0.12 * fade})`, `rgba(255,230,160,${0.8 * fade})`, 0.05);
    ctx.strokeStyle = `rgba(245,232,190,${fade})`;
    ctx.lineWidth = Math.max(1.5, view.s * 0.04);
    for (let i = 0; i < 16; i++) {
      const a = i * 2.39996, r = e.r * Math.sqrt((i + 0.5) / 16);
      const fall = (now * 2.2 + i * 0.37) % 1, y = (1 - fall) * 7;
      const [px, py] = view.project(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, y);
      ctx.beginPath(); ctx.moveTo(px, py - view.s * 0.5); ctx.lineTo(px, py); ctx.stroke();
    }
  } else if (e.kind === 'dust') {
    // Пыль Яги закрывает подсказки атак.
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996 + now * 0.2, r = e.r * Math.sqrt((i + 0.5) / 9) * 0.85;
      view.groundEllipse(e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, e.r * 0.55, e.r * 0.55, `rgba(150,135,95,${0.75 * fade})`);
    }
    const [dx, dy] = view.project(e.x, e.z, 0.4);
    ctx.globalAlpha = fade;
    drawFlat(view, 'yaga/fx_dust.png', dx, dy - e.r * 0.25 * view.s, e.r * 2.6, 0, e.id % 2 === 0);
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

/** Плохо видно: дальше нескольких шагов от богатыря всё тонет — во тьме («Бельмо», чёрный всадник) или в пыли от метлы. */
function drawCataract(game, rgb = '6,6,10', strength = 0.93, innerMeters = 4.5, outerMeters = 8.5) {
  const { view } = game, ctx = view.ctx;
  const [px, py] = view.project(game.local.x, game.local.z, 1);
  const inner = view.s * innerMeters, outer = view.s * outerMeters;
  const g = ctx.createRadialGradient(px, py, inner, px, py, outer);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(1, `rgba(${rgb},${strength})`);
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
