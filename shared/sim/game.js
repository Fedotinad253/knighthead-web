// Игра: общее для всех игроков состояние похода (как GameSession в Unity). Работает и в браузере
// (одиночная игра), и на Node-сервере (кооп). Здесь решается: где мы (таверна, карта, арена), где избушка, какой босс и сложность, урон, карты, снаряды.
// Богатырём управляет его игрок у себя в браузере и присылает позицию (отзывчиво, как Owner-режим в Unity);
// попадания по себе он тоже определяет сам — так уклонение и парирование честны по тому, что он видит.
import { WEAPONS, BOSSES, DIFFICULTIES, WORLDS, CARDS, PLAYER, SESSION, attackStep, ATTACK } from '../data.js';
import { SCENES, MAP, clampOnMap, nodeNear, nearestInteractable } from '../scenes.js';
import { Likho } from './likho.js';
import { Dummy } from './dummy.js';
import { Tasks } from './tasks.js';

const MAX_PLAYERS = 2;

export class Game {
  /** progress — хранилище побед: { load(count) → массив, save(results) }. */
  constructor(flags, progress) {
    this.flags = flags;
    this.progress = progress;
    this.clock = { now: 0, dt: 0 };
    this.tasks = new Tasks(this.clock);
    this.players = [];
    this.nextId = 1;
    this.results = progress.load(BOSSES.length);

    this.state = SESSION.TAVERN;
    this.scene = 'tavern';
    this.hut = [...MAP.nodes[0]];
    this.mapInput = new Map();
    this.stoneOpen = false;
    this.stoneBoss = -1;
    this.currentBoss = -1;
    this.difficulty = 1;
    this.boss = null;
    this.hazards = [];
    this.projectiles = [];
    this.fightResolved = false;
    this.wipeTimer = 0;
    this.autoStartAt = -1;
  }

  get sceneData() { return SCENES[this.scene]; }

  log(text) { if (!this.flags.quiet) console.log(`[KnightHead] ${text}`); }

  // ---------------------------------------------------------------- Подключения

  join(socket) {
    if (this.players.length >= MAX_PLAYERS) {
      socket.send(JSON.stringify({ t: 'full' }));
      socket.close();
      return;
    }
    const slot = [0, 1].find((s) => !this.players.some((p) => p.slot === s));
    const spawn = this.state === SESSION.MAP ? [0, 0] : this.sceneData.spawns[slot];
    const player = {
      id: this.nextId++, slot, socket, x: spawn[0], z: spawn[1], fx: 0, fz: 1,
      hp: PLAYER.maxHealth, downed: false, weapon: 0, cards: 0, dropped: null, cursed: false,
      anim: {}, lastState: this.clock.now,
    };
    this.players.push(player);
    this.log(`Богатырь ${slot + 1} появился (игроков: ${this.players.length})`);
    this.send(player, { t: 'welcome', id: player.id, slot, ...this.sessionInfo() });
    this.send(player, { t: 'teleport', x: player.x, z: player.z, fx: 0, fz: 1 });
    if (this.flags.boss >= 0 && this.autoStartAt < 0) this.autoStartAt = this.clock.now + 3;

    socket.onmessage = (text) => {
      let message;
      try { message = JSON.parse(text); } catch { return; }
      this.receive(player, message);
    };
    socket.onclose = () => {
      this.players = this.players.filter((p) => p !== player);
      this.mapInput.delete(player.id);
      this.log(`Богатырь ${slot + 1} ушёл (игроков: ${this.players.length})`);
    };
  }

  send(player, message) { player.socket.send(JSON.stringify(message)); }
  broadcast(message, except = null) {
    const text = JSON.stringify(message);
    for (const p of this.players) if (p !== except) p.socket.send(text);
  }

  playerCount() { return this.players.length; }
  alivePlayers() { return this.players.filter((p) => !p.downed); }
  anyPlayer() { return this.players[0] ?? null; }

  // ---------------------------------------------------------------- Сообщения от игроков

