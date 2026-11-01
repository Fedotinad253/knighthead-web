// Баба-Яга — первый босс игры. Победив её, богатырь забирает избушку.
// Фаза 1 «Ступа»: летает, пикирует и вязнет в земле, кости с забора, пыль от метлы, «русский дух».
// Фаза 2 «Избушка»: Яга на крыше неуязвима, бьётся избушка. Три удара по ногам — избушка падает, Ягу можно бить.
// Фаза 3 «Печь»: избушка садится, Яга у печи: лопата (тащит в печь), огонь, рывок, гуси-лебеди.
// Конец: Яга без сил, богатырь говорит заветные слова — сценка, и избушка теперь его.
import { Tasks } from './tasks.js';
import { Health } from './health.js';

const P = {
  health: 900,
  hoverRadius: 9, hoverSpeed: 8, pause: 0.9,
  diveSpeed: 18, diveDamage: 15, diveTelegraph: 0.8, stuckWindow: 2,
  boneSpeed: 9, boneDamage: 10,
  dustLife: 3, sniffTime: 1.2, sniffMoved: 1.5, sniffDamage: 15,
  hutSpeed: 4, hutRunSpeed: 13, hutRadius: 2.6, stompRadius: 2.4, stompDamage: 18, runDamage: 20, peckDamage: 12, peckRange: 4.5,
  legHits: 3, fallWindow: 4,
  riderSpeed: 13, riderDamage: 14, fireDamage: 8, darkTime: 4,
  shovelSpeed: 12, shovelDamage: 30, struggle: 6,
  fireLife: 4, stoveFireDamage: 10,
  dashSpeed: 14, dashDamage: 14, restWindow: 2,
  gooseSpeed: 13, gooseDamage: 8,
  fenceRadius: 14.2, fenceDamage: 8, gateRadius: 3.5, gateDamage: 15, gateEvery: 3.5,
  knockdown: 3,
};

/** Позы, в которых Яга открыта для ударов (для Медвежьего когтя). */
const VULNERABLE = new Set(['Stuck', 'Stunned', 'Tired', 'Exhausted']);

const rand = (a, b) => a + Math.random() * (b - a);
const norm = (x, z) => { const l = Math.hypot(x, z); return l > 1e-5 ? [x / l, z / l] : [0, 0]; };
const rotate = (x, z, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
};
const r2 = (v) => Math.round(v * 100) / 100;

export class Yaga {
  constructor(game, difficulty) {
    this.game = game;
    this.kind = 'yaga';
    this.name = 'Баба-Яга';
    this.d = difficulty;
    this.scene = game.sceneData;
    const spawn = this.scene.bossSpawn;
    this.x = spawn.x; this.z = spawn.z; this.fx = spawn.fx; this.fz = spawn.fz;
    this.radius = 0.7;
    this.pose = 'Hover';
    this.phase = 1;
    this.airborne = true;
    this.onRoof = false;
    this.transition = false;
    this.cutscene = false;
    this.finisherReady = false;
    this.finisher = null;
    this.dead = false;
    this.claws = { id: 'claws', active: false, token: 0, damage: 0, r: 1.3, forward: 0.6 };
    this.nextGateAt = game.clock.now + P.gateEvery;
    this.gateStrikeAt = 0;

    const home = this.scene.hutHome;
    this.hut = { x: home.x, z: home.z, active: false, fallen: false, seated: true, turnedUntil: 0, legHits: 0, moving: false, charging: false, token: 0 };

    this.health = new Health(P.health * difficulty.bossHealth);
    this.health.onDepleted = () => this.onDepleted();
    this.setPhase(1, 2 / 3);

    this.tasks = new Tasks(game.clock);
    this.tasks.start(this.start());
  }

  get now() { return this.game.clock.now; }
  get dt() { return this.game.clock.dt; }
  get atFloor() { return this.health.hp <= this.health.floor + 0.5; }
  /** Подсказка длится дольше с оберегом «Череп с забора». */
  tele(s) { return s / Math.max(0.1, this.d.attackSpeed) * (this.game.anyPlayer()?.charm === 'skull' ? 1.25 : 1); }
  fast(v) { return v * Math.sqrt(Math.max(0.1, this.d.attackSpeed)); }
  has(curse) { return this.game.curses.has(curse); }
  get vulnerable() { return !this.dead && VULNERABLE.has(this.pose); }
  /** Ближним оружием в воздухе и на крыше не достать. */
  get meleeImmune() { return this.airborne; }
  /** Стрелы в летящую Ягу бьют вполсилы. */
  get arrowFactor() { return this.airborne ? 0.5 : 1; }
  get contactDamage() { return 0; }
  get hutChargeDamage() { return this.hut.charging ? P.runDamage : 0; }

