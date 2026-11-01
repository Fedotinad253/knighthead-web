// Свой богатырь: управление, атаки и защита считаются здесь, в браузере игрока (отзывчиво),
// урон, карты и снаряды — на сервере. Перенесено из PlayerController, PlayerCombat, PlayerDefense, PlayerInteractor.
import { WEAPONS, PLAYER as P, ATTACK, ABILITIES, MAGIC, attackStep, stepDuration, CARDS } from '../shared/data.js';
import { resolveCollisions, nearestInteractable } from '../shared/scenes.js';
import { playSound, blip } from './assets.js';
import { bogatyrPose } from './rig.js';
import { ORB_LIFT, ORB_RADIUS } from './view.js';

/** Толщина богатыря по глубине: снаряд, пролетевший дальше этого перед ним или за ним, не задевает. */
const BODY_DEPTH = 0.45;

const rotateY = (x, z, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
};

export class LocalPlayer {
  constructor(game) {
    this.game = game;
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
    this.fx = 0; this.fz = 1;
    this.rollStart = -10; this.rollEnd = 0; this.nextRoll = 0; this.rollX = 0; this.rollZ = 1;
    this.stunnedUntil = 0;
    this.attack = null;
    this.lightIndex = 0; this.comboExpire = 0;
    this.buffered = null; this.bufferedAt = 0;
    this.pendingCards = 0;
    this.parryUntil = 0; this.parryReadyAt = 0;
    this.invulnerableUntil = 0; this.blinkUntil = 0;
    this.slipperyUntil = 0;
    this.processed = new Map();
    this.reviveProgress = 0;
    this.focused = null;
    this.nextSend = 0;
    this.nextPickup = 0;
    this.speed = 0;
  }

  get now() { return this.game.now; }
  get me() { return this.game.me; }
  get weapon() { return WEAPONS[this.me?.weapon ?? 0]; }
  get rolling() { return this.now < this.rollEnd; }
  /** Доля пройденного переката: 0..1 (0 — не катится). */
  get rollProgress() { return this.rolling ? (this.now - this.rollStart) / P.rollDuration : 0; }
  get stunned() { return this.now < this.stunnedUntil; }
  get parrying() { return this.now < this.parryUntil; }
  get invulnerable() {
    return this.now < this.invulnerableUntil || this.me?.downed || this.game.cutscene;
  }
  get phase() {
    const a = this.attack, s = a.step;
    return a.time < s.windup ? 'windup' : a.time < s.windup + s.active ? 'active' : 'recovery';
  }
  /** Взмах руки для анимации: 0 → 1 к удару → 0 к концу. */
  get swing() {
    if (!this.attack) return 0;
    const a = this.attack, s = a.step;
    if (a.time < s.windup) return -0.35 * (a.time / Math.max(0.01, s.windup));
    const t = (a.time - s.windup) / Math.max(0.01, s.active + s.recovery);
    return Math.max(0, 1 - t) * (t < 0.2 ? t / 0.2 : 1);
  }

  teleport(x, z, fx, fz) {
    this.x = x; this.z = z; this.vx = 0; this.vz = 0;
    if (fx || fz) { this.fx = fx; this.fz = fz; }
    this.rollEnd = 0;
    this.cancelAttack();
  }

  aim() {
    const [mx, mz] = this.game.view.unproject(this.game.input.mouseX, this.game.input.mouseY);
    const dx = mx - this.x, dz = mz - this.z, l = Math.hypot(dx, dz);
    return l > 0.05 ? [dx / l, dz / l] : [this.fx, this.fz];
  }

  setFacing(x, z) { const l = Math.hypot(x, z); if (l > 1e-3) { this.fx = x / l; this.fz = z / l; } }

  // ---------------------------------------------------------------- Кадр