  receive(player, m) {
    switch (m.t) {
      case 'state':
        // Позицией богатыря управляет его игрок. На карте богатыри спрятаны — позицию не принимаем.
        if (this.state !== SESSION.MAP && Number.isFinite(m.x) && Number.isFinite(m.z)) {
          player.x = m.x; player.z = m.z; player.fx = m.fx; player.fz = m.fz;
        }
        player.anim = m.anim ?? {};
        player.lastState = this.clock.now;
        break;

      case 'hit': { // ближний удар по боссу (попадание посчитал игрок)
        if (!this.boss || player.downed) break;
        const dealt = this.boss.applyDamage(Math.min(m.damage, 200));
        if (m.fills) this.addCards(player, dealt / CARDS.damagePerCard);
        break;
      }
      case 'fire': this.firePlayer(player, m); break;
      case 'spendCard': player.cards = Math.max(0, player.cards - 1); break;
      case 'fx': this.broadcast({ ...m, id: player.id }, player); break;

      case 'hurt': this.hurt(player, m); break;
      case 'parried': {
        const hazard = this.hazards.find((h) => h.id === m.hazard);
        if (hazard) this.removeHazard(hazard);
        this.addCards(player, CARDS.perParry);
        this.broadcast({ t: 'parryFlash', id: player.id, x: player.x, z: player.z }, player);
        break;
      }
      case 'stunned': this.floatText(player.x, player.z, 2.8, 'В капкане!', '#ffb34d', 1.3); break;

      case 'drop': // проклятие: оружие выскользнуло
        player.dropped = [m.x, m.z];
        player.slipperyUntil = 0;
        break;
      case 'pickup':
        if (player.dropped && Math.hypot(player.dropped[0] - player.x, player.dropped[1] - player.z) < 2) player.dropped = null;
        break;
      case 'ricochet': { // стрела отрикошетила обратно в стрелка — её можно парировать
        const [dx, dz] = normalize(m.dx, m.dz);
        player.slipperyUntil = 0;
        this.fireEnemy(m.x + dx * 3.5, m.z + dz * 3.5, -dx, -dz, 11, 12, true, 3, 1);
        break;
      }

      case 'interact': this.interact(player, m.id); break;
      case 'revive': {
        const target = this.players.find((p) => p.id === m.target);
        if (!player.downed && target?.downed && Math.hypot(target.x - player.x, target.z - player.z) <= PLAYER.reviveRadius * 1.5) {
          target.downed = false;
          target.hp = PLAYER.maxHealth * PLAYER.reviveHealth;
        }
        break;
      }

      case 'mapInput': {
        const l = Math.hypot(m.dx, m.dz);
        const k = l > 1 ? 1 / l : 1;
        this.mapInput.set(player.id, { dx: m.dx * k, dz: m.dz * k, time: this.clock.now });
        break;
      }
      case 'mapInteract': {
        const node = nodeNear(...this.hut);
        if (this.state !== SESSION.MAP || this.stoneOpen || node <= 0) break;
        const boss = node - 1;
        if (!this.isWorldUnlocked(BOSSES[boss].world)) break;
        this.stoneBoss = boss;
        this.stoneOpen = true;
        break;
      }
      case 'difficulty':
        if (this.stoneOpen && this.stoneBoss >= 0) this.startBoss(this.stoneBoss, m.d);
        break;
      case 'closeStone': this.stoneOpen = false; this.stoneBoss = -1; break;
      case 'leaveMap': if (this.state === SESSION.MAP && !this.stoneOpen) this.goTo(SESSION.TAVERN); break;
    }
  }

  interact(player, id) {
    if (player.downed) return;
    if (id === 'finisher') { this.boss?.startFinisher?.(player); return; }
    const item = this.sceneData.interactables?.find((i) => i.id === id);
    if (!item || Math.hypot(item.x - player.x, item.z - player.z) > item.radius * 1.5) return;
    if (item.kind === 'rack') player.weapon = item.weapon;
    else if (item.kind === 'map' || item.kind === 'exit') this.goTo(SESSION.MAP);
  }

