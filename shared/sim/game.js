// Игра: общее для всех игроков состояние похода (как GameSession в Unity). Работает и в браузере
// (одиночная игра), и на Node-сервере (кооп). Здесь решается: где мы (таверна, карта, арена), где избушка, какой босс и сложность, урон, карты, снаряды.
// Богатырём управляет его игрок у себя в браузере и присылает позицию (отзывчиво, как Owner-режим в Unity);
// попадания по себе он тоже определяет сам — так уклонение и парирование честны по тому, что он видит.
import { WEAPONS, BOSSES, DIFFICULTIES, WORLDS, CARDS, PLAYER, SESSION, ABILITIES, MAGIC, RANKS, RANK_S_PLUS, rateFight, attackStep, ATTACK } from '../data.js';
import { emptyProgress, totalPoints } from '../progress.js';
import { SCENES, MAP, clampOnMap, nodeNear, nearestInteractable } from '../scenes.js';
import { Likho } from './likho.js';
import { Dummy } from './dummy.js';
import { Tasks } from './tasks.js';

const MAX_PLAYERS = 2;

export class Game {
  /** progress — хранилище сохранения (shared/progress.js): { load(count) → объект, save(объект) }. */
  constructor(flags, progress) {
    this.flags = flags;
    this.progress = progress;
    this.clock = { now: 0, dt: 0 };
    this.tasks = new Tasks(this.clock);
    this.players = [];
    this.nextId = 1;
    this.saved = progress.load(BOSSES.length);

    this.state = SESSION.TAVERN;
    this.scene = 'tavern';
    this.hut = [...MAP.nodes[0]];
    this.mapInput = new Map();
    this.stoneOpen = false;
    this.stoneBoss = -1;
    this.currentBoss = -1;
    this.difficulty = 0;
    /** Что выпало на выбор у камня перед боем, и что взято с собой в бой. */
    this.offer = null;
    this.loadout = null;
    this.preparing = false;
    this.curses = new Set();
    /** Следы бытовой магии на земле (соль, горох, угли), срезанные кусты и обгоревшие деревья. */
    this.effects = [];
    this.cutBushes = new Set();
    this.burntTrees = new Set();
    this.stats = null;
    this.boss = null;
    this.hazards = [];
    this.projectiles = [];
    this.fightResolved = false;
    this.wipeTimer = 0;
    this.autoStartAt = -1;
  }

