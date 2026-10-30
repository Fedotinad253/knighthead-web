// Лихо Одноглазое — хитрое и скрытное. Вся логика боя на сервере (перенесено из LikhoBoss.cs).
// Фаза 1 «Из кустов»: прячется в кусте или за дубом, выглядывает (горит глаз), выпад по красной полосе,
// выдыхается на 3–4 с и убегает в другое укрытие. Переход: рёв и проклятие несчастья.
// Фаза 2 «Ползучее»: ползёт за богатырём, бьёт когтями вблизи, кидается и ставит капканы.
// Конец фазы 2: падает без сил — добивание по E (сценка: глаз выколот).
// Фаза 3 «Слепое бешенство»: мечется, врезается в деревья и оглушается, машет руками вокруг себя.
import { Tasks } from './tasks.js';
import { Health } from './health.js';

const P = {
  baseHealth: 1500, coopHealthBonus: 0.5,
  hideTime: [1, 2], peekTime: 0.7, flushRadius: 3, flushedWindow: 1.5,
  lungeTelegraph: 0.7, lungeSpeed: 20, lungeDamage: 20, tiredWindow: [3, 4], retreatSpeed: 14,
  crawlSpeed: 3.2, crawlTime: [3, 5], swipeRange: 2.6, swipeTelegraph: 0.6, swipeDamage: 18, swipeCooldown: 2.2, swipeRecovery: 1,
  throwDamage: 14, throwSpeed: 10, throwRest: 1.5, trapDamage: 15, trapStun: 1.2,
  misfortuneInterval: [5, 8], slipperyDuration: 1.2, branchTelegraph: 1.1, branchRadius: 1.6, branchDamage: 15,
  chargeSpeed: 13, chargeDamage: 22, stunTime: 2.5, flailRadius: 3.6, flailDamage: 18,
  bodyRadius: 0.55,
  /** Урон от столкновения с телом Лиха. */
  contactDamage: 10,
};

/** Позы, в которых тело не ранит: спряталось, обессилело, мёртвое. */
const HARMLESS = new Set(['Hidden', 'Peek', 'HiddenTree', 'PeekTree', 'Exhausted', 'Finisher', 'Dead']);

const rand = (a, b) => a + Math.random() * (b - a);
/** Наименьшее расстояние между центрами капканов (радиус 0.8): между кольцами остаётся проход. */
const TRAP_GAP = 2.2;
const rotate = (x, z, degrees) => {
  // Поворот вокруг вертикали как Quaternion.Euler(0, degrees, 0) в Unity (по часовой, если смотреть сверху).
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
};
const norm = (x, z) => { const l = Math.hypot(x, z); return l > 1e-5 ? [x / l, z / l] : [0, 0]; };

export class Likho {
  constructor(game, difficulty) {
    this.game = game;
    this.kind = 'likho';
    this.name = 'Лихо Одноглазое';
    this.d = difficulty;
    this.scene = game.sceneData;
    const spawn = this.scene.bossSpawn;
    this.x = spawn.x; this.z = spawn.z; this.fx = spawn.fx; this.fz = spawn.fz;
    this.radius = P.bodyRadius;
    this.pose = 'Hidden';
    this.phase = 1;
    this.eyeBlind = false;
    this.finisherReady = false;
    this.cutscene = false;
    /** Идёт переход между фазами (рёв, бессилие, добивание) — тело не ранит. До этого времени тоже не ранит. */
    this.harmlessUntil = 0;
    this.transition = false;
    this.claws = { id: 'claws', active: false, token: 0, damage: 0, r: 1.3, forward: 0.6 };
    this.dead = false;
    this.finisher = null;

    const players = Math.max(1, game.playerCount());
    this.health = new Health(P.baseHealth * difficulty.bossHealth * (1 + P.coopHealthBonus * (players - 1)));
    this.health.onDepleted = () => this.onDepleted();

    this.recentHides = [];
    this.nextSwipeAt = 0;
    this.lastSpecialWasThrow = false;
    this.hadSpecial = false;
    this.lastWasFlail = false;
    this.behindTree = false;

    this.tasks = new Tasks(game.clock);
    this.tasks.start(this.fight());
  }

  get now() { return this.game.clock.now; }
  get dt() { return this.game.clock.dt; }
  get atFloor() { return this.health.hp <= this.health.floor + 0.5; }
  tele(s) { return s / Math.max(0.1, this.d.attackSpeed); }
  fast(v) { return v * Math.sqrt(Math.max(0.1, this.d.attackSpeed)); }
  window(s) { return s * (this.d.trimmed ? 1.3 : this.d.extra ? 0.7 : 1); }