  hurt(player, m) {
    let damage = m.damage;
    if (m.hazard === 'claws') {
      if (!this.boss?.claws?.active) return;
      damage = this.boss.claws.damage;
    } else {
      const hazard = this.hazards.find((h) => h.id === m.hazard);
      if (hazard) {
        damage = hazard.damage;
        if (hazard.consume) this.removeHazard(hazard);
      }
    }
    if (this.flags.godmode || player.downed) return;
    player.hp = Math.max(0, player.hp - damage);
    this.broadcast({ t: 'hurtFlash', id: player.id });
    if (player.hp <= 0) {
      player.downed = true;
      this.log(`Богатырь ${player.slot + 1} пал`);
    }
  }

  addCards(player, amount) { player.cards = Math.min(CARDS.max, player.cards + amount); }

  // ---------------------------------------------------------------- Переходы

  isWorldUnlocked(world) {
    if (world <= 0) return true;
    return BOSSES.every((b, i) => b.world !== world - 1 || this.results[i] >= 0);
  }

  worldProgress(world) {
    let defeated = 0, total = 0;
    BOSSES.forEach((b, i) => { if (b.world === world) { total++; if (this.results[i] >= 0) defeated++; } });
    return [defeated, total];
  }

  startBoss(boss, difficulty) {
    if (!BOSSES[boss] || !this.isWorldUnlocked(BOSSES[boss].world)) return;
    this.currentBoss = boss;
    this.difficulty = Math.min(Math.max(difficulty | 0, 0), DIFFICULTIES.length - 1);
    this.goTo(SESSION.ARENA, BOSSES[boss].arena);
  }

  goTo(state, scene = state === SESSION.TAVERN ? 'tavern' : null) {
    this.state = state;
    if (scene) this.scene = scene;
    this.stoneOpen = false;
    this.stoneBoss = -1;
    this.mapInput.clear();
    this.fightResolved = false;
    this.wipeTimer = 0;
    this.hazards = [];
    this.projectiles = [];
    this.boss = null;
    this.tasks.stopAll();
    this.broadcast({ t: 'scene', ...this.sessionInfo() });

    // Все встают на свои места живыми, с оружием в руках и без проклятия.
    this.players.forEach((p) => {
      p.downed = false;
      p.hp = PLAYER.maxHealth;
      p.dropped = null;
      p.cursed = false;
      p.slipperyUntil = 0;
      if (state !== SESSION.MAP) {
        const [x, z] = this.sceneData.spawns[p.slot];
        this.teleport(p, x, z, 0, 1);
      }
    });
    this.log(`Сцена ${state === SESSION.ARENA ? this.scene : state}, игроков: ${this.players.length}`);

    if (state === SESSION.ARENA) {
      const entry = BOSSES[this.currentBoss], d = DIFFICULTIES[this.difficulty];
      this.boss = entry.kind === 'likho' ? new Likho(this, d) : new Dummy(this, d, entry.name);
      this.announce(`${entry.name} — ${d.name}`);
    } else this.announce(state === SESSION.MAP ? 'Карта' : 'Избушка на курьих ножках');
  }

  sessionInfo() {
    return {
      state: this.state, scene: this.state === SESSION.MAP ? 'map' : this.scene,
      boss: this.currentBoss, difficulty: this.difficulty, results: this.results,
    };
  }

  /** Вызывает босс, когда его здоровье кончилось. */
  bossDefeated() {
    if (this.state !== SESSION.ARENA || this.fightResolved) return;
    this.fightResolved = true;
    const boss = this.currentBoss, world = BOSSES[boss].world;
    const nextWasLocked = !this.isWorldUnlocked(world + 1);
    if (this.difficulty > this.results[boss]) this.results[boss] = this.difficulty;
    this.progress.save(this.results);
    const [defeated, total] = this.worldProgress(world);
    this.log(`Победа над «${BOSSES[boss].name}» (${DIFFICULTIES[this.difficulty].name}). ${WORLDS[world].name}: ${defeated}/${total}`);
    const next = WORLDS[world + 1];
    this.announce(nextWasLocked && next && this.isWorldUnlocked(world + 1)
      ? `Победа! Открыт путь в ${next.name}` : `Победа над «${BOSSES[boss].name}»!`);
    this.tasks.start((function* (game) { yield 4; game.goTo(SESSION.MAP); })(this));
  }

