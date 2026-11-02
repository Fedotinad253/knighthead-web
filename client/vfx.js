// Эффекты на земле и над головами: подсказки атак (красные круги и полосы, тень сука), вспышки ударов,
// дуги взмахов, кольцо парирования, всплывающий текст и цифры урона.
import { SIN } from './view.js';
import { assets } from './assets.js';

/** Что летит при броске и какие рисунки у капканов. */
const TOSS_IMAGES = { salt: 'items/pouch_fly.png', coals: 'items/pot_fly.png', comb: 'items/ability/comb.png', towel: 'items/ability/towel.png', bread: 'items/ability/bread.png' };
const TRAP_FLY = { a: 'likho/trap_a_fly.png', b: 'likho/trap_b_open.png', c: 'likho/trap_c_fly.png' };
/** Как летит капкан: а — навесом с лёгким вращением, б — низко и плашмя, быстро крутясь, в — высоко, кувырком. */
const TRAP_FLIGHT = { a: { arc: 2.6, turns: 0.6 }, b: { arc: 0.9, turns: 2.5 }, c: { arc: 4.2, turns: 2 } };
const FLASH_IMAGES = { claws: 'likho/fx_claws.png', ring: 'likho/fx_ring.png', dust: 'likho/fx_dust.png', branch: 'likho/fx_dust.png' };
const BRANCHES = ['likho/branch1.png', 'likho/branch2.png', 'likho/branch3.png'];