  get sceneData() { return SCENES[this.scene]; }
  get results() { return this.saved.results; }

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
      ability: null, abilityReadyAt: 0, magic: null, magicReadyAt: 0, charm: null, beltUsed: false,
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
        this.damageBoss(player, Math.min(m.damage, 200), m.fills);
        break;
      }
      case 'fire': this.firePlayer(player, m); this.boss?.hear?.(player.x, player.z); break;
      case 'spendCard': player.cards = Math.max(0, player.cards - 1); break;
      case 'fx':
        this.broadcast({ ...m, id: player.id }, player);
        if (m.fx === 'slash') this.boss?.hear?.(player.x, player.z);
        break;

      case 'hurt': this.hurt(player, m); break;
      case 'parried': {
        const hazard = this.hazards.find((h) => h.id === m.hazard);
        if (hazard) this.removeHazard(hazard);
        if (this.stats) this.stats.parries++;
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

      case 'ability': this.useAbility(player, m); break;
      case 'magic': this.useMagic(player, m); break;
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
      case 'startFight': {
        // Снаряжение выбирают уже на локации босса, пока бой не начался.
        if (this.state !== SESSION.ARENA || !this.preparing || !this.offer) break;
        const o = this.offer;
        const loadout = {
          weapon: o.weapons.includes(m.weapon) ? m.weapon : o.weapons[0],
          ability: o.abilities.includes(m.ability) ? m.ability : o.abilities[0] ?? null,
          magic: o.magic.includes(m.magic) ? m.magic : o.magic[0] ?? null,
          charm: o.charms.includes(m.charm) ? m.charm : o.charms[0] ?? null,
          curses: [...new Set(Array.isArray(m.curses) ? m.curses : [])].filter((c) => o.curses.includes(c)),
        };
        this.beginFight(loadout);
        break;
      }
      case 'retreat': if (this.state === SESSION.ARENA && this.preparing) this.goTo(SESSION.MAP); break;
      case 'closeStone': this.stoneOpen = false; this.stoneBoss = -1; break;
      case 'leaveMap': if (this.state === SESSION.MAP && !this.stoneOpen) this.goTo(SESSION.TAVERN); break;
      case 'debug': if (this.flags.allowDebug) this.debug(player, m); break;
    }
  }

  /** Отладочное меню (только в одиночной игре). */
  debug(player, m) {
    const boss = this.boss;
    switch (m.cmd) {
      case 'godmode': this.flags.godmode = !!m.on; break;
      case 'debugwin': this.flags.debugwin = !!m.on; break;
      case 'heal': player.hp = PLAYER.maxHealth; player.downed = false; break;
      case 'cards': player.cards = CARDS.max; break;
      case 'bossDamage': if (boss) { const h = boss.health; h.hp = Math.max(h.floor, h.hp - h.max * 0.25); } break;
      case 'nextPhase': if (boss) { const h = boss.health; h.hp = h.floor; if (h.floor <= 0) h.onDepleted?.(); } break;
      case 'killBoss': if (boss) { boss.health.hp = 0; boss.health.onDepleted?.(); } break;
      case 'tavern': this.goTo(SESSION.TAVERN); break;
      case 'map': this.goTo(SESSION.MAP); break;
      case 'fight': this.startBoss(m.boss | 0, m.d | 0, false); break;
      case 'unlock': this.saved.results = this.results.map((r) => Math.max(r, 0)); this.progress.save(this.saved); break;
      case 'resetProgress': this.saved = emptyProgress(BOSSES.length); this.progress.save(this.saved); break;
    }
    this.log(`Отладка: ${m.cmd}`);
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
    } else if (m.hazard === 'body') {
      damage = this.boss?.contactDamage ?? 0;
      if (!damage) return;
    } else {
      const hazard = this.hazards.find((h) => h.id === m.hazard);
      if (hazard) {
        damage = hazard.damage;
        if (hazard.consume) this.removeHazard(hazard);
      }
    }
    if (this.flags.godmode || player.downed || !(damage > 0)) return;
    // Пояс с наузами: раз за бой смертельный удар рвёт пояс, а не богатыря.
    if (player.charm === 'belt' && !player.beltUsed && player.hp - damage <= 0 && player.hp > 1) {
      player.beltUsed = true;
      damage = player.hp - 1;
      this.floatText(player.x, player.z, 2.9, 'Пояс порвался!', '#ffd94d', 1.6);
    }
    if (this.stats) this.stats.damageTaken += Math.min(damage, player.hp);
    player.hp = Math.max(0, player.hp - damage);
    this.broadcast({ t: 'hurtFlash', id: player.id });
    if (player.hp <= 0) {
      player.downed = true;
      this.log(`Богатырь ${player.slot + 1} пал`);
    }
  }

  addCards(player, amount) { player.cards = Math.min(CARDS.max, player.cards + amount); }

  /** Урон богатыря боссу. Медвежий коготь — в полтора раза сильнее по уставшему, оглушённому, обессилевшему. */
  damageBoss(player, amount, fills) {
    if (!this.boss) return 0;
    if (player?.charm === 'bear' && this.boss.vulnerable) amount *= 1.5;
    const dealt = this.boss.applyDamage(amount);
    if (fills && player) this.addCards(player, dealt / CARDS.damagePerCard);
    return dealt;
  }

  // ---------------------------------------------------------------- Снаряжение и бытовая магия

  /** По три случайных из набора босса: оружие, бытовая способность, магия, оберег, проклятия. */
  rollOffer(boss) {
    const pools = BOSSES[boss].pools;
    const pick = (list) => shuffle([...list]).slice(0, 3);
    return { weapons: pick(pools.weapons).sort((a, b) => a - b), abilities: pick(pools.abilities), magic: pick(pools.magic),
      charms: pick(pools.charms), curses: pick(pools.curses) };
  }

  /** Магия: ветер — конусом в сторону курсора, искра и морок — в точку, живая вода — на себя. */
  useMagic(player, m) {
    const id = player.magic, spell = MAGIC[id], now = this.clock.now;
    if (!spell || this.state !== SESSION.ARENA || player.downed || now < player.magicReadyAt || !this.boss) return;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    let x = m.x, z = m.z;
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    if (spell.range && d > spell.range) { x = player.x + dx / d * spell.range; z = player.z + dz / d * spell.range; }
    [x, z] = this.clampToBossArea(x, z);
    player.magicReadyAt = now + spell.cooldown;
    this.broadcast({ t: 'magicFx', kind: id, x: player.x, z: player.z, tx: x, tz: z, delay: spell.delay ?? 0 });

    if (id === 'water') {
      const healed = Math.min(spell.heal, PLAYER.maxHealth - player.hp);
      player.hp += healed;
      this.floatText(player.x, player.z, 2.7, `+${Math.round(healed)}`, '#7be08a', 1.2);
    } else if (id === 'wind') {
      const [nx, nz] = d > 0.05 ? [dx / d, dz / d] : [player.fx, player.fz];
      this.boss.onWind?.(player.x, player.z, nx, nz, spell);
    } else if (id === 'spark') {
      this.tasks.start((function* (game) {
        yield spell.delay;
        if (game.state !== SESSION.ARENA || !game.boss) return;
        game.flash(x, z, spell.radius);
        game.shake(0.25, 0.3);
        // От молнии укрытие не спасает. Если попала только в край куста — сидящему в нём достанется от огня.
        const struck = Math.hypot(game.boss.x - x, game.boss.z - z) < spell.radius + (game.boss.radius ?? 0.5);
        for (const i of game.bushesTouching(x, z, spell.radius)) game.cutBush(i, struck ? 0 : spell.damage);
        game.burnTrees(x, z, spell.radius);
        if (struck) {
          const strike = () => game.damageBoss(player, spell.damage, false);
          if (game.boss.throughCover) game.boss.throughCover(strike); else strike();
        }
      })(this));
    } else if (id === 'decoy') {
      this.decoy = { id: 'decoy', x, z, expire: now + spell.duration, downed: false, owner: player.id };
    }
  }

  /** Морок-двойник, пока не рассеялся (или null). */
  activeDecoy() { return this.decoy && this.clock.now < this.decoy.expire ? this.decoy : null; }

  clampToBossArea(x, z) {
    const radius = this.sceneData.bossRadius ?? 14, r = Math.hypot(x, z);
    return r > radius ? [x * radius / r, z * radius / r] : [x, z];
  }

  /** Бросить способность в точку (x, z). Серп — срезает ближайший куст, бросать не нужно. */
  useAbility(player, m) {
    const id = player.ability, a = ABILITIES[id], now = this.clock.now;
    if (!a || this.state !== SESSION.ARENA || player.downed || now < player.abilityReadyAt || !this.boss) return;
    if (id === 'sickle') {
      const bush = this.nearestBush(player.x, player.z, a.range);
      if (bush < 0) { this.floatText(player.x, player.z, 2.6, 'Срезать нечего', '#cfc4b0', 1); return; }
      player.abilityReadyAt = now + a.cooldown;
      this.cutBush(bush, a.damage);
      this.broadcast({ t: 'abilityFx', kind: id, x: player.x, z: player.z, tx: this.sceneData.bushes[bush].x, tz: this.sceneData.bushes[bush].z });
      return;
    }
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    let x = m.x, z = m.z;
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    if (d > a.range) { x = player.x + dx / d * a.range; z = player.z + dz / d * a.range; }
    [x, z] = this.clampToBossArea(x, z);
    player.abilityReadyAt = now + a.cooldown;
    // Бросок летит 0.35 с, потом ложится на землю.
    this.broadcast({ t: 'abilityFx', kind: id, x: player.x, z: player.z, tx: x, tz: z, flight: 0.35 });
    this.tasks.start((function* (game) {
      yield 0.35;
      if (game.state !== SESSION.ARENA) return;
      game.effects.push({ id: game.nextId++, kind: id, x, z, r: a.radius, owner: player, born: game.clock.now,
        expire: game.clock.now + a.duration, nextTick: game.clock.now });
      if (id === 'coals') {
        for (const i of game.bushesTouching(x, z, a.radius)) game.cutBush(i, a.damage * 2);
        game.burnTrees(x, z, a.radius);
      }
      game.boss?.onAbility?.(id, x, z);
    })(this));
  }

  nearestBush(x, z, range) {
    let best = -1, bestDistance = range;
    (this.sceneData.bushes ?? []).forEach((b, i) => {
      const d = Math.hypot(b.x - x, b.z - z);
      if (!this.cutBushes.has(i) && d <= bestDistance) { best = i; bestDistance = d; }
    });
    return best;
  }

  /** Кусты, которых касается круг радиуса r. */
  bushesTouching(x, z, r) {
    const { bushes = [], bushRadius = 0 } = this.sceneData;
    return bushes.map((b, i) => i).filter((i) => !this.cutBushes.has(i)
      && Math.hypot(bushes[i].x - x, bushes[i].z - z) <= r + bushRadius);
  }

  /** Деревья, которых коснулся огонь или молния, обгорают: стоят и прячут как прежде, только чёрные. */
  burnTrees(x, z, r) {
    (this.sceneData.trees ?? []).forEach((t, i) => { if (Math.hypot(t.x - x, t.z - z) <= r + t.r) this.burntTrees.add(i); });
  }

  /** Куст срезан или сгорел — до конца боя. Если в нём сидело Лихо — получает урон и выскакивает. */
  cutBush(index, damage) {
    const bush = this.sceneData.bushes[index];
    this.cutBushes.add(index);
    this.boss?.onBushCut?.(bush, damage);
  }

  isBushCut(x, z) {
    for (const i of this.cutBushes) { const b = this.sceneData.bushes[i]; if (Math.hypot(b.x - x, b.z - z) < 0.6) return true; }
    return false;
  }

  /** Есть ли на земле след способности kind, накрывающий (x, z) с запасом pad. */
  effectAt(kind, x, z, pad = 0) {
    return this.effects.some((e) => e.kind === kind && Math.hypot(e.x - x, e.z - z) < e.r + pad);
  }

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

  /**
   * На локацию босса. Бой не начинается, пока богатырь не выберет снаряжение из случайного набора (prepare).
   * Без выбора (отладка, автозапуск) — сразу в бой с первым из набора и без проклятий.
   */
  startBoss(boss, difficulty, prepare = true) {
    if (!BOSSES[boss] || !this.isWorldUnlocked(BOSSES[boss].world)) return;
    this.currentBoss = boss;
    this.difficulty = Math.min(Math.max(difficulty | 0, 0), DIFFICULTIES.length - 1);
    this.goTo(SESSION.ARENA, BOSSES[boss].arena);
    const o = this.rollOffer(boss);
    if (prepare) {
      this.offer = o;
      this.preparing = true;
      this.announce(`${BOSSES[boss].name} — выбери снаряжение`);
    } else this.beginFight({ weapon: o.weapons[0], ability: o.abilities[0] ?? null, magic: o.magic[0] ?? null, charm: o.charms[0] ?? null, curses: [] });
  }

  /** Снаряжение выбрано — босс выходит, бой начинается. */
  beginFight(loadout) {
    const entry = BOSSES[this.currentBoss], d = DIFFICULTIES[this.difficulty];
    this.preparing = false;
    this.offer = null;
    this.loadout = loadout;
    this.curses = new Set(loadout.curses);
    for (const p of this.players) {
      p.weapon = loadout.weapon;
      p.ability = loadout.ability;
      p.magic = loadout.magic;
      p.charm = loadout.charm;
      p.abilityReadyAt = 0;
      p.magicReadyAt = 0;
      p.beltUsed = false;
    }
    this.stats = { start: this.clock.now, damageTaken: 0, parries: 0 };
    this.boss = entry.kind === 'likho' ? new Likho(this, d) : new Dummy(this, d, entry.name);
    this.announce(`${entry.name} — ${d.name}`);
  }

  goTo(state, scene = state === SESSION.TAVERN ? 'tavern' : null) {
    this.state = state;
    if (scene) this.scene = scene;
    this.stoneOpen = false;
    this.stoneBoss = -1;
    this.offer = null;
    this.preparing = false;
    this.stats = null;
    this.decoy = null;
    this.effects = [];
    this.cutBushes = new Set();
    this.burntTrees = new Set();
    this.curses = new Set();
    this.mapInput.clear();
    this.fightResolved = false;
    this.victory = null;
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
      p.beltUsed = false;
      p.abilityReadyAt = 0;
      // Бытовая способность, магия и оберег — только в бою (выдаются в beginFight).
      p.ability = null;
      p.magic = null;
      p.charm = null;
      if (state !== SESSION.MAP) {
        const [x, z] = this.sceneData.spawns[p.slot];
        this.teleport(p, x, z, 0, 1);
      }
    });
    this.log(`Сцена ${state === SESSION.ARENA ? this.scene : state}, игроков: ${this.players.length}`);

    if (state !== SESSION.ARENA) this.announce(state === SESSION.MAP ? 'Карта' : 'Избушка на курьих ножках');
  }

  sessionInfo() {
    return {
      state: this.state, scene: this.state === SESSION.MAP ? 'map' : this.scene,
      boss: this.currentBoss, difficulty: this.difficulty, ...this.progressInfo(),
    };
  }

  progressInfo() {
    const s = this.saved;
    return { results: s.results, ranks: s.ranks, points: totalPoints(s), coins: s.coins };
  }

  /**
   * Записать победу — в тот же миг, когда босс пал (даже если богатырь сразу сбежит с арены,
   * пока босс ещё «испускает последний вздох»). Повторный вызов ничего не делает.
   */
  recordVictory() {
    if (this.state !== SESSION.ARENA || this.victory) return;
    const boss = this.currentBoss, world = BOSSES[boss].world, saved = this.saved;
    const nextWasLocked = !this.isWorldUnlocked(world + 1);
    if (this.difficulty > saved.results[boss]) saved.results[boss] = this.difficulty;

    // Рейтинг: время, полученный урон, парирования, сложность. Очки прокачки по каждому боссу — по лучшему результату,
    // монеты от трактирщика — за каждую победу.
    const stats = this.stats ?? { start: this.clock.now, damageTaken: 0, parries: 0 };
    const time = this.clock.now - stats.start;
    const rating = rateFight({ time, par: BOSSES[boss].par, damageTaken: stats.damageTaken, parries: stats.parries, difficulty: this.difficulty });
    const rank = RANKS[rating.rank];
    const curses = this.curses.size, cursePoints = Math.min(curses, rank.curses);
    const gained = Math.max(0, rank.points - saved.rankPoints[boss]) + Math.max(0, cursePoints - saved.cursePoints[boss]);
    const firstStar = rating.rank === RANK_S_PLUS && saved.ranks[boss] < RANK_S_PLUS;
    saved.rankPoints[boss] = Math.max(saved.rankPoints[boss], rank.points);
    saved.cursePoints[boss] = Math.max(saved.cursePoints[boss], cursePoints);
    saved.ranks[boss] = Math.max(saved.ranks[boss], rating.rank);
    saved.coins += rank.coins;
    this.progress.save(saved);

    this.result = {
      boss, difficulty: this.difficulty, rank: rating.rank, score: rating.score, parts: rating.parts,
      time: Math.round(time), damageTaken: Math.round(stats.damageTaken), parries: stats.parries,
      curses, cursePoints, rankPoints: rank.points, gained, coinsGained: rank.coins, firstStar, ...this.progressInfo(),
    };
    this.broadcast({ t: 'result', ...this.result });

    const [defeated, total] = this.worldProgress(world);
    this.log(`Победа над «${BOSSES[boss].name}» (${DIFFICULTIES[this.difficulty].name}), рейтинг ${rank.name}. ${WORLDS[world].name}: ${defeated}/${total}`);
    const next = WORLDS[world + 1];
    this.victory = nextWasLocked && next && this.isWorldUnlocked(world + 1)
      ? `Победа! Открыт путь в ${next.name}` : `Победа над «${BOSSES[boss].name}»!`;
  }

  /** Бой окончен победой: объявление и через 4 секунды — к карте. */
  bossDefeated() {
    if (this.state !== SESSION.ARENA || this.fightResolved) return;
    this.fightResolved = true;
    this.recordVictory();
    this.announce(this.victory);
    this.tasks.start((function* (game) { yield 4; game.goTo(SESSION.MAP); })(this));
  }

  // ---------------------------------------------------------------- Действия для боссов

  announce(text) { this.log(`Объявление: ${text}`); this.broadcast({ t: 'announce', text }); }
  shake(amount, duration) { this.broadcast({ t: 'shake', amount, duration }); }
  flash(x, z, r) { this.broadcast({ t: 'flash', x, z, r }); }
  floatText(x, z, y, text, color, duration = 1.2) { this.broadcast({ t: 'text', x, z, y, text, color, duration }); }
  showDamage(x, z, amount) { this.broadcast({ t: 'damage', x, z, amount: Math.round(amount) }); }
  /** Подсказки атак (красные круги и полосы). Возвращают номер — чтобы убрать подсказку, если атака отменилась. */
  telegraphCircle(x, z, r, duration, color) {
    const id = this.nextId++;
    this.broadcast({ t: 'tele', id, shape: 'circle', x, z, r, duration, color });
    return id;
  }
  telegraphLine(x, z, dx, dz, length, width, duration) {
    const id = this.nextId++;
    this.broadcast({ t: 'tele', id, shape: 'line', x, z, dx, dz, length, width, duration, color: 'danger' });
    return id;
  }
  cancelTelegraph(id) { this.broadcast({ t: 'teleCancel', id }); }

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
      this.startBoss(this.flags.boss, this.flags.difficulty, false);
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

    // Горящие угли жгут босса два раза в секунду.
    this.effects = this.effects.filter((e) => now < e.expire);
    for (const e of this.effects) {
      if (e.kind !== 'coals' || now < e.nextTick || !this.boss) continue;
      e.nextTick = now + 0.5;
      if (Math.hypot(this.boss.x - e.x, this.boss.z - e.z) < e.r + (this.boss.radius ?? 0.5))
        this.damageBoss(e.owner, ABILITIES.coals.damage / 2, false);
    }

    // Снаряды богатырей: попадание по боссу.
    for (const p of this.projectiles) {
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (!this.boss || p.hitBoss) continue;
      if (Math.hypot(p.x - this.boss.x, p.z - this.boss.z) < this.boss.radius + 0.25) {
        this.damageBoss(p.owner, p.damage, p.fills);
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
        boss: this.currentBoss, difficulty: this.difficulty, offer: this.offer, preparing: this.preparing, curses: [...this.curses], ...this.progressInfo() },
      players: this.players.map((p) => ({
        id: p.id, slot: p.slot, x: r2(p.x), z: r2(p.z), fx: r2(p.fx), fz: r2(p.fz), hp: Math.round(p.hp), downed: p.downed,
        weapon: p.weapon, cards: Math.round(p.cards * 100) / 100, dropped: p.dropped, cursed: p.cursed,
        slippery: (p.slipperyUntil ?? 0) > now, anim: p.anim,
        ability: p.ability, abilityCooldown: Math.max(0, r2(p.abilityReadyAt - now)), charm: p.charm, beltUsed: p.beltUsed,
        magic: p.magic, magicCooldown: Math.max(0, r2(p.magicReadyAt - now)),
      })),
      effects: this.effects.map((e) => ({ id: e.id, kind: e.kind, x: r2(e.x), z: r2(e.z), r: e.r, left: r2(e.expire - now) })),
      cut: [...this.cutBushes],
      burnt: [...this.burntTrees],
      decoy: this.activeDecoy() ? { x: r2(this.decoy.x), z: r2(this.decoy.z), owner: this.decoy.owner, left: r2(this.decoy.expire - now) } : null,
      boss: this.boss?.snapshot() ?? null,
      hazards: this.hazards.map((h) => h.type === 'proj'
        ? { id: h.id, type: 'proj', x: r2(h.x), z: r2(h.z), y: h.y, vx: r2(h.vx), vz: r2(h.vz), r: h.r, parry: h.parryable, dmg: h.damage }
        : { id: h.id, type: 'zone', kind: h.kind, look: h.look, x: r2(h.x), z: r2(h.z), r: h.r, dmg: h.damage, stun: h.stun }),
      arrows: this.projectiles.map((p) => ({ id: p.id, x: r2(p.x), z: r2(p.z), vx: r2(p.vx), vz: r2(p.vz) })),
    };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
function normalize(x, z) { const l = Math.hypot(x, z); return l > 1e-5 ? [x / l, z / l] : [0, 1]; }
function rotateY(x, z, degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
export { nearestInteractable };
