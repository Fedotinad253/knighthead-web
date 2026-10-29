// Камера и рисование мира на Canvas 2D: вид сверху под углом 55° (как в Hades), ортографический.
// Земля сжата по глубине (sin 55°), высота 3D-предметов — по cos 55°. Рисованные персонажи стоят
// «во весь рост» без сжатия, как билборды в Unity-версии (там их растягивали на 1/cos).
export const PITCH = 55 * Math.PI / 180;
export const SIN = Math.sin(PITCH);
export const COS = Math.cos(PITCH);

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cx = 0; this.cz = 0;
    this.distance = 16;
    this.zoom = 1;
    this.shakeX = 0; this.shakeY = 0;
    this.shakes = [];
    this.runShake = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.w = this.canvas.width; this.h = this.canvas.height;
    this.dpr = dpr;
  }

  /** Пикселей на метр: камера на расстоянии distance видит по вертикали ~distance метров. */
  get s() { return this.h / (this.distance * this.zoom); }

  shake(amount, duration, now) { this.shakes.push({ amount, until: now + duration, duration }); }

  update(targetX, targetZ, dt, now, smooth = 0.12) {
    const k = 1 - Math.exp(-dt / Math.max(0.01, smooth));
    this.cx += (targetX - this.cx) * k;
    this.cz += (targetZ - this.cz) * k;
    let amount = 0;
    this.shakes = this.shakes.filter((s) => now < s.until);
    for (const s of this.shakes) amount = Math.max(amount, s.amount * ((s.until - now) / s.duration));
    // Тряска при беге избушки — в такт шагам.
    const step = Math.abs(Math.sin(now * 16)) * 0.35 * this.runShake;
    this.shakeX = (Math.random() - 0.5) * amount * 0.6 + Math.sin(now * 8) * 0.08 * this.runShake;
    this.shakeY = (Math.random() - 0.5) * amount * 0.6 + step * 0.5;
  }

  snap(x, z) { this.cx = x; this.cz = z; }

  /** Точка мира → экран (пиксели канваса). */
  project(x, z, y = 0) {
    const s = this.s;
    return [this.w / 2 + (x - this.cx + this.shakeX) * s, this.h / 2 + (-(z - this.cz) * SIN - y * COS + this.shakeY) * s];
  }

  /** Экран → точка на земле. */
  unproject(px, py) {
    const s = this.s;
    return [this.cx - this.shakeX + (px - this.w / 2) / s, this.cz - ((py - this.h / 2) / s - this.shakeY) / SIN];
  }

  // ---------------------------------------------------------------- Простые формы (3D-предметы)

  /** Плоский эллипс на земле (тень, кружок игрока, зона). */
  groundEllipse(x, z, rx, rz, fill, stroke = null, lineWidth = 0) {
    const ctx = this.ctx, s = this.s;
    const [px, py] = this.project(x, z);
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(0.1, rx * s), Math.max(0.1, rz * SIN * s), 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth * s; ctx.stroke(); }
  }

  /** Прямоугольник на земле (x, z — центр, w — по X, d — по Z). */
  groundRect(x, z, w, d, fill) {
    const [x0, y0] = this.project(x - w / 2, z + d / 2);
    const [x1, y1] = this.project(x + w / 2, z - d / 2);
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  /** Ящик: верхняя грань и передняя стенка. y — низ, h — высота. */
  box(x, z, w, d, h, color, y = 0) {
    const ctx = this.ctx;
    const [lx, top] = this.project(x - w / 2, z + d / 2, y + h);
    const [rx, frontTop] = this.project(x + w / 2, z - d / 2, y + h);
    const [, frontBottom] = this.project(x, z - d / 2, y);
    ctx.fillStyle = shade(color, 1.12);
    ctx.fillRect(lx, top, rx - lx, frontTop - top);
    ctx.fillStyle = shade(color, 0.78);
    ctx.fillRect(lx, frontTop, rx - lx, frontBottom - frontTop);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, this.s * 0.03);
    ctx.strokeRect(lx, top, rx - lx, frontBottom - top);
  }

  /** Цилиндр (ствол, стол, табурет). */
  cylinder(x, z, r, h, color, y = 0) {
    const ctx = this.ctx, s = this.s;
    const [px, bottom] = this.project(x, z, y);
    const [, top] = this.project(x, z, y + h);
    const rx = r * s, ry = r * SIN * s;
    const g = ctx.createLinearGradient(px - rx, 0, px + rx, 0);
    g.addColorStop(0, shade(color, 0.6)); g.addColorStop(0.45, shade(color, 1.05)); g.addColorStop(1, shade(color, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, bottom, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(px - rx, top);
    ctx.ellipse(px, top, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(color, 1.2);
    ctx.beginPath();
    ctx.ellipse(px, top, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Эллипсоид (крона, куст): размеры w × h × d, центр на высоте y. */
  blob(x, z, y, w, h, d, color, light = 1) {
    const ctx = this.ctx, s = this.s;
    const [px, py] = this.project(x, z, y);
    const rx = (w / 2) * s;
    const ry = Math.hypot((h / 2) * COS, (d / 2) * SIN) * s;
    const g = ctx.createRadialGradient(px - rx * 0.3, py - ry * 0.4, ry * 0.1, px, py, Math.max(rx, ry) * 1.05);
    g.addColorStop(0, shade(color, 1.35 * light)); g.addColorStop(0.7, shade(color, 0.95 * light)); g.addColorStop(1, shade(color, 0.6 * light));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Подпись над точкой мира. */
  label(x, z, y, text, color = '#fff', size = 0.42, alpha = 1) {
    const ctx = this.ctx;
    const [px, py] = this.project(x, z, 0);
    const lines = String(text).split('\n');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${Math.max(11, size * this.s)}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    lines.forEach((line, i) => {
      const ly = py - y * this.s - (lines.length - 1 - i) * size * this.s * 1.15;
      ctx.lineWidth = Math.max(2, size * this.s * 0.18);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(line, px, ly);
      ctx.fillStyle = color;
      ctx.fillText(line, px, ly);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- Свет

  /**
   * Затемнение сцены с «дырами» от источников света и тёплым отсветом поверх.
   * ambient — насколько светло без источников (1 — совсем светло).
   */
  lighting(ambient, lights, tint, now) {
    if (ambient >= 0.99 && !lights.length) return;
    const ctx = this.ctx;
    if (!this.lightCanvas || this.lightCanvas.width !== this.w || this.lightCanvas.height !== this.h) {
      this.lightCanvas = new OffscreenCanvasShim(this.w, this.h);
    }
    const lc = this.lightCanvas.ctx;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, this.w, this.h);
    lc.fillStyle = `rgba(0,0,0,${1 - ambient})`;
    lc.fillRect(0, 0, this.w, this.h);
    lc.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const flicker = l.flicker ? 0.9 + Math.sin(now * 13 + l.x * 7) * 0.05 + Math.sin(now * 23 + l.z) * 0.05 : 1;
      const [px, py] = this.project(l.x, l.z, (l.y ?? 1) * 0.5);
      const r = l.radius * this.s * flicker;
      const g = lc.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(0,0,0,${Math.min(1, l.intensity * 1.6)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lc.fillStyle = g;
      lc.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.drawImage(this.lightCanvas.canvas, 0, 0);

    // Цветной отсвет источников.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.color) continue;
      const [px, py] = this.project(l.x, l.z, (l.y ?? 1) * 0.5);
      const r = l.radius * this.s * 0.8;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${l.color},${0.22 * l.intensity})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.restore();
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, this.w, this.h); }

    // Виньетка.
    const v = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${0.55 * (1 - ambient * 0.5)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}

class OffscreenCanvasShim {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
  }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
}

/** Цвет '#rrggbb' умножить на k (светлее > 1, темнее < 1). */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