  /** Прижавшегося к забору кости ранят, с маслом для ворот — нет. */
  fenceDamage(player) { return player.charm === 'oil' ? 0 : P.fenceDamage; }

  setPhase(phase, floorFraction) {
    this.phase = phase;
    this.health.floor = phase === 3 ? 1 : this.health.max * floorFraction;
    this.health.invulnerable = false;
    this.game.log(`Яга: фаза ${phase}`);
  }

  update() {
    this.tasks.update();
    if (this.onRoof) { this.x = this.hut.x; this.z = this.hut.z; }
    this.updateGate();
  }

  /** Ворота-пасть кусают тех, кто подошёл близко. */
  updateGate() {
    const { game, now } = this, gate = this.scene.gate;
    if (this.dead || this.cutscene) return;
    if (this.gateStrikeAt && now >= this.gateStrikeAt) {
      this.gateStrikeAt = 0;
      game.spawnZone(gate.x, gate.z, P.gateRadius, 'strike', 0.15, P.gateDamage, 0, 'claws');
    }
    if (now < this.nextGateAt) return;
    this.nextGateAt = now + P.gateEvery;
    const near = game.alivePlayers().some((p) => p.charm !== 'oil' && Math.hypot(p.x - gate.x, p.z - gate.z) < P.gateRadius);
    if (!near) return;
    game.telegraphCircle(gate.x, gate.z, P.gateRadius, 0.55, 'danger');
    this.gateStrikeAt = now + 0.55;
  }

  snapshot() {
    const h = this.hut;
    return {
      kind: this.kind, name: this.name, x: r2(this.x), z: r2(this.z), fx: r2(this.fx), fz: r2(this.fz),
      hp: Math.round(this.health.hp), max: Math.round(this.health.max), pose: this.pose, phase: this.phase,
      airborne: this.airborne, onRoof: this.onRoof, cutscene: this.cutscene,
      finisherReady: this.finisherReady, finisherLabel: 'Сказать заветные слова',
      claws: this.claws.active ? { token: this.claws.token, damage: this.claws.damage } : null,
      contact: 0, fenceR: P.fenceRadius, gateBite: this.gateStrikeAt > 0, stoveLit: this.phase === 3,
      hut: { x: r2(h.x), z: r2(h.z), active: h.active, fallen: h.fallen, seated: h.seated, moving: h.moving,
        turned: h.turnedUntil > this.now, charging: h.charging, token: h.token, legHits: h.legHits, r: P.hutRadius },
      phaseMarks: [2 / 3, 1 / 3],
    };
  }

  applyDamage(amount) { return this.health.apply(amount, (dealt) => this.game.showDamage(this.x, this.z, dealt)); }

  // ---------------------------------------------------------------- Ход боя

  *start() {
    yield 1.2;
    yield* this.fight();
  }

  /** Бой идёт по текущей фазе, поэтому его можно прервать (сбили на землю) и продолжить с того же места. */
  *fight() {
    while (!this.dead) {
      if (this.phase === 1) {
        if (this.atFloor) { yield* this.raiseHut(); this.setPhase(2, 1 / 3); this.health.invulnerable = true; continue; }
        yield* this.airStep();
      } else if (this.phase === 2) {
        if (this.atFloor) { yield* this.hutSits(); this.setPhase(3, 0); continue; }
        yield* this.hutStep();
      } else {
        if (this.atFloor) { yield* this.exhausted(); return; }
        yield* this.stoveStep();
      }
    }
  }

  /** Прервать текущую атаку и выполнить другое действие, затем бой продолжается. */
  interrupt(action) {
    this.tasks.stopAll();
    this.clawsOff();
    this.hut.charging = false;
    this.hut.moving = false;
    const self = this;
    this.tasks.start((function* () { yield* action; yield* self.fight(); })());
  }