  update() { this.tasks.update(); }

  snapshot() {
    return {
      kind: this.kind, name: this.name, x: r2(this.x), z: r2(this.z), fx: r2(this.fx), fz: r2(this.fz),
      hp: Math.round(this.health.hp), max: Math.round(this.health.max), pose: this.pose, phase: this.phase,
      eyeBlind: this.eyeBlind, finisherReady: this.finisherReady, cutscene: this.cutscene,
      claws: this.claws.active ? { token: this.claws.token, damage: this.claws.damage } : null,
      contact: this.contactDamage,
      /** Где на полосе здоровья кончаются фазы (доли здоровья). */
      phaseMarks: [2 / 3, 1 / 3],
    };
  }

  /** Сколько ранит столкновение с телом сейчас (0 — не ранит). */
  get contactDamage() {
    const harmless = this.dead || this.cutscene || this.transition || this.now < this.harmlessUntil || HARMLESS.has(this.pose);
    return harmless ? 0 : P.contactDamage;
  }

  applyDamage(amount) { return this.health.apply(amount, (dealt) => this.game.showDamage(this.x, this.z, dealt)); }

  // ---------------------------------------------------------------- Ход боя

  *fight() {
    this.pose = 'Hidden';
    yield 1.5;
    this.setPhase(1, 2 / 3);
    while (!this.atFloor && !this.dead) yield* this.ambush();

    yield* this.roar();
    this.game.setCurse(true);
    this.tasks.start(this.misfortunes());

    this.setPhase(2, 1 / 3);
    while (!this.atFloor && !this.dead) yield* this.crawlCycle();

    yield* this.exhaustedAndFinisher();

    this.setPhase(3, 0);
    while (!this.dead) yield* this.blindCycle();
  }

  setPhase(phase, floorFraction) {
    this.phase = phase;
    this.health.floor = this.health.max * floorFraction;
    this.health.invulnerable = false;
    this.game.log(`Лихо: фаза ${phase}`);
  }

  /** Ждать, пока не выйдет время (или не кончится фаза, если breakOnFloor). */
  *wait(seconds, breakOnFloor = true) {
    const end = this.now + seconds;
    while (this.now < end && !this.dead && !(breakOnFloor && this.atFloor)) yield;
  }

  // ---------------------------------------------------------------- Фаза 1

  *ambush() {
    let target = this.pickTarget();
    if (!target) { yield* this.wait(0.5, false); return; }

    // Убегает в укрытие, сложившись пополам. Пока прячется — неуязвимо.
    this.health.invulnerable = true;
    this.clawsOff();
    this.pose = 'Retreat';
    const spot = this.pickHidePoint(target);
    yield* this.moveTo(spot[0], spot[1], this.fast(P.retreatSpeed), this.behindTree);

    // Сидит в кусте или за деревом. Если богатырь подошёл вплотную — выскакивает раньше.
    if (this.behindTree) this.face(target.x - this.x, target.z - this.z);
    this.pose = this.behindTree ? 'HiddenTree' : 'Hidden';
    let flusher = yield* this.watchFromHiding(rand(...P.hideTime) / this.d.attackSpeed);
    if (!flusher) {
      // Выглядывает: горит глаз.
      this.pose = this.behindTree ? 'PeekTree' : 'Peek';
      flusher = yield* this.watchFromHiding(this.tele(P.peekTime));
    }
    if (flusher) { yield* this.flushedOut(flusher); return; }

    const lunges = this.d.extra ? 2 : 1;
    for (let i = 0; i < lunges && !this.atFloor; i++) {
      target = this.pickTarget() ?? target;
      yield* this.lunge(target);
    }

    // Выдохлось после рывка — окно для ударов. Еле ползёт в сторону.
    this.pose = 'Tired';
    const end = this.now + this.window(rand(...P.tiredWindow));
    while (this.now < end && !this.atFloor && !this.dead) {
      const nearest = this.pickNearest();
      if (nearest) this.step(...norm(this.x - nearest.x, this.z - nearest.z), 0.6 * this.dt, true);
      yield;
    }
  }