/** Рисунок шириной width м с центром в (px, py), повёрнут на angle. */
function drawCentered(view, path, px, py, width, angle = 0, alpha = 1, flip = false) {
  const image = assets.image(path);
  if (!image?.naturalWidth) return;
  const ctx = view.ctx, w = width * view.s, h = w * image.naturalHeight / image.naturalWidth;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(px, py);
  ctx.rotate(angle);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export class Vfx {
  constructor(game) {
    this.game = game;
    this.items = [];
  }

  get now() { return this.game.now; }

  add(item) { this.items.push({ born: this.now, ...item }); }

  telegraph(m) { this.add({ kind: 'tele', ...m, until: this.now + m.duration }); }
  flash(x, z, r, look = null) { this.add({ kind: 'flash', x, z, r, look, until: this.now + (look ? 0.4 : 0.25) }); }
  /** Лихо бросает капкан. */
  trapThrow(m) { this.add({ kind: 'trapFly', ...m, until: this.now + m.duration }); }
  /** Капкан захлопнулся: закрытый лежит ещё немного. */
  trapSnap(x, z, variant) { this.add({ kind: 'trapClosed', x, z, variant, until: this.now + 1.4 }); }
  slash(x, z, dx, dz, range, arc, color) { this.add({ kind: 'slash', x, z, dx, dz, range, arc, color, until: this.now + 0.22 }); }
  /** Искры от попадания (или щепки от избушки): разлетаются и падают. */
  sparks(x, z, count, wood = false) {
    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2, speed = 2 + Math.random() * 6;
      return { vx: Math.cos(a) * speed, vy: Math.abs(Math.sin(a)) * speed + 1.5, life: 0.5 + Math.random() * 0.5 };
    });
    this.add({ kind: 'sparks', x, z, parts, wood, until: this.now + 1 });
  }
  /** Кольцо-волна от сильного удара. */
  shock(x, z, r) { this.add({ kind: 'shock', x, z, r, until: this.now + 0.3 }); }
  parryFlash(x, z) { this.add({ kind: 'parry', x, z, until: this.now + 0.35 }); }
  text(x, z, y, text, color = '#fff', duration = 1.2) { this.add({ kind: 'text', x, z, y, text, color, until: this.now + duration, duration }); }
  /** Кольцо на земле, сжимающееся к центру (rgb — «r,g,b»): прицел искры, морок, живая вода. */
  ring(x, z, r, duration, rgb) { this.add({ kind: 'ring', x, z, r, rgb, until: this.now + Math.max(0.2, duration) }); }
  /** Брошенная бытовая магия: летит дугой из (x, z) в (tx, tz). */
  toss(kind, x, z, tx, tz, flight = 0.35) { this.add({ kind: 'toss', what: kind, x, z, tx, tz, until: this.now + flight }); }
  /** Цифра урона: чем больше, тем крупнее и горячее. Кровотечение и огонь — маленькие и красные. */
  damage(x, z, amount, dot = false, height = 2.4) {
    const color = dot ? '#ff7a5a' : amount >= 90 ? '#ff9a3c' : amount >= 40 ? '#ffd966' : '#fff';
    const size = dot ? 0.3 : 0.4 + Math.min(0.55, amount / 220);
    this.add({ kind: 'text', x: x + (Math.random() - 0.5) * 1.2, z, y: height + Math.random() * 0.5, text: String(amount), color, size, pop: !dot, until: this.now + 0.8, duration: 0.8 });
  }

  /** Всё, что лежит на земле, — под персонажами. */
  drawGround(view) {
    this.items = this.items.filter((i) => this.now < i.until);
    const ctx = view.ctx;
    for (const i of this.items) {
      const t = Math.min(1, (this.now - i.born) / Math.max(0.01, i.until - i.born));
      if (i.kind === 'tele') {
        if (i.shape === 'circle') {
          const shadow = i.color === 'shadow';
          if (shadow) {
            // Тень падающего сука растёт под ногами.
            view.groundEllipse(i.x, i.z, i.r * (0.3 + 0.7 * t), i.r * (0.3 + 0.7 * t), `rgba(10,5,20,${0.25 + 0.45 * t})`);
          } else {
            view.groundEllipse(i.x, i.z, i.r, i.r, 'rgba(255,60,30,0.18)', 'rgba(255,80,40,0.9)', 0.06);
            view.groundEllipse(i.x, i.z, i.r * t, i.r * t, 'rgba(255,60,30,0.35)');
          }
        } else {
          drawLine(view, i, t);
        }
      } else if (i.kind === 'trapClosed') {
        const [px, py] = view.project(i.x, i.z);
        drawCentered(view, `likho/trap_${i.variant ?? 'a'}_closed.png`, px, py, 2.3, 0, Math.min(1, (1 - t) * 3));
      } else if (i.kind === 'flash') {
        view.groundEllipse(i.x, i.z, i.r, i.r, `rgba(255,230,180,${0.55 * (1 - t)})`);
      } else if (i.kind === 'slash') {
        drawArc(view, i, t);
      } else if (i.kind === 'ring') {
        view.groundEllipse(i.x, i.z, i.r, i.r, null, `rgba(${i.rgb},${0.9 - 0.4 * t})`, 0.07);
        view.groundEllipse(i.x, i.z, i.r * (1 - t), i.r * (1 - t), `rgba(${i.rgb},0.25)`);
      }
    }
  }

  /** Текст и вспышки парирования — поверх всего. */
  drawTop(view) {
    const ctx = view.ctx;
    for (const i of this.items) {
      const t = Math.min(1, (this.now - i.born) / Math.max(0.01, i.until - i.born));
      if (i.kind === 'parry') {
        const [px, py] = view.project(i.x, i.z, 1.6);
        const r = view.s * (0.6 + t * 1.8);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(255,140,220,${0.9 * (1 - t)})`);
        g.addColorStop(1, 'rgba(255,90,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (i.kind === 'flash' && FLASH_IMAGES[i.look]) {
        const [px, py] = view.project(i.x, i.z, i.look === 'claws' ? 1 : 0.2);
        drawCentered(view, FLASH_IMAGES[i.look], px, py, i.r * 2.3 * (0.85 + t * 0.25), 0, 1 - t * t);
      } else if (i.kind === 'tele' && i.shape === 'circle' && i.color === 'shadow') {
        // Сук падает с высоты в свою тень.
        const [px, py] = view.project(i.x, i.z, (1 - t * t) * 10 + 0.4);
        drawCentered(view, BRANCHES[(i.id ?? 0) % BRANCHES.length], px, py, 2.6, (1 - t) * 0.8);
      } else if (i.kind === 'sparks') {
        const age = this.now - i.born;
        ctx.lineWidth = Math.max(1.5, view.s * 0.045);
        for (const q of i.parts) {
          if (age >= q.life) continue;
          const y = 1.4 + q.vy * age - 9 * age * age;
          if (y < 0) continue;
          const [px, py] = view.project(i.x + q.vx * age, i.z, y);
          const [ox, oy] = view.project(i.x + q.vx * (age - 0.025), i.z, 1.4 + q.vy * (age - 0.025) - 9 * (age - 0.025) * (age - 0.025));
          ctx.strokeStyle = i.wood ? '#a97c4a' : age < q.life * 0.5 ? '#fff0b0' : '#ff9a3c';
          ctx.globalAlpha = 1 - age / q.life;
          ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(px, py); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (i.kind === 'shock') {
        const r = i.r * (0.3 + t * 0.9);
        view.groundEllipse(i.x, i.z, r, r, null, `rgba(255,240,200,${0.8 * (1 - t)})`, 0.12 * (1 - t) + 0.02);
      } else if (i.kind === 'trapFly') {
        const style = TRAP_FLIGHT[i.variant] ?? TRAP_FLIGHT.a;
        const x = i.x0 + (i.x - i.x0) * t, z = i.z0 + (i.z - i.z0) * t;
        const [px, py] = view.project(x, z, 0.5 + Math.sin(t * Math.PI) * style.arc);
        drawCentered(view, TRAP_FLY[i.variant] ?? TRAP_FLY.a, px, py, i.variant === 'b' ? 2 : 2.4, t * style.turns * Math.PI * 2, 1, i.x < i.x0);
      } else if (i.kind === 'toss') {
        const x = i.x + (i.tx - i.x) * t, z = i.z + (i.tz - i.z) * t, y = 1.2 + Math.sin(t * Math.PI) * 2;
        const [px, py] = view.project(x, z, y);
        if (TOSS_IMAGES[i.what]) { drawCentered(view, TOSS_IMAGES[i.what], px, py, 0.9, t * 6); continue; }
        ctx.fillStyle = TOSS_COLORS[i.what] ?? '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = Math.max(1, view.s * 0.03);
        ctx.beginPath(); ctx.arc(px, py, view.s * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (i.kind === 'text') {
        // Цифра сначала «выстреливает» крупно, потом садится.
        const size = (i.size ?? 0.5) * (i.pop ? 1 + 0.7 * Math.max(0, 1 - t / 0.18) : 1);
        view.label(i.x, i.z, i.y + t * 0.8, i.text, i.color, size, 1 - Math.max(0, t - 0.6) / 0.4);
      }
    }
  }
}

const TOSS_COLORS = { salt: '#f4f1ea', peas: '#b5c95a', coals: '#ff7a2a', comb: '#a9794a', towel: '#e9e0cf', bread: '#8a5a2e' };

function drawLine(view, i, t) {
  const ctx = view.ctx;
  const nx = -i.dz, nz = i.dx, hw = i.width / 2;
  const corners = (length) => [
    view.project(i.x + nx * hw, i.z + nz * hw), view.project(i.x + nx * hw + i.dx * length, i.z + nz * hw + i.dz * length),
    view.project(i.x - nx * hw + i.dx * length, i.z - nz * hw + i.dz * length), view.project(i.x - nx * hw, i.z - nz * hw),
  ];
  const poly = (pts, fill, stroke) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = view.s * 0.05; ctx.stroke(); }
  };
  // Парируемая атака — розовая, остальные — красные.
  const [fill, edge] = i.color === 'parry' ? ['255,89,199', '255,120,215'] : ['255,60,30', '255,80,40'];
  poly(corners(i.length), `rgba(${fill},0.16)`, `rgba(${edge},0.85)`);
  poly(corners(i.length * t), `rgba(${fill},0.38)`);
}

function drawArc(view, i, t) {
  const ctx = view.ctx, s = view.s;
  const [px, py] = view.project(i.x, i.z);
  const angle = Math.atan2(-i.dz * SIN, i.dx);
  const half = Math.min(Math.PI, i.arc * Math.PI / 360);
  // След оружия: полумесяц, который пробегает дугу и тает. Внешний край ярче внутреннего.
  const sweep = 1 - (1 - Math.min(1, t * 2.2)) ** 3;
  const from = -half, to = -half + half * 2 * sweep, outer = i.range * s, inner = outer * (0.72 + 0.22 * t);
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(1, SIN);
  ctx.rotate(Math.atan2(-i.dz, i.dx));
  ctx.beginPath();
  ctx.arc(0, 0, outer, from, to);
  ctx.arc(0, 0, inner, to, from, true);
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.globalAlpha = (1 - t) * 0.8;
  ctx.fillStyle = i.color;
  ctx.fill();
  ctx.globalAlpha = (1 - t) * 0.45;
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  void angle;
}

/** Очертание щита-капли: h — высота, точка (0, 0) посередине. */
export function shieldPath(ctx, h) {
  const w = h * 0.36;
  ctx.beginPath();
  ctx.moveTo(-w, -h * 0.28);
  ctx.quadraticCurveTo(-w, -h * 0.5, 0, -h * 0.5);
  ctx.quadraticCurveTo(w, -h * 0.5, w, -h * 0.28);
  ctx.bezierCurveTo(w, h * 0.08, h * 0.18, h * 0.34, 0, h * 0.5);
  ctx.bezierCurveTo(-h * 0.18, h * 0.34, -w, h * 0.08, -w, -h * 0.28);
  ctx.closePath();
}

/** Щит в руке богатыря. glow — розовое свечение (то же, что у парируемых атак), flash — белая вспышка от отражённого удара. */
export function drawShield(ctx, px, py, h, { alpha = 1, glow = 1, flash = 0 } = {}) {
  ctx.save();
  ctx.translate(px, py);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(255,90,200,0.95)';
  ctx.shadowBlur = h * 0.45 * glow;
  shieldPath(ctx, h);
  ctx.fillStyle = '#8f2a20';
  ctx.fill();
  ctx.shadowBlur = 0;
  // Доски и окантовка.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#a93a2a';
  ctx.fillRect(-h, -h, h, h * 2);
  ctx.restore();
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = '#c9a24a';
  shieldPath(ctx, h * 0.88);
  ctx.stroke();
  ctx.lineWidth = h * 0.035;
  ctx.strokeStyle = '#241710';
  shieldPath(ctx, h);
  ctx.stroke();
  // Умбон посередине.
  ctx.fillStyle = '#d8cdb0';
  ctx.beginPath(); ctx.arc(0, -h * 0.1, h * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#241710';
  ctx.stroke();
  if (flash > 0) {
    ctx.globalAlpha = alpha * flash;
    ctx.fillStyle = '#fff';
    shieldPath(ctx, h);
    ctx.fill();
  }
  ctx.restore();
}