  update(dt) {
    const game = this.game, input = game.input, me = this.me;
    if (!me) return;
    // Пока выбирается снаряжение перед боем, богатырь стоит.
    const locked = game.cutscene || game.dialogueOpen || !!game.session?.preparing || !!me.dragged;
    // Тащат лопатой или гуси: атаки и перекат — чтобы вырваться.
    if (me.dragged && (input.lightPressed || input.heavyPressed || input.dashPressed || input.interactPressed)) game.send({ t: 'struggle' });

    if (this.stunned) { this.vx = this.vz = 0; this.rollEnd = 0; }

    // Движение.
    if (locked || me.downed || this.stunned) {
      this.vx = this.vz = 0;
      if (locked || me.downed) this.cancelAttack();
    } else {
      if (input.dashPressed) this.tryRoll();
      if (this.rolling) {
        // Перекат как в Enter the Gungeon: быстрый старт, к концу замедляется; направление не меняется.
        const p = this.rollProgress;
        const v = P.rollDistance / (P.rollDuration * 0.8) * (1 - 0.6 * p * p);
        this.vx = this.rollX * v; this.vz = this.rollZ * v;
      } else {
        // После рывка не «скользим» с его скоростью.
        const l = Math.hypot(this.vx, this.vz);
        if (l > P.speed) { this.vx *= P.speed / l; this.vz *= P.speed / l; }
        const [mx, mz] = input.move;
        const speed = this.attack ? P.speed * this.weapon.moveWhileAttacking : P.speed;
        this.accelerate(mx * speed, mz * speed, dt);
        if (!this.attack) this.setFacing(...this.aim());
      }
    }
    const ox = this.x, oz = this.z;
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const boss = game.boss;
    const extra = boss && boss.pose !== 'Dead' && game.scene !== 'tavern' && !boss.airborne ? [{ type: 'circle', x: boss.x, z: boss.z, r: boss.radius ?? 0.55 }] : [];
    if (boss?.hut && !boss.hut.fallen && !me.dragged) extra.push({ type: 'circle', x: boss.hut.x, z: boss.hut.z, r: boss.hut.r });
    [this.x, this.z] = resolveCollisions(game.sceneData, nx, nz, P.radius, extra);
    this.speed = dt > 0 ? Math.hypot(this.x - ox, this.z - oz) / dt : 0;

    if (!locked && !me.downed && !this.stunned) { this.updateCombat(dt); this.updateAbility(); }
    if (!me.downed) this.updateDefense();
    this.updateInteract(dt, locked);
    this.forgetOldHazards();

    if (this.now >= this.nextSend) {
      this.nextSend = this.now + 0.05;
      game.send({ t: 'state', x: r2(this.x), z: r2(this.z), fx: r2(this.fx), fz: r2(this.fz), anim: this.anim() });
    }
  }

  anim() {
    return {
      swing: Math.round(this.swing * 100) / 100,
      parry: this.parrying ? Math.round((this.parryUntil - this.now) * 100) / 100 : 0,
      blink: this.now < this.blinkUntil ? Math.round((this.blinkUntil - this.now) * 100) / 100 : 0,
      stun: this.stunned,
      roll: Math.round(this.rollProgress * 100) / 100,
    };
  }

  /** Движение как в Enter the Gungeon: короткий разгон и чуть более резкое торможение. */
  accelerate(dx, dz, dt) {
    const speedingUp = dx * dx + dz * dz > 0.01 && dx * this.vx + dz * this.vz >= 0 && dx * dx + dz * dz >= this.vx * this.vx + this.vz * this.vz;
    const rate = (speedingUp ? P.acceleration : P.deceleration) * dt;
    const ex = dx - this.vx, ez = dz - this.vz, l = Math.hypot(ex, ez);
    if (l <= rate) { this.vx = dx; this.vz = dz; } else { this.vx += ex / l * rate; this.vz += ez / l * rate; }
  }

  tryRoll() {
    // Перекат прерывает любое действие: замах, удар, восстановление.
    if (this.now < this.nextRoll) return;
    this.cancelAttack();
    const [mx, mz] = this.game.input.move;
    if (Math.hypot(mx, mz) > 0.05) { this.rollX = mx; this.rollZ = mz; } else { this.rollX = this.fx; this.rollZ = this.fz; }
    this.setFacing(this.rollX, this.rollZ);
    this.rollStart = this.now;
    this.rollEnd = this.now + P.rollDuration;
    this.nextRoll = this.rollEnd + P.rollCooldown;
    blip('dash');
  }

  stun(seconds) {
    this.stunnedUntil = Math.max(this.stunnedUntil, this.now + seconds);
    this.vx = this.vz = 0;
    this.cancelAttack();
    this.game.send({ t: 'stunned' });
  }

  // ---------------------------------------------------------------- Атаки

