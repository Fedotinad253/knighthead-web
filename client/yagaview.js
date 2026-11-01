// Баба-Яга и её поляна. Пока рисунков нет, всё нарисовано простыми фигурами; потом заменим на картинки из assets/yaga/.
// Размеры важны и для будущих рисунков: Яга около 2 м, избушка с ногами около 8 м.
import { SCENES } from '../shared/scenes.js';
import { shade } from './view.js';

const LEG_HEIGHT = 3.2, BODY_HEIGHT = 3.6, HUT_WIDTH = 6, HUT_DEPTH = 2.6;

/** Забор из костей с черепами, ворота и печь. Пока босса нет (выбор снаряжения), избушка сидит на своём месте. */
export function drawClearingProps(game, add) {
  const { view } = game;
  const scene = SCENES.clearing;
  for (let i = 0; i < 48; i++) {
    const a = i * Math.PI * 2 / 48, x = Math.sin(a) * 15.3, z = Math.cos(a) * 15.3;
    add(z, () => {
      view.cylinder(x, z, 0.1, 1.5, '#cfc6a8');
      if (i % 6 === 0) drawSkull(view, x, z, game.now + i);
    });
  }
  const { stove, gate, hutHome } = scene;
  add(stove.z, () => {
    view.box(stove.x, stove.z, 3.4, 2.6, 2.6, '#b9ad98');
    const [px, py] = view.project(stove.x, stove.z - 1.3, 0.3);
    const flicker = 0.7 + Math.sin(game.now * 11) * 0.15;
    view.ctx.fillStyle = `rgba(255,${130 + flicker * 40},40,${flicker})`;
    view.ctx.fillRect(px - view.s * 0.6, py - view.s * 1, view.s * 1.2, view.s * 1);
  });
  add(gate.z, () => {
    view.cylinder(gate.x, gate.z - 1.5, 0.3, 3, '#cfc6a8');
    view.cylinder(gate.x, gate.z + 1.5, 0.3, 3, '#cfc6a8');
    drawSkull(view, gate.x, gate.z, game.now, 1.4);
  });
  if (!game.boss) add(hutHome.z, () => drawHut(game, { x: hutHome.x, z: hutHome.z, seated: true }));
}

function drawSkull(view, x, z, now, size = 1) {
  view.blob(x, z, 1.75 * size, 0.42 * size, 0.46 * size, 0.42 * size, '#d8d0b8');
  const [px, py] = view.project(x, z, 1.78 * size);
  const glow = 0.7 + Math.sin(now * 5) * 0.25;
  view.ctx.fillStyle = `rgba(255,150,50,${glow})`;
  for (const side of [-1, 1]) {
    view.ctx.beginPath();
    view.ctx.arc(px + side * view.s * 0.09 * size, py, view.s * 0.05 * size, 0, Math.PI * 2);
    view.ctx.fill();
  }
}