  /**
   * Следующая атака: случайно, но каждая встретится и одна и та же не пойдёт два раза подряд.
   * first — с какой атаки начать первый раз.
   */
  nextAttack(name, attacks, first = null) {
    const bag = (this.bags ??= {})[name] ??= { left: first ? [first] : [], last: null };
    if (!bag.left.length) {
      bag.left = [...attacks];
      for (let i = bag.left.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag.left[i], bag.left[j]] = [bag.left[j], bag.left[i]]; }
      if (bag.left.length > 1 && bag.left[bag.left.length - 1] === bag.last) bag.left.reverse();
    }
    bag.last = bag.left.pop();
    return bag.last;
  }

  *wait(seconds) {
    const end = this.now + seconds;
    while (this.now < end && !this.dead) yield;
  }

  pickTarget() {
    const alive = this.game.alivePlayers();
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
  }

  clawsOn(damage) { this.claws.damage = damage; this.claws.token++; this.claws.active = true; }
  clawsOff() { this.claws.active = false; }
  face(dx, dz) { const [x, z] = norm(dx, dz); if (x || z) { this.fx = x; this.fz = z; } }

  clampToArena(x, z) {
    const r = this.scene.bossRadius, d = Math.hypot(x, z);
    return d > r ? [x * r / d, z * r / d] : [x, z];
  }

  /** Гребешок и соль преграждают путь. */
  blockedAt(x, z, pad) { return this.game.effectAt('comb', x, z, pad) || this.game.effectAt('salt', x, z, pad); }
  /** На горохе и в реке из рушника всё вязнет. */
  slowAt(x, z) { return this.game.effectAt('peas', x, z) || this.game.effectAt('towel', x, z) ? 0.5 : 1; }

  /** Шаг Яги: возвращает false, если упёрлась в преграду. */
  stepYaga(dx, dz, distance) {
    const step = distance * this.slowAt(this.x, this.z);
    const [nx, nz] = this.clampToArena(this.x + dx * step, this.z + dz * step);
    if (this.blockedAt(nx, nz, this.radius)) return false;
    this.x = nx; this.z = nz;
    return true;
  }

  // ---------------------------------------------------------------- Фаза 1: ступа

  *airStep() {
    const target = this.pickTarget();
    if (!target) { yield* this.wait(0.5); return; }
    this.pose = 'Hover';
    this.airborne = true;
    yield* this.hover();
    if (this.atFloor) return;
    yield* this[this.nextAttack('air', ['dive', 'bones', 'broom', 'sniff'])]();
  }

  *hover() {
    const a = Math.random() * Math.PI * 2, r = rand(3, P.hoverRadius);
    const tx = Math.sin(a) * r, tz = Math.cos(a) * r;
    const end = this.now + P.pause / this.d.attackSpeed;
    while (this.now < end && !this.dead) {
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      if (d > 0.2) { this.face(dx, dz); this.x += dx / d * Math.min(d, P.hoverSpeed * this.dt); this.z += dz / d * Math.min(d, P.hoverSpeed * this.dt); }
      yield;
    }
  }

  *dive() {
    const times = this.d.extra ? 2 : 1;
    for (let i = 0; i < times && !this.atFloor; i++) {
      const target = this.pickTarget();
      if (!target) return;
      const [dx, dz] = norm(target.x - this.x, target.z - this.z);
      const length = Math.min(Math.hypot(target.x - this.x, target.z - this.z) + 2.5, 24);
      this.face(dx, dz);
      this.pose = 'Aim';
      this.airborne = true;
      this.game.telegraphLine(this.x, this.z, dx, dz, length, 1.8, this.tele(P.diveTelegraph));
      yield* this.wait(this.tele(P.diveTelegraph));
      this.pose = 'Dive';
      this.clawsOn(P.diveDamage);
      let travelled = 0;
      const speed = this.fast(P.diveSpeed);
      while (travelled < length && !this.dead) {
        const step = speed * this.dt;
        if (!this.stepYaga(dx, dz, step)) break;
        travelled += step;
        yield;
      }
      this.clawsOff();
      if (this.dead) return;
      // Ступа увязла в земле — главное окно для ударов.
      this.airborne = false;
      this.pose = 'Stuck';
      this.game.shake(0.25, 0.3);
      this.game.floatText(this.x, this.z, 2.6, 'Завязла!', '#ffd94d', 1.2);
      yield* this.wait(P.stuckWindow * (this.d.extra ? 0.7 : 1));
      this.airborne = true;
      this.pose = 'Hover';
    }
  }

  /** Череп на заборе у богатыря стреляет веером костей, среднюю можно парировать. */
  *bones() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Cast';
    const a = Math.atan2(target.x, target.z) + rand(-0.5, 0.5);
    const sx = Math.sin(a) * P.fenceRadius, sz = Math.cos(a) * P.fenceRadius;
    const [dx, dz] = norm(target.x - sx, target.z - sz);
    this.game.telegraphLine(sx, sz, dx, dz, 8, 1.2, this.tele(0.55), 'parry');
    this.game.flash(sx, sz, 0.8);
    yield* this.wait(this.tele(0.55));
    const count = this.d.extra ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const [fx, fz] = rotate(dx, dz, (i - (count - 1) / 2) * 14);
      this.game.fireEnemy(sx, sz, fx, fz, P.boneSpeed * this.d.projectileSpeed, P.boneDamage, i === Math.floor(count / 2), 4, 1.2, 'bone');
    }
    yield* this.wait(0.4);
  }

  /** Метла поднимает пыль: под ней не видно подсказок атак. */
  *broom() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Cast';
    this.game.floatText(this.x, this.z, 3.2, 'Метёт!', '#d9cfa8', 1);
    yield* this.wait(this.tele(0.4));
    const [dx, dz] = norm(target.x - this.x, target.z - this.z);
    const count = this.has('swept') ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 3.2;
      const [x, z] = this.clampToArena(target.x + -dz * offset, target.z + dx * offset);
      this.game.addEffect('dust', x, z, 2.4, P.dustLife);
    }
    yield* this.wait(0.3);
  }

  /** «Фу-фу, русским духом пахнет!» — кто остался на месте, того она находит. */
  *sniff() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Sniff';
    const x0 = target.x, z0 = target.z;
    this.game.floatText(this.x, this.z, 3.4, 'Фу-фу, русским духом пахнет!', '#ffb066', P.sniffTime + 0.3);
    yield* this.wait(this.tele(P.sniffTime));
    if (this.dead || Math.hypot(target.x - x0, target.z - z0) >= P.sniffMoved) {
      this.game.floatText(this.x, this.z, 3.2, 'Где ты, молодец?', '#d9cfa8', 1);
      return;
    }
    this.game.telegraphCircle(target.x, target.z, 1.6, this.tele(0.45), 'danger');
    const x = target.x, z = target.z;
    yield* this.wait(this.tele(0.45));
    this.game.spawnZone(x, z, 1.6, 'strike', 0.15, P.sniffDamage, 0, 'dust');
  }

  // ---------------------------------------------------------------- Фаза 2: избушка

  *raiseHut() {
    this.transition = true;
    this.clawsOff();
    this.health.invulnerable = true;
    this.pose = 'Cast';
    this.game.announce('Избушка, вставай!');
    this.game.shake(0.5, 1.6);
    this.hut.seated = false;
    this.hut.active = true;
    yield* this.wait(1.6);
    this.onRoof = true;
    this.airborne = true;
    this.transition = false;
  }

  *hutStep() {
    const hut = this.hut, target = this.pickTarget();
    if (!target) { yield* this.wait(0.5); return; }
    // Заговор «Повернись, избушка!» — отворачивается и не нападает.
    if (hut.turnedUntil > this.now) { yield* this.wait(0.3); return; }
    // Проверка без людей: избушка падает сама.
    if (this.game.flags.debugwin && this.onRoof) { this.hitHut(P.legHits); yield; return; }
    yield* this.wait(0.7 / this.d.attackSpeed);
    if (this.atFloor) return;
    const distance = Math.hypot(target.x - hut.x, target.z - hut.z);
    if (distance < P.peckRange && Math.random() < 0.35) { yield* this.peck(target); return; }
    // Первыми в этой фазе выезжают всадники.
    yield* this[this.nextAttack('hut', ['stomp', 'run', 'riders'], 'riders')](target);
  }

  stepHut(dx, dz, distance) {
    const hut = this.hut, step = distance * this.slowAt(hut.x, hut.z);
    const [nx, nz] = this.clampToArena(hut.x + dx * step, hut.z + dz * step);
    if (this.blockedAt(nx, nz, P.hutRadius)) return false;
    hut.x = nx; hut.z = nz;
    return true;
  }

  get hutPace() { return this.has('furious') ? 1.33 : 1; }

  *stomp(target) {
    const hut = this.hut;
    const walkUntil = this.now + 1.5;
    hut.moving = true;
    while (this.now < walkUntil && !this.dead && Math.hypot(target.x - hut.x, target.z - hut.z) > 6) {
      const [dx, dz] = norm(target.x - hut.x, target.z - hut.z);
      this.stepHut(dx, dz, this.fast(P.hutSpeed) * this.hutPace * this.dt);
      yield;
    }
    hut.moving = false;
    for (let i = 0; i < (this.d.extra ? 2 : 1) && !this.dead; i++) {
      const x = target.x, z = target.z;
      this.game.telegraphCircle(x, z, P.stompRadius, this.tele(0.75), 'danger');
      yield* this.wait(this.tele(0.75));
      this.game.spawnZone(x, z, P.stompRadius, 'strike', 0.15, P.stompDamage, 0, 'ring');
      this.game.shake(0.3, 0.25);
    }
  }

  *run(target) {
    const hut = this.hut, R = this.scene.bossRadius;
    const [dx, dz] = norm(target.x - hut.x, target.z - hut.z);
    // До забора: решение квадратного уравнения пересечения луча с кругом арены.
    const b = hut.x * dx + hut.z * dz, c = hut.x * hut.x + hut.z * hut.z - R * R;
    const length = Math.max(4, -b + Math.sqrt(Math.max(0, b * b - c)));
    this.game.telegraphLine(hut.x, hut.z, dx, dz, length, 3.6, this.tele(0.9));
    yield* this.wait(this.tele(0.9));
    hut.charging = true;
    hut.moving = true;
    hut.token++;
    let travelled = 0;
    const speed = this.fast(P.hutRunSpeed) * this.hutPace;
    while (travelled < length && !this.dead) {
      const step = speed * this.dt;
      if (!this.stepHut(dx, dz, step)) break;
      travelled += step;
      yield;
    }
    hut.charging = false;
    hut.moving = false;
    this.game.shake(0.35, 0.3);
    yield* this.wait(1.2 / this.d.attackSpeed);
  }

  /** Клевок ногой: быстрый удар, его можно парировать. */
  *peck(target) {
    const hut = this.hut;
    const [dx, dz] = norm(target.x - hut.x, target.z - hut.z);
    this.game.telegraphLine(hut.x, hut.z, dx, dz, P.peckRange + 1, 1.1, this.tele(0.4), 'parry');
    yield* this.wait(this.tele(0.4));
    this.game.fireEnemy(hut.x + dx * 2, hut.z + dz * 2, dx, dz, 22, P.peckDamage, true, 0.3, 0.8, 'peck');
    yield* this.wait(0.4);
  }

  /** Три всадника: белый бьёт, красный оставляет огненный след, после чёрного темнеет. */
  *riders(target) {
    const rounds = this.d.extra ? 2 : 1;
    const R = this.scene.bounds.r;
    this.game.announce('Три всадника!');
    for (let round = 0; round < rounds; round++) {
      for (const kind of ['rider_white', 'rider_red', 'rider_black']) {
        if (this.dead) return;
        // Въезжает через забор на одном краю поляны и уезжает через другой, по полосе через богатыря.
        const a = Math.random() * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
        const b = target.x * dx + target.z * dz, root = Math.sqrt(Math.max(0, b * b - (target.x * target.x + target.z * target.z - R * R)));
        const behind = b + root, length = behind + root - b;
        const sx = target.x - dx * behind, sz = target.z - dz * behind;
        this.game.telegraphLine(sx, sz, dx, dz, length, 2.2, this.tele(0.8));
        yield* this.wait(this.tele(0.8));
        const speed = P.riderSpeed, life = length / speed;
        this.game.spawnWide(sx, sz, dx, dz, speed, 1.1, P.riderDamage, life, kind);
        if (kind === 'rider_red') this.tasks.start(this.fireTrail(sx, sz, dx, dz, speed, life));
        if (kind === 'rider_black') {
          const game = this.game;
          this.tasks.start((function* () { yield life * 0.6; game.darkUntil = game.clock.now + P.darkTime; })());
        }
        yield* this.wait(0.7);
      }
    }
  }

  *fireTrail(sx, sz, dx, dz, speed, duration) {
    const start = this.now, life = (this.has('hungry') ? 2 : 1) * 3;
    while (!this.dead && this.now - start < duration) {
      const t = (this.now - start) * speed, x = sx + dx * t, z = sz + dz * t;
      if (Math.hypot(x, z) < this.scene.bossRadius) this.game.spawnZone(x, z, 0.9, 'fire', life, P.fireDamage);
      yield 0.12;
    }
  }

  /** Попали по ноге избушки. Три раза — падает, Яга слетает с крыши. weight: стрела считается за половину. */
  hitHut(weight = 1) {
    const hut = this.hut;
    if (!hut.active || hut.fallen || hut.seated || this.dead || !this.onRoof) return;
    hut.legHits += weight;
    this.game.showDamage(hut.x, hut.z, Math.floor(hut.legHits));
    if (hut.legHits >= P.legHits) this.interrupt(this.hutFall());
  }

  *hutFall() {
    const hut = this.hut;
    hut.fallen = true;
    hut.legHits = 0;
    this.onRoof = false;
    this.airborne = false;
    this.health.invulnerable = false;
    [this.x, this.z] = this.clampToArena(hut.x, hut.z - P.hutRadius - 0.8);
    this.pose = 'Stunned';
    this.game.shake(0.6, 0.5);
    this.game.floatText(this.x, this.z, 3, 'Рухнула!', '#ffd94d', 1.6);
    yield* this.wait(P.fallWindow * (this.d.extra ? 0.75 : 1));
    hut.fallen = false;
    if (!this.atFloor) {
      this.onRoof = true;
      this.airborne = true;
      this.pose = 'Cast';
      this.health.invulnerable = true;
    }
  }

  /** Сбили верёвкой: падает на землю и какое-то время открыта. */
  *knockedDown(seconds) {
    this.onRoof = false;
    this.airborne = false;
    this.health.invulnerable = false;
    this.pose = 'Stunned';
    yield* this.wait(seconds);
    if (this.phase === 2 && !this.atFloor && this.hut.active) {
      this.onRoof = true;
      this.health.invulnerable = true;
      this.pose = 'Cast';
    }
    this.airborne = this.phase !== 3;
    if (this.phase === 1) this.pose = 'Hover';
  }

  *hutSits() {
    this.transition = true;
    const hut = this.hut, home = this.scene.hutHome;
    hut.fallen = false;
    hut.moving = true;
    this.onRoof = false;
    this.health.invulnerable = true;
    this.game.announce('Избушка устала, Яга у печи!');
    const end = this.now + 2;
    while (this.now < end && !this.dead) {
      const dx = home.x - hut.x, dz = home.z - hut.z, d = Math.hypot(dx, dz);
      if (d > 0.1) { hut.x += dx / d * Math.min(d, 6 * this.dt); hut.z += dz / d * Math.min(d, 6 * this.dt); }
      yield;
    }
    hut.moving = false;
    hut.active = false;
    hut.seated = true;
    const stove = this.scene.stove;
    this.x = stove.x; this.z = stove.z - 2.2;
    this.airborne = false;
    this.pose = 'Stand';
    this.transition = false;
  }

  // ---------------------------------------------------------------- Фаза 3: печь

  *stoveStep() {
    if (!this.pickTarget()) { yield* this.wait(0.5); return; }
    this.pose = 'Stand';
    yield* this.wait(P.pause / this.d.attackSpeed);
    if (this.atFloor) return;
    yield* this[this.nextAttack('stove', ['shovel', 'ovenFire', 'dash', 'geese'])]();
  }

  /** Лопата едет по полосе и тащит пойманного в печь. */
  *shovel() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Cast';
    const stove = this.scene.stove;
    const sx = stove.x, sz = stove.z - 1.6;
    const [dx, dz] = norm(target.x - sx, target.z - sz);
    const length = Math.min(Math.hypot(target.x - sx, target.z - sz) + 3, 26);
    this.face(dx, dz);
    this.game.telegraphLine(sx, sz, dx, dz, length, 1.8, this.tele(0.7));
    yield* this.wait(this.tele(0.7));
    this.game.spawnWide(sx, sz, dx, dz, P.shovelSpeed * this.d.projectileSpeed, 0.9, 0, length / P.shovelSpeed, 'shovel', { grab: true, consume: true });
    yield* this.wait(length / P.shovelSpeed + 0.2);
    // Пока кого-то тащит, она занята этим.
    while (!this.dead && this.game.players.some((p) => p.drag?.source === 'shovel')) yield;
  }

  /** Попала лопата: тащит к печи. Вырвался — цел, дотащила — большой урон. */
  grab(player) {
    if (player.charm === 'doll' && !player.dollUsed) {
      player.dollUsed = true;
      this.game.floatText(player.x, player.z, 2.9, 'Куколка вырвала!', '#ffd94d', 1.6);
      return;
    }
    const stove = this.scene.stove;
    this.game.floatText(player.x, player.z, 2.9, 'На лопату!', '#ff8a50', 1.2);
    this.game.dragPlayer(player, stove.x, stove.z - 2.2, 7, P.struggle, 'shovel', () => {
      this.game.damagePlayer(player, P.shovelDamage);
      this.game.floatText(player.x, player.z, 2.9, 'В печь!', '#ff5a33', 1.4);
      this.game.flash(player.x, player.z, 2);
    });
  }

  /** Жар из печи: огненные полосы веером. */
  *ovenFire() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Cast';
    const stove = this.scene.stove;
    const sx = stove.x, sz = stove.z - 1.6;
    const [ax, az] = norm(target.x - sx, target.z - sz);
    const count = this.d.extra ? 5 : 3, lines = [];
    for (let i = 0; i < count; i++) {
      const [dx, dz] = rotate(ax, az, (i - (count - 1) / 2) * 32);
      lines.push([dx, dz]);
      this.game.telegraphLine(sx, sz, dx, dz, 16, 1.8, this.tele(0.7));
    }
    yield* this.wait(this.tele(0.7));
    const life = P.fireLife * (this.has('hungry') ? 2 : 1);
    for (const [dx, dz] of lines) {
      for (let t = 1; t < 16; t += 1.5) {
        const x = sx + dx * t, z = sz + dz * t;
        if (Math.hypot(x, z) < this.scene.bossRadius) this.game.spawnZone(x, z, 0.9, 'fire', life, P.stoveFireDamage);
      }
    }
    yield* this.wait(0.4);
  }

  *dash() {
    const target = this.pickTarget();
    if (!target) return;
    const [dx, dz] = norm(target.x - this.x, target.z - this.z);
    const length = Math.min(Math.hypot(target.x - this.x, target.z - this.z) + 2, 16);
    this.face(dx, dz);
    this.pose = 'Aim';
    this.game.telegraphLine(this.x, this.z, dx, dz, length, 1.6, this.tele(0.6));
    yield* this.wait(this.tele(0.6));
    this.pose = 'Dive';
    this.clawsOn(P.dashDamage);
    let travelled = 0;
    while (travelled < length && !this.dead) {
      const step = this.fast(P.dashSpeed) * this.dt;
      if (!this.stepYaga(dx, dz, step)) break;
      travelled += step;
      yield;
    }
    this.clawsOff();
    this.pose = 'Tired';
    yield* this.wait(P.restWindow);
    // Возвращается к печи.
    this.pose = 'Stand';
    const stove = this.scene.stove, end = this.now + 2;
    while (this.now < end && !this.dead) {
      const tx = stove.x - this.x, tz = stove.z - 2.2 - this.z, d = Math.hypot(tx, tz);
      if (d < 0.3) break;
      this.face(tx, tz);
      this.x += tx / d * Math.min(d, 9 * this.dt);
      this.z += tz / d * Math.min(d, 9 * this.dt);
      yield;
    }
  }

  /** Гуси-лебеди летят клином. На хлеб они отвлекаются. */
  *geese() {
    const target = this.pickTarget();
    if (!target) return;
    this.pose = 'Cast';
    this.game.floatText(this.x, this.z, 3.2, 'Гуси-лебеди!', '#e8e2d0', 1.2);
    const bread = this.game.effects.find((e) => e.kind === 'bread');
    const aim = bread ?? target;
    const a = Math.atan2(aim.x, aim.z) + Math.PI + rand(-0.6, 0.6);
    const sx = Math.sin(a) * 15, sz = Math.cos(a) * 15;
    const [dx, dz] = norm(aim.x - sx, aim.z - sz);
    this.game.telegraphLine(sx, sz, dx, dz, 30, 3, this.tele(0.8));
    yield* this.wait(this.tele(0.8));
    this.gooseWave = (this.gooseWave ?? 0) + 1;
    const wave = this.gooseWave;
    const count = this.d.extra ? 7 : 5, speed = P.gooseSpeed * this.d.projectileSpeed;
    for (let i = 0; i < count; i++) {
      const side = i - (count - 1) / 2;
      const px = sx - dz * side * 1.1 - dx * Math.abs(side) * 1.1, pz = sz + dx * side * 1.1 - dz * Math.abs(side) * 1.1;
      this.game.spawnWide(px, pz, dx, dz, speed, 0.6, P.gooseDamage, 34 / speed, 'goose', { consume: true, goose: wave });
    }
    yield* this.wait(1);
  }

  /** Гусь задел: один раз за стаю выхватывает оружие или утаскивает в другой конец арены. */
  gooseHit(player, wave) {
    if (this.gooseCaught === wave) return;
    this.gooseCaught = wave;
    if (Math.random() < 0.5) {
      player.dropped = this.clampToArena(player.x + rand(-4, 4), player.z + rand(-4, 4));
      this.game.floatText(player.x, player.z, 2.9, 'Гуси выхватили оружие!', '#e8e2d0', 1.6);
    } else {
      const [tx, tz] = this.clampToArena(-player.x * 0.8, -player.z * 0.8);
      this.game.floatText(player.x, player.z, 2.9, 'Гуси тащат!', '#e8e2d0', 1.4);
      this.game.dragPlayer(player, tx, tz, 9, 4, 'geese', null);
    }
  }

  // ---------------------------------------------------------------- Способности богатыря

  /** Верёвка с петлёй сдёргивает летящую Ягу на землю. */
  onRope(player, range) {
    if (this.dead || this.transition || this.cutscene || !this.airborne) return false;
    if (Math.hypot(this.x - player.x, this.z - player.z) > range) return false;
    this.game.floatText(this.x, this.z, 3, 'Попалась!', '#ffd94d', 1.3);
    this.interrupt(this.knockedDown(P.knockdown));
    return true;
  }

  /** «Повернись, избушка!» */
  onTurnHut(duration) {
    if (!this.hut.active || this.hut.fallen || this.dead) return false;
    this.hut.turnedUntil = this.now + duration;
    this.game.floatText(this.hut.x, this.hut.z, 8.5, 'Повернулась!', '#ffd94d', 1.4);
    return true;
  }

  /** Ветер отбрасывает Ягу и разгоняет пыль перед богатырём. */
  onWind(px, pz, nx, nz, spell) {
    const game = this.game;
    game.effects = game.effects.filter((e) => e.kind !== 'dust' || Math.hypot(e.x - px, e.z - pz) > spell.range + e.r);
    if (this.dead || this.cutscene || this.onRoof || this.transition) return;
    const dx = this.x - px, dz = this.z - pz, d = Math.hypot(dx, dz);
    if (d > spell.range + this.radius) return;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * nx + dz * nz) / Math.max(1e-3, d)))) * 180 / Math.PI;
    if (d > 1 && angle > spell.arc / 2) return;
    const [ux, uz] = d > 0.05 ? [dx / d, dz / d] : [nx, nz];
    for (let i = 0; i < 8; i++) if (!this.stepYaga(ux, uz, spell.push / 8)) break;
    game.floatText(this.x, this.z, 3, 'Ух!', '#bfe3ff', 1);
  }

  // ---------------------------------------------------------------- Конец боя

  *exhausted() {
    this.transition = true;
    this.clawsOff();
    this.health.invulnerable = true;
    this.pose = 'Exhausted';
    this.finisherReady = true;
    this.game.announce('Яга без сил! Скажи заветные слова');
    const autoAt = this.now + 3;
    while (!this.finisher && !this.dead) {
      if (this.game.flags.debugwin && this.now > autoAt) this.finisher = this.game.anyPlayer();
      yield;
    }
    this.finisherReady = false;
    if (this.dead) return;

    this.cutscene = true;
    if (this.finisher) {
      const [x, z] = this.clampToArena(this.x, this.z - 2);
      this.game.teleport(this.finisher, x, z, 0, 1);
      this.game.floatText(x, z, 3, '«Избушка, избушка, повернись ко мне передом!»', '#ffd966', 3);
    }
    yield* this.wait(1.5);
    this.hut.seated = false;
    this.game.shake(0.5, 1);
    yield* this.wait(1.5);
    this.health.invulnerable = false;
    this.health.floor = 0;
    this.health.hp = 0;
    this.onDepleted();
  }

  startFinisher(player) {
    if (this.finisherReady && !this.finisher && Math.hypot(player.x - this.x, player.z - this.z) < 4.8) this.finisher = player;
  }

  onDepleted() {
    if (this.dead) return;
    this.dead = true;
    this.tasks.stopAll();
    this.clawsOff();
    this.cutscene = false;
    this.finisherReady = false;
    this.onRoof = false;
    this.airborne = false;
    this.hut.charging = false;
    this.pose = 'Dead';
    this.game.recordVictory();
    this.game.announce('Избушка теперь твоя!');
    this.tasks.start((function* (self) { yield 3; self.game.bossDefeated(); })(this));
  }
}