  updateCombat(dt) {
    const input = this.game.input, me = this.me;

    // Без оружия не бьём — подходим к нему, и оно само поднимается.
    if (me.dropped) {
      this.cancelAttack();
      if (Math.hypot(me.dropped[0] - this.x, me.dropped[1] - this.z) < 1.3 && this.now >= this.nextPickup) {
        this.nextPickup = this.now + 0.3;
        this.game.send({ t: 'pickup' });
      }
      return;
    }

    if (input.lightPressed) this.buffer(input.cardHeld ? ATTACK.CARD_COMBO : ATTACK.LIGHT);
    if (input.heavyPressed) this.buffer(input.cardHeld ? ATTACK.CARD_STRIKE : ATTACK.HEAVY);

    if (this.attack) this.tickAttack(dt);
    // Во время переката не бьём — нажатие сработает сразу после него (буфер ввода).
    if (this.rolling) { if (this.buffered !== null) this.bufferedAt = this.now; return; }
    if (!this.attack && this.buffered !== null && this.now - this.bufferedAt <= P.inputBuffer) {
      const kind = this.buffered;
      this.buffered = null;
      this.startAttack(kind);
    }
  }

  buffer(kind) { this.buffered = kind; this.bufferedAt = this.now; }

  tickAttack(dt) {
    const a = this.attack;
    // Волчий клык: когда здоровья меньше половины, атаки на треть быстрее.
    a.time += dt * (this.me?.charm === 'wolf' && this.me.hp < P.maxHealth / 2 ? 1.33 : 1);
    if (!a.hitDone && a.time >= a.step.windup) {
      a.hitDone = true;
      this.performHit();
      if (!this.attack) return;
    }
    // Следующий удар лёгкого комбо можно начать уже в восстановлении.
    if (a.kind === ATTACK.LIGHT && this.phase === 'recovery' && this.buffered === ATTACK.LIGHT && this.now - this.bufferedAt <= P.inputBuffer) {
      this.buffered = null;
      this.finishLightStep();
      this.startAttack(ATTACK.LIGHT);
      return;
    }
    if (a.time < stepDuration(a.step)) return;
    if (a.kind === ATTACK.CARD_COMBO && a.index + 1 < this.weapon.cardCombo.length) {
      a.index++;
      a.step = this.weapon.cardCombo[a.index];
      a.time = 0; a.hitDone = false;
      return;
    }
    if (a.kind === ATTACK.LIGHT) this.finishLightStep();
    this.attack = null;
  }

  finishLightStep() {
    this.lightIndex = (this.lightIndex + 1) % this.weapon.light.length;
    this.comboExpire = this.now + this.weapon.comboWindow;
    this.attack = null;
  }

  startAttack(kind) {
    const weapon = this.weapon;
    // Карт не хватает — обычная атака той же кнопкой.
    if (kind === ATTACK.CARD_COMBO || kind === ATTACK.CARD_STRIKE) {
      if ((this.me.cards ?? 0) - this.pendingCards < 1) kind = kind === ATTACK.CARD_COMBO ? ATTACK.LIGHT : ATTACK.HEAVY;
      else { this.pendingCards += 1; this.game.send({ t: 'spendCard' }); }
    }
    if (kind === ATTACK.LIGHT && this.now > this.comboExpire) this.lightIndex = 0;
    const index = kind === ATTACK.LIGHT ? this.lightIndex : 0;
    const [ax, az] = this.aim();
    this.aimX = ax; this.aimZ = az;
    this.setFacing(ax, az);
    this.attack = { kind, index, step: attackStep(weapon, kind, index), time: 0, hitDone: false };
  }

  cancelAttack() { this.attack = null; this.buffered = null; }

