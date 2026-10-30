// Карта на столе в таверне (минималистичная, как в Cuphead): три мира слева направо, река Смородина
// с Калиновым мостом, золотая лестница в Правь, логова боссов. По ней свободно бегает избушка на курьих ножках.
import { MAP } from '../shared/scenes.js';
import { BOSSES, DIFFICULTIES, RANKS, RANK_S_PLUS } from '../shared/data.js';
import { shade } from './view.js';

export class MapView {
  constructor(game) {
    this.game = game;
    this.hutX = MAP.nodes[0][0]; this.hutZ = MAP.nodes[0][1];
    this.vx = 0; this.vz = 0;
    this.facing = 1;
    this.run = 0;
    this.placed = false;
  }

  get moving() { return Math.hypot(this.vx, this.vz) > 0.7; }

  update(dt, hut) {
    if (!hut) return;
    if (!this.placed) { [this.hutX, this.hutZ] = hut; this.placed = true; }
    // Сглаживание сетевых обновлений позиции.
    const k = 1 - Math.exp(-dt / 0.08);
    const nx = this.hutX + (hut[0] - this.hutX) * k, nz = this.hutZ + (hut[1] - this.hutZ) * k;
    this.vx = (nx - this.hutX) / Math.max(dt, 1e-3); this.vz = (nz - this.hutZ) / Math.max(dt, 1e-3);
    this.hutX = nx; this.hutZ = nz;
    if (Math.abs(this.vx) > 0.5) this.facing = Math.sign(this.vx);
    this.run += Math.sign((this.moving ? 1 : 0) - this.run) * Math.min(Math.abs((this.moving ? 1 : 0) - this.run), dt * 6);
  }

