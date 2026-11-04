// Карта на столе в таверне (минималистичная, как в Cuphead): три мира слева направо, река Смородина
// с Калиновым мостом, золотая лестница в Правь, логова боссов. По ней свободно бегает избушка на курьих ножках.
import { MAP } from '../shared/scenes.js';
import { BOSSES, DIFFICULTIES, RANKS, RANK_S_PLUS } from '../shared/data.js';
import { shade, SIN } from './view.js';
import { assets } from './assets.js';
import { drawHut, drawYaga } from './yagaview.js';

/** Во сколько раз избушка на карте меньше настоящей. */
const HUT_SCALE = 0.42;

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
    for (const r of MAP.regions) this.drawRegion(view, r);
    this.drawRiver(view, now);
    view.label(MAP.river.x, -8, 0.3, 'река Смородина', '#ffb36e', 0.5);

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
    // Логова лежат на земле, поверх них всё, что стоит.
    MAP.nodes.forEach(([x, z], i) => {
      const boss = BOSSES[i - 1];
      const open = i === 0 || unlocked(boss.world);
      // Логово Яги — вне миров, свой цвет.
      const color = i === 0 ? '#d9b373' : !open ? '#555' : ['#f2cc4d', '#9a4de6', '#80ccff'][boss.world] ?? '#c2553a';
      view.groundEllipse(x, z, 1.2, 1.2, shade(color, 0.7));
      view.groundEllipse(x, z, 1.0, 1.0, color);
      if (i > 0 && results[i - 1] >= 0) view.groundEllipse(x, z, 0.45, 0.45, '#fff2b3');
    });
    // Предметы и избушка закрывают друг друга по дальности.
    const drawables = MAP.decor.map(([name, x, z, height, lift = 0]) => ({ z, draw: () => this.sprite(view, name, x, z, height, lift) }));
    drawables.push({ z: MAP.bridge.z, draw: () => this.sprite(view, 'bridge_kalinov', MAP.bridge.x, MAP.bridge.z - 1.2, 3.1) });
    drawables.push({ z: MAP.stairs.z, draw: () => this.sprite(view, 'stairs_golden', MAP.stairs.x + 0.6, MAP.stairs.z - 1, 5) });
    const yaga = MAP.nodes[MAP.nodes.length - 1];
    drawables.push({ z: yaga[1], draw: () => drawYaga(this.game, { x: yaga[0], z: yaga[1], fx: 1, pose: 'Hover', airborne: true, onRoof: false, flyY: 0.9 + Math.sin(now * 3) * 0.1 }) });
    // Преграды закрытых миров: огненный туман у моста и сияние у лестницы.
    for (const b of MAP.barriers) {
      if (unlocked(b.world)) continue;
      drawables.push({ z: b.z - 1.3, draw: () => {
        for (let i = -1; i <= 1; i++) {
          const flick = 0.85 + Math.sin(now * 8 + i) * 0.15;
          view.cylinder(b.x, b.z + i * 0.9, 0.3, 2.4 * flick, b.color.length === 7 ? b.color : '#ff6619');
        }
      } });
    }
    drawables.push({ z: this.hutZ, draw: () => this.drawHut(view, now) });
    drawables.sort((a, b) => b.z - a.z);
    for (const d of drawables) d.draw();

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

  /** Предмет на карте: низ картинки стоит в точке (x, z). */
  sprite(view, name, x, z, height, lift = 0) {
    const image = assets.image(`map/${name}.png`);
    if (!image?.naturalWidth) return;
    const [px, py] = view.project(x, z), h = height * view.s, w = h * image.naturalWidth / image.naturalHeight;
    view.ctx.drawImage(image, px - w / 2, py - lift * view.s - h, w, h);
  }

  /** Земля мира: цвет, а поверх него, если есть, приглушённый рисунок. Собирается один раз. */
  drawRegion(view, r) {
    view.groundRect(r.x, r.z, r.w, r.d, r.color);
    const image = r.ground && assets.image(r.ground);
    if (!image?.naturalWidth) return;
    if (!r.baked) {
      const density = 40, tile = r.tile * density;
      r.baked = document.createElement('canvas');
      r.baked.width = r.w * density; r.baked.height = Math.round(r.d * SIN * density);
      const bake = r.baked.getContext('2d');
      bake.globalAlpha = 0.55;
      for (let x = 0; x < r.baked.width; x += tile) for (let y = 0; y < r.baked.height; y += tile * SIN) bake.drawImage(image, x, y, tile, tile * SIN);
    }
    const [x0, y0] = view.project(r.x - r.w / 2, r.z + r.d / 2), [x1, y1] = view.project(r.x + r.w / 2, r.z - r.d / 2);
    view.ctx.drawImage(r.baked, x0, y0, x1 - x0, y1 - y0);
  }

  /** Огненная река сверху вниз, медленно течёт. */
  drawRiver(view, now) {
    const image = assets.image('map/river_smorodina.png');
    const ctx = view.ctx;
    if (!image?.naturalWidth) { view.groundRect(MAP.river.x, 0, MAP.river.w, 22, '#f25a1a'); return; }
    const width = MAP.river.w * 2 * view.s, tile = width * image.naturalHeight / image.naturalWidth;
    const [px, top] = view.project(MAP.river.x, 11), [, bottom] = view.project(MAP.river.x, -11);
    ctx.save();
    ctx.beginPath(); ctx.rect(px - width / 2, top, width, bottom - top); ctx.clip();
    for (let y = top - tile + (now * view.s * 0.5) % tile; y < bottom; y += tile) ctx.drawImage(image, px - width / 2, y, width, tile + 1);
    ctx.restore();
  }

  /** Избушка на курьих ножках: те же рисунки, что и в бою, только меньше. На бегу перебирает ногами и подпрыгивает. */
  drawHut(view, now) {
    const ctx = view.ctx;
    const [px, py] = view.project(this.hutX, this.hutZ);
    const bounce = Math.abs(Math.sin(now * 16)) * this.run * 0.2 * view.s, sway = Math.sin(now * 2) * (1 - this.run) * 0.02;
    ctx.save();
    ctx.translate(px, py - bounce);
    ctx.rotate(sway);
    ctx.scale(HUT_SCALE, HUT_SCALE);
    ctx.translate(-px, -py);
    drawHut(this.game, { x: this.hutX, z: this.hutZ, moving: this.run > 0.2, charging: this.run > 0.2, onMap: true });
    ctx.restore();
  }
}