  performHit() {
    const a = this.attack, step = a.step, game = this.game;
    const card = a.kind === ATTACK.CARD_COMBO || a.kind === ATTACK.CARD_STRIKE;
    if (a.kind === ATTACK.CARD_COMBO || step.projectile) {
      [this.aimX, this.aimZ] = this.aim();
      this.setFacing(this.aimX, this.aimZ);
    }

    // Проклятие: «скользкие руки» — удар оборачивается неудачей.
    if (this.now < this.slipperyUntil) {
      this.slipperyUntil = 0;
      this.cancelAttack();
      if (step.projectile) {
        game.vfx.text(this.x, this.z, 2.6, 'Рикошет!', '#d973ff', 1.2);
        game.send({ t: 'ricochet', x: this.x + this.aimX * 0.6, z: this.z + this.aimZ * 0.6, dx: this.aimX, dz: this.aimZ });
      } else {
        game.vfx.text(this.x, this.z, 2.6, 'Оружие выскользнуло!', '#d973ff', 1.4);
        const [tx, tz] = rotateY(this.aimX, this.aimZ, -60 + Math.random() * 120);
        const d = 3 + Math.random() * 1.5;
        const [dx, dz] = resolveCollisions(game.sceneData, this.x + tx * d, this.z + tz * d, 0.3);
        game.send({ t: 'drop', x: dx, z: dz });
      }
      return;
    }

    if (step.projectile) {
      game.send({ t: 'fire', x: r2(this.x + this.aimX * 0.6), z: r2(this.z + this.aimZ * 0.6), dx: this.aimX, dz: this.aimZ, kind: a.kind, step: a.index });
      blip('shot');
      return;
    }

    const color = card ? 'rgba(255,204,51,0.6)' : 'rgba(255,255,255,0.35)';
    game.vfx.slash(this.x, this.z, this.aimX, this.aimZ, step.range, step.arc, color);
    game.send({ t: 'fx', fx: 'slash', x: r2(this.x), z: r2(this.z), dx: this.aimX, dz: this.aimZ, range: step.range, arc: step.arc, color });
    blip('slash');

    // Попадание: расстояние до края цели и угол дуги.
    const reaches = (x, z, r) => {
      const bx = x - this.x, bz = z - this.z, d = Math.hypot(bx, bz);
      const surface = Math.max(0, d - r);
      if (surface > step.range) return false;
      const tx = d > 1e-3 ? bx / d * surface : 0, tz = d > 1e-3 ? bz / d * surface : 0;
      const angle = Math.acos(Math.max(-1, Math.min(1, (tx * this.aimX + tz * this.aimZ) / Math.max(1e-3, Math.hypot(tx, tz))))) * 180 / Math.PI;
      return tx * tx + tz * tz < 0.5 || angle <= step.arc / 2;
    };
    const boss = game.boss;
    if (!boss || boss.hp <= 0) return;
    // Яга на крыше: бьём по ногам избушки. В воздухе ближним оружием не достать.
    const hut = boss.hut;
    if (hut?.active && !hut.fallen && boss.onRoof) { if (reaches(hut.x, hut.z, hut.r)) game.send({ t: 'hitHut' }); return; }
    if (boss.airborne) return;
    if (reaches(boss.x, boss.z, boss.radius ?? 0.55)) game.send({ t: 'hit', damage: step.damage, fills: !card });
  }

  onCardsChanged() { this.pendingCards = 0; }

  // ---------------------------------------------------------------- Бытовая способность и магия

  /** Готова ли способность (перезарядку считает логика боя; здесь — чтобы не слать лишнего). */
  get abilityReady() { return !!this.me?.ability && (this.me.abilityCooldown ?? 0) <= 0 && this.now >= (this.abilitySentAt ?? 0) + 0.3; }

  get magicReady() { return !!this.me?.magic && (this.me.magicCooldown ?? 0) <= 0 && this.now >= (this.magicSentAt ?? 0) + 0.3; }

  /** Q — бросить способность под курсор (серп срезает ближайший куст сам). E — магия в сторону курсора. */
  updateAbility() {
    if (this.game.input.magicPressed && !this.rolling && this.magicReady) {
      const [mx, mz] = this.game.view.unproject(this.game.input.mouseX, this.game.input.mouseY);
      this.magicSentAt = this.now;
      this.cancelAttack();
      if (this.me.magic !== 'water') this.setFacing(mx - this.x, mz - this.z);
      this.game.send({ t: 'magic', x: r2(mx), z: r2(mz) });
      blip(MAGIC[this.me.magic]?.range ? 'dash' : 'shot');
    }
    if (!this.game.input.abilityPressed || this.rolling || !this.abilityReady) return;
    const a = ABILITIES[this.me.ability];
    const [mx, mz] = this.game.view.unproject(this.game.input.mouseX, this.game.input.mouseY);
    this.abilitySentAt = this.now;
    this.cancelAttack();
    this.setFacing(mx - this.x, mz - this.z);
    this.game.send({ t: 'ability', x: r2(mx), z: r2(mz) });
    blip(a?.duration ? 'shot' : 'slash');
  }

  // ---------------------------------------------------------------- Защита