/** Куриная нога от ступни до дома. phase — шаг. */
function drawLeg(view, x, z, side, height, phase) {
  const ctx = view.ctx, s = view.s;
  const footX = x + side * 1.5 + Math.sin(phase) * 0.7, lift = Math.max(0, Math.cos(phase)) * 0.5;
  const [fx, fy] = view.project(footX, z, lift);
  const [kx, ky] = view.project(x + side * 2.1, z, height * 0.55);
  const [hx, hy] = view.project(x + side * 1.3, z, height);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#111'; ctx.lineWidth = s * 0.7;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(kx, ky); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = '#b39a55'; ctx.lineWidth = s * 0.5;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(kx, ky); ctx.stroke();
  ctx.strokeStyle = '#7a4a26'; ctx.lineWidth = s * 0.62;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(hx, hy); ctx.stroke();
  // Пальцы шире двери: по ним видно размер.
  ctx.strokeStyle = '#2a2018'; ctx.lineWidth = s * 0.18;
  for (const a of [-1, 0, 1]) {
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + a * s * 0.9, fy + s * (a ? 0.12 : 0.35)); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Избушка: много рядов брёвен, дверь в полтора роста, маленькие окошки — чтобы выглядела огромной. */
export function drawHut(game, hut) {
  const { view } = game;
  const ctx = view.ctx, s = view.s, { x, z } = hut;
  const legHeight = hut.fallen ? 0.3 : hut.seated ? 0.7 : LEG_HEIGHT;
  const me = game.local;
  const inFront = me && z < me.z && me.z - z < 9 && Math.abs(x - me.x) < HUT_WIDTH / 2 + 0.6;
  ctx.save();
  ctx.globalAlpha = inFront ? 0.5 : 1;
  view.groundEllipse(x, z, 3.4, 2.6, 'rgba(0,0,0,0.35)');
  if (!hut.fallen && !hut.seated) {
    const phase = hut.moving ? game.now * (hut.charging ? 16 : 7) : 0;
    // Ноги у передней стены, иначе дом их заслоняет.
    drawLeg(view, x, z - HUT_DEPTH / 2, -1, legHeight, phase);
    drawLeg(view, x, z - HUT_DEPTH / 2, 1, legHeight, phase + Math.PI);
  }
  // Упавшая завалена набок.
  if (hut.fallen) {
    const [px, py] = view.project(x, z, 0);
    ctx.translate(px, py); ctx.rotate(0.28); ctx.translate(-px, -py);
  }
  const color = '#4b3621';
  view.box(x, z, HUT_WIDTH, HUT_DEPTH, BODY_HEIGHT, color, legHeight);
  const [left, bottom] = view.project(x - HUT_WIDTH / 2, z - HUT_DEPTH / 2, legHeight);
  const [right, top] = view.project(x + HUT_WIDTH / 2, z - HUT_DEPTH / 2, legHeight + BODY_HEIGHT);
  // Ряды брёвен.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, s * 0.035);
  for (let i = 1; i < 13; i++) {
    const y = bottom + (top - bottom) * i / 13;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  const cx = (left + right) / 2;
  if (!hut.turned) {
    // Дверь около 3 м и окошки.
    ctx.fillStyle = shade(color, 0.55);
    ctx.fillRect(cx - s * 0.7, bottom - s * 3 * (bottom - top) / (BODY_HEIGHT * s), s * 1.4, s * 3 * (bottom - top) / (BODY_HEIGHT * s));
    ctx.fillStyle = '#d9a441';
    for (const side of [-1, 1]) ctx.fillRect(cx + side * s * 1.9 - s * 0.3, top + (bottom - top) * 0.28, s * 0.6, s * 0.6);
  }
  // Крыша из дёрна.
  const [, roofTop] = view.project(x, z, legHeight + BODY_HEIGHT + 2.3);
  ctx.fillStyle = '#39452a';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = Math.max(1.5, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(left - s * 0.4, top);
  ctx.lineTo(cx, roofTop);
  ctx.lineTo(right + s * 0.4, top);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  if (hut.active && hut.legHits > 0 && !hut.fallen) view.label(x, z, 2.4, `Ноги: ${Math.floor(hut.legHits)}/3`, '#ffd94d', 0.45);
}

/** Яга в ступе. На крыше — над избушкой, в полёте — покачивается. */
export function drawYaga(game, b) {
  const { view } = game;
  const flash = game.now < (b.flashUntil ?? 0);
  const paint = (c) => (flash ? '#ffffff' : c);
  const y = b.onRoof ? LEG_HEIGHT + BODY_HEIGHT + 1.7 : b.airborne ? 2.4 + Math.sin(game.now * 3) * 0.2 : 0;
  if (!b.onRoof) view.groundEllipse(b.x, b.z, 0.8, 0.6, 'rgba(0,0,0,0.35)');
  const down = b.pose === 'Stunned' || b.pose === 'Exhausted' || b.pose === 'Dead';
  if (down) {
    view.blob(b.x, b.z, 0.35, 1.8, 0.6, 0.8, paint('#4a3f3a'));
    view.blob(b.x + 0.9, b.z, 0.4, 0.5, 0.5, 0.5, paint('#a39a68'));
  } else {
    view.cylinder(b.x, b.z, 0.55, 1.1, paint('#6b4a2a'), y);
    view.blob(b.x, b.z, y + 1.4, 0.8, 0.9, 0.7, paint('#4a3f3a'));
    view.blob(b.x, b.z, y + 2.05, 0.55, 0.55, 0.55, paint('#a39a68'));
    // Помело.
    const [hx, hy] = view.project(b.x + (b.fx > 0 ? 0.5 : -0.5), b.z, y + 1.9);
    const [ex, ey] = view.project(b.x + (b.fx > 0 ? 1.2 : -1.2), b.z, y + 0.1);
    view.ctx.strokeStyle = '#3a2a18';
    view.ctx.lineWidth = Math.max(2, view.s * 0.07);
    view.ctx.beginPath(); view.ctx.moveTo(hx, hy); view.ctx.lineTo(ex, ey); view.ctx.stroke();
    view.blob(b.x + (b.fx > 0 ? 1.25 : -1.25), b.z, y + 0.05, 0.5, 0.5, 0.4, paint('#8a7a4a'));
  }
  if (b.pose === 'Stuck' || b.pose === 'Stunned' || b.pose === 'Tired') view.label(b.x, b.z, y + 2.6, '✦ ✦', '#ffb34d', 0.4);
}

const RIDERS = { rider_white: '#e6e3da', rider_red: '#b33a26', rider_black: '#1c1a22' };

/** Всадники, лопата, гуси, кости и клевок. */
export function drawWideProjectile(view, h, now) {
  const ctx = view.ctx, s = view.s;
  const flip = h.vx < 0 ? -1 : 1;
  if (RIDERS[h.look]) {
    const color = RIDERS[h.look];
    view.groundEllipse(h.x, h.z, 1.2, 0.8, 'rgba(0,0,0,0.35)');
    view.blob(h.x, h.z, 1.1, 2.2, 1, 0.9, color);
    view.blob(h.x + flip * 1, h.z, 1.7, 0.7, 0.7, 0.5, color);
    view.blob(h.x - flip * 0.1, h.z, 2.1, 0.6, 1.1, 0.5, shade(color, 0.8));
    view.blob(h.x - flip * 0.1, h.z, 2.85, 0.4, 0.4, 0.4, shade(color, 1.2));
    const [px, py] = view.project(h.x, h.z, 0);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, s * 0.14);
    const k = Math.sin(now * 25) * 0.4;
    for (const a of [-0.8, 0.8]) { ctx.beginPath(); ctx.moveTo(px + a * s, py - s * 0.7); ctx.lineTo(px + (a + k) * s, py); ctx.stroke(); }
  } else if (h.look === 'shovel') {
    const l = Math.hypot(h.vx, h.vz) || 1, dx = h.vx / l, dz = h.vz / l;
    const [x0, y0] = view.project(h.x - dx * 3, h.z - dz * 3, 0.7);
    const [x1, y1] = view.project(h.x, h.z, 0.7);
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = Math.max(3, s * 0.14);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    view.groundEllipse(h.x, h.z, 1, 0.8, '#3c2b1a', '#111', 0.05);
  } else if (h.look === 'goose') {
    const wing = Math.sin(now * 16 + h.id) * 0.5;
    view.groundEllipse(h.x, h.z, 0.45, 0.3, 'rgba(0,0,0,0.3)');
    view.blob(h.x, h.z, 1.6, 0.9, 0.45, 0.4, '#d9d3c2');
    const [px, py] = view.project(h.x, h.z, 1.6);
    ctx.strokeStyle = '#bdb6a4'; ctx.lineWidth = Math.max(2, s * 0.14);
    ctx.beginPath(); ctx.moveTo(px - s * 0.7, py - s * wing); ctx.lineTo(px, py); ctx.lineTo(px + s * 0.7, py - s * wing); ctx.stroke();
  } else {
    // Кость или клевок. Парируемая — розовая.
    const [px, py] = view.project(h.x, h.z, h.y ?? 1);
    view.groundEllipse(h.x, h.z, 0.25, 0.2, 'rgba(0,0,0,0.3)');
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(now * 9 + h.id);
    ctx.fillStyle = h.parry ? '#ff9ad9' : h.look === 'peck' ? '#2a2018' : '#e0d8bd';
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.fillRect(-s * 0.32, -s * 0.07, s * 0.64, s * 0.14);
    ctx.strokeRect(-s * 0.32, -s * 0.07, s * 0.64, s * 0.14);
    ctx.restore();
  }
}

/** Огонь на земле. */
export function drawFireZone(view, h, now) {
  const flicker = 0.75 + Math.sin(now * 13 + h.id) * 0.2;
  view.groundEllipse(h.x, h.z, h.r, h.r, `rgba(255,110,30,${0.5 * flicker})`, `rgba(255,190,80,${0.7 * flicker})`, 0.04);
  const [px, py] = view.project(h.x, h.z, 0);
  view.ctx.fillStyle = `rgba(255,${150 + flicker * 60},60,${flicker})`;
  view.ctx.beginPath();
  view.ctx.moveTo(px - view.s * 0.3, py);
  view.ctx.lineTo(px, py - view.s * (0.8 + flicker * 0.4));
  view.ctx.lineTo(px + view.s * 0.3, py);
  view.ctx.fill();
}
