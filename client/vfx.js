// Эффекты на земле и над головами: подсказки атак (красные круги и полосы, тень сука), вспышки ударов,
// дуги взмахов, кольцо парирования, всплывающий текст и цифры урона.
import { SIN } from './view.js';

export class Vfx {
  constructor(game) {
    this.game = game;
    this.items = [];
  }

  get now() { return this.game.now; }

  add(item) { this.items.push({ born: this.now, ...item }); }

  telegraph(m) { this.add({ kind: 'tele', ...m, until: this.now + m.duration }); }
  flash(x, z, r) { this.add({ kind: 'flash', x, z, r, until: this.now + 0.25 }); }
  slash(x, z, dx, dz, range, arc, color) { this.add({ kind: 'slash', x, z, dx, dz, range, arc, color, until: this.now + 0.15 }); }
  parryFlash(x, z) { this.add({ kind: 'parry', x, z, until: this.now + 0.35 }); }
  text(x, z, y, text, color = '#fff', duration = 1.2) { this.add({ kind: 'text', x, z, y, text, color, until: this.now + duration, duration }); }
  /** Кольцо на земле, сжимающееся к центру (rgb — «r,g,b»): прицел искры, морок, живая вода. */
  ring(x, z, r, duration, rgb) { this.add({ kind: 'ring', x, z, r, rgb, until: this.now + Math.max(0.2, duration) }); }
  /** Брошенная бытовая магия: летит дугой из (x, z) в (tx, tz). */
  toss(kind, x, z, tx, tz, flight = 0.35) { this.add({ kind: 'toss', what: kind, x, z, tx, tz, until: this.now + flight }); }
  damage(x, z, amount) { this.add({ kind: 'text', x: x + (Math.random() - 0.5) * 0.8, z, y: 2.4, text: String(amount), color: '#fff', until: this.now + 0.8, duration: 0.8, small: true }); }

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
      } else if (i.kind === 'toss') {
        const x = i.x + (i.tx - i.x) * t, z = i.z + (i.tz - i.z) * t, y = 1.2 + Math.sin(t * Math.PI) * 2;
        const [px, py] = view.project(x, z, y);
        ctx.fillStyle = TOSS_COLORS[i.what] ?? '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = Math.max(1, view.s * 0.03);
        ctx.beginPath(); ctx.arc(px, py, view.s * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (i.kind === 'text') {
        view.label(i.x, i.z, i.y + t * 0.8, i.text, i.color, i.small ? 0.36 : 0.5, 1 - Math.max(0, t - 0.6) / 0.4);
      }
    }
  }
}

const TOSS_COLORS = { salt: '#f4f1ea', peas: '#b5c95a', coals: '#ff7a2a' };

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
  poly(corners(i.length), 'rgba(255,60,30,0.16)', 'rgba(255,80,40,0.85)');
  poly(corners(i.length * t), 'rgba(255,60,30,0.38)');
}

function drawArc(view, i, t) {
  const ctx = view.ctx, s = view.s;
  const [px, py] = view.project(i.x, i.z);
  const angle = Math.atan2(-i.dz * SIN, i.dx);
  const half = Math.min(Math.PI, i.arc * Math.PI / 360);
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(1, SIN);
  ctx.rotate(Math.atan2(-i.dz, i.dx));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, i.range * s, -half, half);
  ctx.closePath();
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = i.color;
  ctx.fill();
  ctx.restore();
  void angle;
}

/** Кольцо парирования у ног: розовое, убывает как таймер. */
export function drawParryRing(view, x, z, remaining, window = 1) {
  const ctx = view.ctx, s = view.s;
  const [px, py] = view.project(x, z);
  const f = Math.max(0, Math.min(1, remaining / window));
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(1, SIN);
  ctx.lineWidth = s * 0.09;
  ctx.strokeStyle = 'rgba(255,90,200,0.35)';
  ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,110,215,0.95)';
  ctx.beginPath(); ctx.arc(0, 0, s * 0.85, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.stroke();
  ctx.restore();
}