  updateDefense() {
    const game = this.game;
    if (game.input.parryPressed && this.now >= this.parryReadyAt && !this.stunned && !game.dialogueOpen) {
      this.parryUntil = this.now + P.parryWindow;
      this.parryReadyAt = this.parryUntil + P.parryCooldown;
      // Парирование, как и перекат, прерывает текущую атаку в любой фазе.
      this.cancelAttack();
    }

    const touching = [];
    for (const h of game.liveHazards()) {
      const key = h.key ?? String(h.id);
      if (this.processed.has(key)) continue;
      if (this.touches(h)) touching.push({ ...h, key });
    }
    // Сначала парирование: успешное защищает и от обычного снаряда, задевшего в тот же момент.
    if (this.parrying) {
      for (const h of touching) {
        if (!h.parry || this.processed.has(h.key)) continue;
        this.processed.set(h.key, this.now);
        this.invulnerableUntil = this.now + P.parryInvulnerability;
        game.vfx.parryFlash(this.x, this.z);
        playSound('parry');
        game.vfx.text(this.x, this.z, 2.5, 'ПАРИРОВАНО!', '#ff59c7', 1.3);
        game.removeHazardLocally(h.id);
        game.send({ t: 'parried', hazard: h.id });
      }
    }
    for (const h of touching) {
      if (this.processed.has(h.key)) continue;
      // Во время неуязвимости опасность не помечаем: если всё ещё касается — ударит позже.
      if (this.invulnerable) continue;
      if (!h.repeat) this.processed.set(h.key, this.now);
      this.invulnerableUntil = this.now + P.hitInvulnerability;
      this.blinkUntil = this.now + P.hitInvulnerability;
      game.send({ t: 'hurt', hazard: h.id, damage: h.dmg });
      game.view.shake(0.15, 0.2, this.now);
      blip('hurt');
      if (h.stun > 0) this.stun(h.stun);
      // Снаряд гаснет от удара, а всадник скачет дальше.
      if (h.type === 'proj' && !h.keep) game.removeHazardLocally(h.id);
    }
  }

  /**
   * Задевает ли опасность богатыря. Снаряды в воздухе — по очертаниям всей модельки (голова, руки, ноги,
   * плащ) в текущей позе, на той высоте, где снаряд нарисован. Удары по земле и тело босса — по кругу у ног.
   */
  touches(h) {
    if (h.type === 'fence') return Math.hypot(this.x, this.z) > h.R;
    if (h.type !== 'proj' || h.wide) return Math.hypot(h.x - this.x, h.z - this.z) < h.r + P.hurtRadius;
    if (Math.abs(h.z - this.z) > BODY_DEPTH) return false;
    const avatar = this.game.avatars.get(this.me?.id);
    if (!avatar) return Math.hypot(h.x - this.x, h.z - this.z) < h.r + P.hurtRadius;
    return avatar.rig.hits(h.x - this.x, (h.y ?? 1.2) * ORB_LIFT, ORB_RADIUS * 0.85, bogatyrPose(avatar));
  }

  forgetOldHazards() {
    for (const [key, time] of this.processed) if (this.now - time > 5) this.processed.delete(key);
  }

  // ---------------------------------------------------------------- Взаимодействие

  updateInteract(dt, locked) {
    const game = this.game, input = game.input, me = this.me;
    this.focused = null;
    this.reviveTarget = null;
    if (locked || me.downed) { this.reviveProgress = 0; return; }

    // Упавший напарник рядом — поднять, удерживая взаимодействие.
    const downed = game.players.find((p) => p.id !== me.id && p.downed && Math.hypot(p.x - this.x, p.z - this.z) <= P.reviveRadius);
    if (downed) {
      this.reviveTarget = downed;
      if (input.interactHeld) {
        this.reviveProgress += dt;
        if (this.reviveProgress >= P.reviveDuration) { this.reviveProgress = 0; game.send({ t: 'revive', target: downed.id }); }
      } else this.reviveProgress = 0;
      return;
    }
    this.reviveProgress = 0;

    const boss = game.boss;
    if (boss?.finisherReady && Math.hypot(boss.x - this.x, boss.z - this.z) < 3.2) {
      this.focused = { id: 'finisher', prompt: boss.finisherLabel ?? 'Выколоть глаз' };
    } else {
      const item = nearestInteractable(game.sceneData, this.x, this.z);
      // В первом бою с Ягой бежать некуда.
      if (item && !(item.kind === 'exit' && game.session?.firstYaga)) this.focused = { ...item, prompt: this.promptFor(item) };
    }
    if (this.focused && input.interactPressed) {
      if (this.focused.kind === 'npc') game.hud.dialogue(this.focused);
      else game.send({ t: 'interact', id: this.focused.id });
    }
  }

  promptFor(item) {
    if (item.kind === 'npc') return `Поговорить: ${item.speaker}`;
    if (item.kind === 'rack') {
      const w = WEAPONS[item.weapon];
      return this.me.weapon === item.weapon ? `${w.name} (в руках)` : `Взять: ${w.name}`;
    }
    return item.prompt;
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
export { CARDS };