  /** Ждать в укрытии; если богатырь подошёл ближе flushRadius — вернуть его. */
  *watchFromHiding(seconds) {
    const end = this.now + seconds;
    while (this.now < end && !this.dead) {
      const nearest = this.pickNearest();
      if (nearest && Math.hypot(nearest.x - this.x, nearest.z - this.z) < P.flushRadius) return nearest;
      yield;
    }
    return null;
  }

  /** Выкурили из укрытия: выскакивает со взмахом когтей, потом ненадолго открыто. */
  *flushedOut(player) {
    this.health.invulnerable = false;
    this.pose = 'Swipe';
    this.face(player.x - this.x, player.z - this.z);
    this.game.telegraphCircle(this.x, this.z, 2, this.tele(0.45), 'danger');
    yield* this.wait(this.tele(0.45), false);
    this.game.spawnZone(this.x, this.z, 2, 'strike', 0.15, P.swipeDamage);
    this.pose = 'Tired';
    yield* this.wait(this.window(P.flushedWindow));
  }

  *lunge(target) {
    const tx = target.x - this.x, tz = target.z - this.z;
    const length = Math.min(Math.max(Math.hypot(tx, tz) + 2.5, 4), 24);
    let [dx, dz] = Math.hypot(tx, tz) > 0.1 ? norm(tx, tz) : [this.fx, this.fz];
    this.face(dx, dz);

    this.game.telegraphLine(this.x, this.z, dx, dz, length, 1.6, this.tele(P.lungeTelegraph));
    yield* this.wait(this.tele(P.lungeTelegraph), false);

    this.health.invulnerable = false;
    this.pose = 'Lunge';
    this.clawsOn(P.lungeDamage);

    // Быстрый выпад, под конец — замедление (за ним идёт окно для ударов).
    let travelled = 0;
    const speed = this.fast(P.lungeSpeed);
    while (travelled < length && !this.dead) {
      const slowdown = travelled < length * 0.7 ? 1 : 1 + (0.15 - 1) * ((travelled - length * 0.7) / (length * 0.3));
      const step = speed * slowdown * this.dt;
      if (this.step(dx, dz, step, true)) break;
      travelled += step;
      yield;
    }
    this.clawsOff();
  }

  // ---------------------------------------------------------------- Переход: рёв и проклятие

  *roar() {
    this.transition = true;
    this.health.invulnerable = true;
    this.clawsOff();
    this.pose = 'Roar';
    this.game.announce('Лихо злится!');
    this.game.shake(0.45, 2.2);
    yield* this.wait(2.6, false);
    this.game.announce('Проклятие несчастья!');
    this.transition = false;
    this.harmlessUntil = this.now + 1;
  }

  /** Неудачи проклятия: «скользкие руки» («!» над головой) или «сук» (растущая тень). На пробной — только сучья. */
  *misfortunes() {
    while (!this.dead) {
      yield rand(...P.misfortuneInterval) / this.d.attackSpeed;
      if (this.dead || this.cutscene) continue;
      const player = this.pickTarget();
      if (!player) continue;
      const slippery = !this.d.trimmed && Math.random() < 0.5;
      if (slippery) this.game.slippery(player, P.slipperyDuration);
      else this.tasks.start(this.fallingBranch(player.x, player.z));
    }
  }

  *fallingBranch(x, z) {
    this.game.telegraphCircle(x, z, P.branchRadius, this.tele(P.branchTelegraph), 'shadow');
    yield this.tele(P.branchTelegraph);
    if (!this.dead) this.game.spawnZone(x, z, P.branchRadius, 'strike', 0.15, P.branchDamage, 0, 'branch');
  }

  // ---------------------------------------------------------------- Фаза 2

  *crawlCycle() {
    this.pose = 'Crawl';
    const until = this.now + rand(...P.crawlTime);
    while (this.now < until && !this.atFloor && !this.dead) {
      const target = this.pickNearest();
      if (!target) { yield; continue; }
      const tx = target.x - this.x, tz = target.z - this.z, distance = Math.hypot(tx, tz);
      const [nx, nz] = norm(tx, tz);
      if (distance < P.swipeRange) {
        if (this.now >= this.nextSwipeAt) { yield* this.swipe(target); continue; }
        // Взмах перезаряжается — обползает богатыря сбоку, а не стоит на месте.
        this.face(tx, tz);
        const [sx, sz] = rotate(nx, nz, 90);
        this.step(...norm(sx - nx * 0.3, sz - nz * 0.3), this.fast(P.crawlSpeed) * this.dt, true);
        yield;
        continue;
      }
      this.face(tx, tz);
      this.step(nx, nz, this.fast(P.crawlSpeed) * this.dt, true);
      yield;
    }
    if (this.atFloor || this.dead) return;

    // Особые действия чередуются: бросок и капканы не повторяются подряд. На былинной — оба.
    if (this.d.extra) {
      yield* this.throwFan();
      if (!this.atFloor) yield* this.placeTraps();
      return;
    }
    const doThrow = this.hadSpecial ? !this.lastSpecialWasThrow : Math.random() < 0.5;
    this.hadSpecial = true;
    this.lastSpecialWasThrow = doThrow;
    yield* (doThrow ? this.throwFan() : this.placeTraps());
  }