  draw() {
    const { view, now, session } = this.game;
    const ctx = view.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14110f';
    ctx.fillRect(0, 0, view.w, view.h);

    view.groundRect(4, 0, 70, 36, '#29241f');
    for (const r of MAP.regions) view.groundRect(r.x, r.z, r.w, r.d, r.color);
    // Огненная река Смородина.
    const flow = Math.sin(now * 2) * 0.1;
    view.groundRect(MAP.river.x, 0, MAP.river.w, 22, '#f25a1a');
    view.groundRect(MAP.river.x + flow, 0, MAP.river.w * 0.5, 22, 'rgba(255,190,60,0.55)');
    view.groundRect(MAP.bridge.x, MAP.bridge.z, MAP.bridge.w, MAP.bridge.d, '#73472a');
    view.label(MAP.river.x, -8, 0.3, 'река Смородина', '#ff9a4d', 0.5);
    // Золотая лестница.
    for (let i = 0; i < 3; i++) view.box(MAP.stairs.x + i * 0.6, MAP.stairs.z, 0.6, 2, 0.2 + i * 0.24, '#e6bf59', -0.05);

    // Дороги — просто рисунок: бегать можно где угодно.
    ctx.strokeStyle = 'rgba(230,205,150,0.55)';
    ctx.lineWidth = view.s * 0.35;
    ctx.setLineDash([view.s * 0.6, view.s * 0.4]);
    for (const [a, b] of MAP.edges) {
      const [x0, y0] = view.project(...MAP.nodes[a]), [x1, y1] = view.project(...MAP.nodes[b]);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.setLineDash([]);

    const results = session?.results ?? [];
    const unlocked = (w) => this.game.isWorldUnlocked(w);
    // Логова.
    MAP.nodes.forEach(([x, z], i) => {
      const boss = BOSSES[i - 1];
      const open = i === 0 || unlocked(boss.world);
      const color = i === 0 ? '#d9b373' : open ? ['#f2cc4d', '#9a4de6', '#80ccff'][boss.world] : '#555';
      view.groundEllipse(x, z, 1.2, 1.2, shade(color, 0.7));
      view.groundEllipse(x, z, 1.0, 1.0, color);
      if (i > 0 && results[i - 1] >= 0) view.groundEllipse(x, z, 0.45, 0.45, '#fff2b3');
    });
    // Преграды закрытых миров: огненный туман у моста и сияние у лестницы.
    for (const b of MAP.barriers) {
      if (unlocked(b.world)) continue;
      for (let i = -1; i <= 1; i++) {
        const flick = 0.85 + Math.sin(now * 8 + i) * 0.15;
        view.cylinder(b.x, b.z + i * 0.9, 0.3, 2.4 * flick, b.color.length === 7 ? b.color : '#ff6619');
      }
    }

    this.drawHut(view, now);

    // Подписи.
    MAP.nodes.forEach(([x, z], i) => {
      if (i === 0) { view.label(x, z, 2.2, 'Распутье', '#fff', 0.45); return; }
      const boss = BOSSES[i - 1];
      if (!unlocked(boss.world)) { view.label(x, z, 2.2, '???', '#8c8080', 0.45); return; }
      const best = results[i - 1], rank = session?.ranks?.[i - 1] ?? -1;
      // Победа: лучшая сложность и рейтинг; за S+ — звёздочка.
      const line = best >= 0 ? `\n✓ ${DIFFICULTIES[best].name}${rank >= 0 ? ` · ${RANKS[rank].name}` : ''}` : '';
      view.label(x, z, 2.2, `${boss.name}${line}`, best >= 0 ? '#ffd966' : '#fff', 0.45);
      if (rank === RANK_S_PLUS) view.label(x, z, 3.5, '★', '#ffcf3a', 0.9);
    });
    for (const b of MAP.barriers) if (!unlocked(b.world)) view.label(b.x, b.z, 3.2, b.text, b.color, 0.42);

    view.lighting(0.9, [], null, now);
  }

  /** Избушка на курьих ножках: на бегу перебирает ногами и подпрыгивает, на месте покачивается. */
  drawHut(view, now) {
    const ctx = view.ctx, s = view.s;
    const [px, py] = view.project(this.hutX, this.hutZ);
    const step = Math.sin(now * 16) * this.run;
    const idle = Math.sin(now * 2) * (1 - this.run);
    view.groundEllipse(this.hutX, this.hutZ, 1.1, 0.8, 'rgba(0,0,0,0.35)');
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(this.facing, 1);
    const leg = (x, swing) => {
      ctx.save();
      ctx.translate(x * s, -1.25 * s);
      ctx.rotate(swing);
      ctx.strokeStyle = '#d99a40'; ctx.lineWidth = 0.16 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0.1 * s, 0.6 * s); ctx.lineTo(-0.05 * s, 1.2 * s); ctx.stroke();
      ctx.lineWidth = 0.08 * s;
      for (const t of [-0.3, 0, 0.3]) { ctx.beginPath(); ctx.moveTo(-0.05 * s, 1.2 * s); ctx.lineTo((-0.05 + 0.35) * s, (1.2 + t * 0.3) * s); ctx.stroke(); }
      ctx.restore();
    };
    leg(-0.45, step * 0.6);
    leg(0.45, -step * 0.6);
    const lift = Math.abs(step) * 0.25 + idle * 0.05;
    ctx.translate(0, -lift * s);
    ctx.rotate(idle * 0.03);
    // Сруб.
    ctx.fillStyle = '#80542e';
    ctx.fillRect(-0.95 * s, -2.6 * s, 1.9 * s, 1.35 * s);
    ctx.strokeStyle = 'rgba(40,20,10,0.6)'; ctx.lineWidth = 0.04 * s;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-0.95 * s, (-2.6 + i * 0.27) * s); ctx.lineTo(0.95 * s, (-2.6 + i * 0.27) * s); ctx.stroke(); }
    // Крыша.
    ctx.fillStyle = '#4d331f';
    ctx.beginPath(); ctx.moveTo(-1.2 * s, -2.55 * s); ctx.lineTo(0, -3.55 * s); ctx.lineTo(1.2 * s, -2.55 * s); ctx.closePath(); ctx.fill();
    // Дверь и светящееся окошко.
    ctx.fillStyle = '#40260f'; ctx.fillRect(-0.55 * s, -2.0 * s, 0.45 * s, 0.75 * s);
    ctx.fillStyle = '#ffd966'; ctx.fillRect(0.25 * s, -2.25 * s, 0.38 * s, 0.38 * s);
    ctx.restore();
  }
}