  // ---------------------------------------------------------------- Действия для боссов

  announce(text) { this.log(`Объявление: ${text}`); this.broadcast({ t: 'announce', text }); }
  shake(amount, duration) { this.broadcast({ t: 'shake', amount, duration }); }
  flash(x, z, r) { this.broadcast({ t: 'flash', x, z, r }); }
  floatText(x, z, y, text, color, duration = 1.2) { this.broadcast({ t: 'text', x, z, y, text, color, duration }); }
  showDamage(x, z, amount) { this.broadcast({ t: 'damage', x, z, amount: Math.round(amount) }); }
  telegraphCircle(x, z, r, duration, color) { this.broadcast({ t: 'tele', shape: 'circle', x, z, r, duration, color }); }
  telegraphLine(x, z, dx, dz, length, width, duration) {
    this.broadcast({ t: 'tele', shape: 'line', x, z, dx, dz, length, width, duration, color: 'danger' });
  }

  teleport(player, x, z, fx, fz) {
    player.x = x; player.z = z;
    this.send(player, { t: 'teleport', x, z, fx, fz });
  }

  setCurse(cursed) {
    for (const p of this.players) { p.cursed = cursed; if (!cursed) p.slipperyUntil = 0; }
  }

  /** «Скользкие руки»: над богатырём «!», следующий удар обернётся неудачей. */
  slippery(player, duration) {
    player.slipperyUntil = this.clock.now + duration;
    this.broadcast({ t: 'slippery', id: player.id, duration });
  }

  spawnZone(x, z, r, kind, lifetime, damage, stun = 0, look = null) {
    const radius = this.sceneData.bossRadius ?? 14;
    const d = Math.hypot(x, z);
    if (d > radius) { x *= radius / d; z *= radius / d; }
    this.hazards.push({ id: this.nextId++, type: 'zone', kind, look, x, z, r, damage, stun,
      consume: kind === 'trap', expire: this.clock.now + lifetime });
    if (kind === 'strike') this.flash(x, z, r);
  }

  fireEnemy(x, z, dx, dz, speed, damage, parryable, lifetime, y = null) {
    this.hazards.push({ id: this.nextId++, type: 'proj', x, z, y: y ?? (this.boss?.kind === 'likho' ? 2.2 : 1.2),
      vx: dx * speed, vz: dz * speed, r: 0.35, damage, parryable, consume: true, expire: this.clock.now + lifetime });
  }

  removeHazard(hazard) { this.hazards = this.hazards.filter((h) => h !== hazard); }

  /** Выстрел богатыря: снаряды летят на сервере и ранят босса. */
  firePlayer(player, m) {
    const weapon = WEAPONS[player.weapon];
    const step = attackStep(weapon, m.kind, m.step);
    if (!step?.projectile) return;
    const count = Math.max(1, step.count);
    const [dx, dz] = normalize(m.dx, m.dz);
    for (let i = 0; i < count; i++) {
      const angle = count === 1 ? 0 : -step.spread / 2 + step.spread * (i / (count - 1));
      const [fx, fz] = rotateY(dx, dz, angle);
      this.projectiles.push({ id: this.nextId++, owner: player, x: m.x, z: m.z, vx: fx * step.speed, vz: fz * step.speed,
        damage: step.damage, pierce: step.pierce, fills: m.kind === ATTACK.LIGHT || m.kind === ATTACK.HEAVY,
        expire: this.clock.now + step.lifetime, hit: false });
    }
  }

  // ---------------------------------------------------------------- Такт