  *swipe(target) {
    this.pose = 'Swipe';
    const [dx, dz] = norm(target.x - this.x, target.z - this.z);
    this.face(dx, dz);
    const cx = this.x + dx * 1.6, cz = this.z + dz * 1.6;
    this.game.telegraphCircle(cx, cz, 1.7, this.tele(P.swipeTelegraph), 'danger');
    yield* this.wait(this.tele(P.swipeTelegraph), false);
    this.game.spawnZone(cx, cz, 1.7, 'strike', 0.15, P.swipeDamage);
    this.nextSwipeAt = this.now + P.swipeCooldown / this.d.attackSpeed;
    this.pose = 'Tired';
    yield* this.wait(this.window(P.swipeRecovery));
    this.pose = 'Crawl';
  }

  *throwFan() {
    const target = this.pickTarget();
    if (!target) return;
    // Поднимается во весь рост, замахивается — полоса показывает, куда полетит.
    this.pose = 'Rise';
    const [dx, dz] = norm(target.x - this.x, target.z - this.z);
    this.face(dx, dz);
    this.game.telegraphLine(this.x, this.z, dx, dz, 9, 1.2, this.tele(0.7));
    yield* this.wait(this.tele(0.7), false);

    // Веер снарядов, средний можно парировать.
    const count = this.d.extra ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const [fx, fz] = rotate(dx, dz, (i - (count - 1) / 2) * 14);
      this.game.fireEnemy(this.x, this.z, fx, fz, P.throwSpeed * this.d.projectileSpeed, P.throwDamage, i === Math.floor(count / 2), 4);
    }
    // Тяжело дышит — окно для ударов.
    this.pose = 'Tired';
    yield* this.wait(this.window(P.throwRest));
  }

  *placeTraps() {
    this.pose = 'Rise';
    const count = this.d.extra ? 3 : 2;
    // Капканы не ставятся друг на друга: ни на только что выбранные места, ни на те, что уже лежат.
    const taken = this.game.hazards.filter((h) => h.kind === 'trap').map((h) => [h.x, h.z]);
    const spots = [];
    for (let i = 0; i < count; i++) {
      const spot = this.trapSpot([...taken, ...spots]);
      if (!spot) continue;
      spots.push(spot);
      this.game.telegraphCircle(spot[0], spot[1], 0.8, 0.5, 'danger');
    }
    yield* this.wait(0.5, false);
    // Капкан: железное кольцо с зубьями, лежит 20 секунд или пока не наступят.
    for (const [x, z] of spots) this.game.spawnZone(x, z, 0.8, 'trap', 20, P.trapDamage, P.trapStun);
    yield* this.wait(0.4, false);
  }

  /** Место для капкана у случайного богатыря (1.5–3 м от него), не ближе TRAP_GAP к занятым местам. Null — некуда. */
  trapSpot(taken) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const near = this.pickTarget();
      const bx = near ? near.x : this.x, bz = near ? near.z : this.z;
      // Если рядом тесно, понемногу отходим дальше от богатыря.
      const a = Math.random() * Math.PI * 2, d = rand(1.5, 3) + attempt * 0.1;
      const [x, z] = this.clampToArena(bx + Math.sin(a) * d, bz + Math.cos(a) * d);
      if (taken.every(([tx, tz]) => Math.hypot(tx - x, tz - z) >= TRAP_GAP)) return [x, z];
    }
    return null;
  }

  // ---------------------------------------------------------------- Добивание

  *exhaustedAndFinisher() {
    this.transition = true;
    this.clawsOff();
    this.health.invulnerable = true;
    this.pose = 'Exhausted';
    this.finisherReady = true;
    this.game.announce('Лихо обессилело! Подойди и нажми E');

    const autoAt = this.now + 3;
    while (!this.finisher && !this.dead) {
      if (this.game.flags.debugwin && this.now > autoAt) this.finisher = this.game.anyPlayer();
      yield;
    }
    this.finisherReady = false;

    // Сценка: богатырь перед Лихом, камера наезжает, удар в глаз, рёв.
    this.cutscene = true;
    const [fx, fz] = this.clampToArena(this.x + this.fx * 1.4, this.z + this.fz * 1.4);
    if (this.finisher) this.game.teleport(this.finisher, fx, fz, -this.fx, -this.fz);
    yield* this.wait(0.9, false);

    this.pose = 'Finisher';
    this.eyeBlind = true;
    this.game.shake(0.7, 1.6);
    this.game.flash(this.x + this.fx * 0.5, this.z + this.fz * 0.5, 1.4);
    this.game.floatText(this.x, this.z, 3.6, 'ГЛАЗ!', '#ff4033', 1.8);
    this.game.announce('Лихо ослепло!');
    yield* this.wait(2.2, false);

    this.cutscene = false;
    this.pose = 'Blind';
    // Богатырь стоит вплотную после сценки — даём отойти, прежде чем тело снова ранит.
    this.transition = false;
    this.harmlessUntil = this.now + 1.5;
  }

  /** Игрок нажал E над обессилевшим Лихом. */
  startFinisher(player) {
    if (this.finisherReady && !this.finisher && Math.hypot(player.x - this.x, player.z - this.z) < 3.2 * 1.5) this.finisher = player;
  }

  // ---------------------------------------------------------------- Фаза 3

  *blindCycle() {
    const flailChance = this.d.extra ? 0.45 : 0.3;
    // Бешеное размахивание не повторяется подряд — иначе приходится просто ждать в стороне.
    const flail = !this.lastWasFlail && Math.random() < flailChance;
    this.lastWasFlail = flail;
    yield* (flail ? this.flail() : this.charge());
  }

  *charge() {
    const target = this.pickTarget();
    if (!target) { yield* this.wait(0.5, false); return; }

    // Слепое: бросается примерно туда, где слышит богатыря.
    this.pose = 'Blind';
    let [dx, dz] = norm(target.x - this.x, target.z - this.z);
    [dx, dz] = rotate(dx, dz, rand(-30, 30));
    this.face(dx, dz);
    this.game.telegraphLine(this.x, this.z, dx, dz, 6, 1.6, this.tele(0.55));
    yield* this.wait(this.tele(0.55), false);

    this.pose = 'Charge';
    this.clawsOn(P.chargeDamage);
    let hit = null, travelled = 0;
    while (travelled < 18 && !this.dead) {
      const step = this.fast(P.chargeSpeed) * this.dt;
      hit = this.step(dx, dz, step, false);
      if (hit) break;
      travelled += step;
      yield;
    }
    this.clawsOff();
    if (this.dead) return;

    // Врезалось в дерево — оглушено, бей! В край арены — просто разворачивается.
    if (hit && hit.tree) {
      this.pose = 'Stunned';
      this.game.shake(0.3, 0.4);
      this.game.floatText(this.x, this.z, 3.4, 'Бум! Оглушено', '#ffd94d', 1.6);
      yield* this.wait(this.window(P.stunTime), false);
    } else {
      this.pose = 'Blind';
      yield* this.wait(0.5, false);
    }
  }

  *flail() {
    this.pose = 'Blind';
    this.game.telegraphCircle(this.x, this.z, P.flailRadius, this.tele(0.8), 'danger');
    yield* this.wait(this.tele(0.8), false);
    this.pose = 'Flail';
    const hits = this.d.extra ? 4 : 3;
    for (let i = 0; i < hits && !this.dead; i++) {
      this.game.spawnZone(this.x, this.z, P.flailRadius, 'strike', 0.15, P.flailDamage);
      yield* this.wait(0.45, false);
    }
    this.pose = 'Tired';
    yield* this.wait(this.window(1), false);
  }

  // ---------------------------------------------------------------- Смерть

  onDepleted() {
    if (this.dead) return;
    this.dead = true;
    this.tasks.stopAll();
    this.clawsOff();
    this.cutscene = false;
    this.pose = 'Dead';
    this.game.setCurse(false);
    this.game.announce('Лихо испускает последний вздох…');
    this.tasks.start((function* (self) { yield 3; self.game.bossDefeated(); })(this));
  }

  // ---------------------------------------------------------------- Движение и выбор цели

  clawsOn(damage) { this.claws.damage = damage; this.claws.token++; this.claws.active = true; }
  clawsOff() { this.claws.active = false; }

  face(dx, dz) {
    const [x, z] = norm(dx, dz);
    if (x || z) { this.fx = x; this.fz = z; }
  }

  clampToArena(x, z) {
    const r = this.scene.bossRadius, d = Math.hypot(x, z);
    return d > r ? [x * r / d, z * r / d] : [x, z];
  }

  moveBy(dx, dz) { [this.x, this.z] = this.clampToArena(this.x + dx, this.z + dz); }

  /**
   * Где круг тела, двигаясь из (x, z) по (dx, dz), упрётся в препятствие (как SphereCast в Unity):
   * {obstacle, distance} или null. Препятствия, внутри которых тело уже стоит, не мешают выйти.
   */
  cast(dx, dz, distance) {
    let best = null;
    for (const o of this.scene.obstacles) {
      if (o.type !== 'circle') continue;
      const R = o.r + P.bodyRadius;
      const ox = this.x - o.x, oz = this.z - o.z;
      const c = ox * ox + oz * oz - R * R;
      if (c <= 0) continue;
      const b = ox * dx + oz * dz;
      const disc = b * b - c;
      if (b >= 0 || disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t <= distance && (!best || t < best.distance)) best = { obstacle: o, distance: t };
    }
    return best;
  }

  /** Шаг с проверкой деревьев. slide — обходить сбоку. Возвращает препятствие, если упёрлось. */
  step(dx, dz, distance, slide) {
    if (distance <= 0 || (!dx && !dz)) return null;
    const hit = this.cast(dx, dz, distance + 0.05);
    if (!hit) { this.moveBy(dx * distance, dz * distance); return null; }
    if (slide) {
      for (const angle of [45, -45, 90, -90]) {
        const [sx, sz] = rotate(dx, dz, angle);
        if (this.cast(sx, sz, distance + 0.05)) continue;
        this.moveBy(sx * distance, sz * distance);
        return null;
      }
    }
    const go = Math.max(0, hit.distance - 0.05);
    this.moveBy(dx * go, dz * go);
    return hit.obstacle;
  }

  /** hug — в конце пути прижаться к стволу вплотную (спрятаться за ним), не упираясь в него. */
  *moveTo(x, z, speed, hug = false) {
    const timeout = this.now + Math.hypot(x - this.x, z - this.z) / speed * 2 + 1;
    while (!this.dead && this.now < timeout) {
      const tx = x - this.x, tz = z - this.z, d = Math.hypot(tx, tz);
      if (d < (hug ? 0.05 : 0.3)) break;
      this.face(tx, tz);
      const step = Math.min(d, speed * this.dt);
      if (hug && d < 1.6) this.moveBy(tx / d * step, tz / d * step);
      else this.step(tx / d, tz / d, step, true);
      yield;
    }
  }

  /** Укрытие: не одно из трёх последних и не то, где стоит сейчас; по возможности на дистанции выпада (5–13 м). */
  pickHidePoint(target) {
    const preferred = [], allowed = [];
    for (const point of this.scene.hidePoints) {
      if (this.recentHides.includes(point) || Math.hypot(point.x - this.x, point.z - this.z) < 2) continue;
      allowed.push(point);
      const d = Math.hypot(point.x - target.x, point.z - target.z);
      if (d >= 5 && d <= 13) preferred.push(point);
    }
    const pool = preferred.length ? preferred : allowed;
    if (!pool.length) return this.clampToArena(rand(-1, 1) * 10, rand(-1, 1) * 10);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.recentHides.push(pick);
    while (this.recentHides.length > 3) this.recentHides.shift();
    this.behindTree = pick.behindTree;
    if (!pick.behindTree) return this.clampToArena(pick.x, pick.z);
    // За стволом — с дальней от камеры стороны (камера смотрит на север), чуть в сторону от богатыря.
    const side = Math.min(Math.max(pick.x - target.x, -1), 1) * 0.12;
    return this.clampToArena(pick.x + side, pick.z + pick.treeOffset);
  }

  pickTarget() {
    const alive = this.game.alivePlayers();
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
  }

  pickNearest() {
    let best = null, bestDistance = Infinity;
    for (const p of this.game.alivePlayers()) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < bestDistance) { best = p; bestDistance = d; }
    }
    return best;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