  update(dt) {
    this.clock.dt = dt;
    this.clock.now += dt;
    this.tasks.update();

    if (this.autoStartAt > 0 && this.clock.now >= this.autoStartAt && this.players.length) {
      this.autoStartAt = 0;
      this.startBoss(this.flags.boss, this.flags.difficulty);
    }

    if (this.state === SESSION.MAP) this.moveHut(dt);
    if (this.boss) {
      this.boss.update();
      // Проверка без людей: боссу постепенно наносится урон.
      if (this.flags.debugwin && !this.fightResolved) {
        this.debugTimer = (this.debugTimer ?? 0) + dt;
        if (this.debugTimer > 0.25) { this.debugTimer = 0; this.boss.applyDamage(40); }
      }
    }

    // Снаряды врагов и зоны.
    const now = this.clock.now;
    for (const h of this.hazards) if (h.type === 'proj') { h.x += h.vx * dt; h.z += h.vz * dt; }
    this.hazards = this.hazards.filter((h) => now < h.expire);

    // Снаряды богатырей: попадание по боссу.
    for (const p of this.projectiles) {
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (!this.boss || p.hitBoss) continue;
      if (Math.hypot(p.x - this.boss.x, p.z - this.boss.z) < this.boss.radius + 0.25) {
        const dealt = this.boss.applyDamage(p.damage);
        if (p.fills && p.owner) this.addCards(p.owner, dealt / CARDS.damagePerCard);
        p.hitBoss = true;
        if (!p.pierce) p.expire = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p) => now < p.expire && Math.hypot(p.x, p.z) < 40);

    // Все пали — через 3 секунды обратно к карте.
    if (this.state === SESSION.ARENA && !this.fightResolved && this.players.length && this.players.every((p) => p.downed)) {
      if (this.wipeTimer === 0) this.announce('Богатыри пали...');
      this.wipeTimer += dt;
      if (this.wipeTimer >= 3) { this.fightResolved = true; this.goTo(SESSION.MAP); }
    } else this.wipeTimer = 0;
  }

  /** Избушку толкают оба игрока: их направления складываются. Тянут в разные стороны — топчется на месте. */
  moveHut(dt) {
    if (this.stoneOpen) return;
    let dx = 0, dz = 0;
    for (const input of this.mapInput.values())
      if (this.clock.now - input.time < 0.35) { dx += input.dx; dz += input.dz; }
    const l = Math.hypot(dx, dz);
    if (l < 0.1) return;
    const k = Math.min(1, l) / l * MAP.hutSpeed * dt;
    this.hut = clampOnMap(this.hut[0] + dx * k, this.hut[1] + dz * k, (w) => this.isWorldUnlocked(w));
  }

  snapshot() {
    const now = this.clock.now;
    return {
      t: 'snap', time: Math.round(now * 1000) / 1000,
      session: { state: this.state, hut: this.hut.map(r2), stoneOpen: this.stoneOpen, stoneBoss: this.stoneBoss,
        boss: this.currentBoss, difficulty: this.difficulty, results: this.results },
      players: this.players.map((p) => ({
        id: p.id, slot: p.slot, x: r2(p.x), z: r2(p.z), fx: r2(p.fx), fz: r2(p.fz), hp: Math.round(p.hp), downed: p.downed,
        weapon: p.weapon, cards: Math.round(p.cards * 100) / 100, dropped: p.dropped, cursed: p.cursed,
        slippery: (p.slipperyUntil ?? 0) > now, anim: p.anim,
      })),
      boss: this.boss?.snapshot() ?? null,
      hazards: this.hazards.map((h) => h.type === 'proj'
        ? { id: h.id, type: 'proj', x: r2(h.x), z: r2(h.z), y: h.y, vx: r2(h.vx), vz: r2(h.vz), r: h.r, parry: h.parryable, dmg: h.damage }
        : { id: h.id, type: 'zone', kind: h.kind, look: h.look, x: r2(h.x), z: r2(h.z), r: h.r, dmg: h.damage, stun: h.stun }),
      arrows: this.projectiles.map((p) => ({ id: p.id, x: r2(p.x), z: r2(p.z), vx: r2(p.vx), vz: r2(p.vz) })),
    };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
function normalize(x, z) { const l = Math.hypot(x, z); return l > 1e-5 ? [x / l, z / l] : [0, 1]; }
function rotateY(x, z, degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
export { nearestInteractable };
