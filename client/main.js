// KnightHead в браузере: игровой цикл, сцены. Логика боя (shared/sim) присылает снимки состояния
// 30 раз в секунду; босс плавно догоняет их (с небольшой задержкой), снаряды летят по своей скорости.
// Сейчас игра одиночная — логика идёт прямо в странице (LocalWorld); сетевой кооп вернём позже (connect).
import { SESSION, BOSSES } from '../shared/data.js';
import { SCENES } from '../shared/scenes.js';
import { View } from './view.js';
import { Input } from './input.js';
import { assets, ALL_IMAGES, loadSound, unlockAudio, playSound } from './assets.js';
import { createBogatyr, BogatyrAnimator, createLikho, LikhoAnimator } from './rig.js';
import { LocalPlayer } from './player.js';
import { Vfx } from './vfx.js';
import { drawWorld } from './world.js';
import { MapView } from './mapview.js';
import { Hud } from './hud.js';
import { LocalWorld } from './local.js';

const INTERPOLATION_DELAY = 0.09;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.view = new View(this.canvas);
    this.input = new Input(this.canvas);
    this.vfx = new Vfx(this);
    this.hud = new Hud(this);
    this.mapView = new MapView(this);
    this.local = new LocalPlayer(this);
    this.now = 0;
    this.myId = null;
    this.session = null;
    this.scene = 'tavern';
    this.snaps = [];
    this.serverOffset = null;
    this.players = [];
    this.avatars = new Map();
    this.boss = null;
    this.removed = new Set();
    this.lastCards = null;
  }

  get sceneData() { return SCENES[this.scene] ?? SCENES.tavern; }
  get me() { return this.latest?.players.find((p) => p.id === this.myId) ?? null; }
  get latest() { return this.snaps[this.snaps.length - 1] ?? null; }
  get cutscene() { return !!this.boss?.cutscene; }
  get dialogueOpen() { return this.hud.dialogueOpen; }
  get serverNow() { return this.now + (this.serverOffset ?? 0); }

  isWorldUnlocked(world) {
    const results = this.session?.results ?? [];
    return world <= 0 || BOSSES.every((b, i) => b.world !== world - 1 || results[i] >= 0);
  }

  send(message) {
    if (this.world) this.world.send(message);
    else if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  /** Одиночная игра в самой странице. */
  startLocal() {
    this.world = new LocalWorld((m) => this.receive(m));
  }

  // ---------------------------------------------------------------- Сеть (кооп — позже)

  connect() {
    const status = document.getElementById('menu-status');
    status.textContent = 'Подключение к избушке…';
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onmessage = (event) => this.receive(JSON.parse(event.data));
    ws.onclose = () => {
      document.getElementById('menu').hidden = false;
      document.getElementById('hud').hidden = true;
      status.textContent = this.full ? 'В избушке уже двое богатырей.' : 'Связь с сервером потеряна. Обновите страницу.';
    };
  }

  receive(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.applySession(m);
        document.getElementById('menu').hidden = true;
        this.hud.show();
        break;
      case 'full': this.full = true; break;
      case 'scene': this.applySession(m); break;
      case 'snap': {
        m.receivedAt = this.now;
        const offset = m.time - this.now;
        this.serverOffset = this.serverOffset === null ? offset : Math.max(offset, this.serverOffset + (offset - this.serverOffset) * 0.05);
        this.snaps.push(m);
        if (this.snaps.length > 30) this.snaps.shift();
        this.session = { ...this.session, ...m.session };
        const me = this.me;
        if (me && me.cards !== this.lastCards) { this.lastCards = me.cards; this.local.onCardsChanged(); }
        break;
      }
      case 'teleport': this.local.teleport(m.x, m.z, m.fx, m.fz); this.view.snap(m.x, m.z); break;
      case 'announce': this.hud.announce(m.text); break;
      case 'shake': this.view.shake(m.amount, m.duration, this.now); break;
      case 'flash': this.vfx.flash(m.x, m.z, m.r); break;
      case 'text': this.vfx.text(m.x, m.z, m.y, m.text, m.color, m.duration); break;
      case 'damage':
        this.vfx.damage(m.x, m.z, m.amount);
        if (this.boss) this.boss.flashUntil = this.now + 0.08;
        break;
      case 'tele': this.vfx.telegraph(m); break;
      case 'slippery':
        if (m.id === this.myId) {
          this.local.slipperyUntil = this.now + m.duration;
          this.vfx.text(this.local.x, this.local.z, 2.8, 'Руки скользкие!', '#cc80ff', 1.2);
        }
        break;
      case 'parryFlash': this.vfx.parryFlash(m.x, m.z); playSound('parry', 0.6); break;
      case 'hurtFlash': { const a = this.avatars.get(m.id); if (a) a.flashUntil = this.now + 0.12; break; }
      case 'fx': if (m.fx === 'slash') this.vfx.slash(m.x, m.z, m.dx, m.dz, m.range, m.arc, m.color); break;
    }
  }

  applySession(m) {
    this.session = { ...this.session, ...m };
    const changed = this.scene !== m.scene;
    this.scene = m.scene;
    if (changed) {
      this.removed.clear();
      this.snaps = this.snaps.slice(-1);
      this.boss = null;
      this.vfx.items = [];
      this.hud.dialogueItem = null;
      document.getElementById('dialogue').hidden = true;
      this.mapView.placed = false;
      this.view.distance = m.scene === 'map' ? 22 : this.sceneData.camera;
    }
  }

  /** Два снимка вокруг момента t (для плавного движения чужих). */
  bracket(t) {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    for (let i = snaps.length - 1; i > 0; i--)
      if (snaps[i - 1].time <= t) return [snaps[i - 1], snaps[i], Math.min(1, Math.max(0, (t - snaps[i - 1].time) / Math.max(1e-3, snaps[i].time - snaps[i - 1].time)))];
    return [snaps[0], snaps[0], 0];
  }

  /** Снаряды врагов и зоны сейчас: позиция по скорости от последнего снимка. */
  liveHazards() {
    const snap = this.latest;
    if (!snap || this.session?.state === SESSION.MAP) return [];
    const age = Math.max(0, Math.min(0.25, this.serverNow - snap.time));
    const list = snap.hazards.filter((h) => !this.removed.has(h.id)).map((h) => h.type === 'proj'
      ? { ...h, x: h.x + h.vx * age, z: h.z + h.vz * age } : h);
    // Когти Лиха — опасность у его рук, пока идёт выпад или бег.
    const b = this.boss;
    // Тело Лиха ранит при столкновении (кроме укрытия и обессиленного); повторно — после неуязвимости.
    if (b?.contact) list.push({ id: 'body', key: 'body', repeat: true, type: 'body', x: b.x, z: b.z, r: (b.radius ?? 0.55) + 0.2, dmg: b.contact });
    if (b?.claws) list.push({ id: 'claws', key: `claws:${b.claws.token}`, type: 'claws', x: b.x + b.fx * 0.6, z: b.z + b.fz * 0.6, r: 1.3, dmg: b.claws.damage });
    return list;
  }

  liveArrows() {
    const snap = this.latest;
    if (!snap) return [];
    const age = Math.max(0, Math.min(0.25, this.serverNow - snap.time));
    return snap.arrows.map((a) => ({ ...a, x: a.x + a.vx * age, z: a.z + a.vz * age }));
  }

  removeHazardLocally(id) { if (typeof id === 'number') this.removed.add(id); }

  // ---------------------------------------------------------------- Кадр

  frame(dt) {
    this.now += dt;
    this.world?.update(dt);
    const onMap = this.session?.state === SESSION.MAP;
    this.hud.update();
    if (!this.latest) { this.input.endFrame(); return; }

    this.updateEntities(dt);
    if (onMap) this.updateMap(dt);
    else this.local.update(dt);

    // Камера: за своим богатырём (чуть вперёд по взгляду), на карте — за избушкой, в сценке — на Лихо.
    if (onMap) {
      this.view.zoom = 1;
      this.view.runShake += Math.sign((this.mapView.moving ? 1 : 0) - this.view.runShake) * Math.min(Math.abs((this.mapView.moving ? 1 : 0) - this.view.runShake), dt * 4);
      this.view.update(this.mapView.hutX, this.mapView.hutZ, dt, this.now);
      this.mapView.draw();
    } else {
      this.view.runShake = 0;
      const cinematic = this.boss?.cutscene;
      this.view.zoom += ((cinematic ? 0.5 : 1) - this.view.zoom) * (1 - Math.exp(-dt * 3));
      // Как в Enter the Gungeon: камера немного смещается к курсору (на пятую часть, не дальше 2.5 м).
      let tx = this.local.x, tz = this.local.z;
      if (cinematic) { tx = this.boss.x; tz = this.boss.z; } else if (!this.hud.dialogueOpen) {
        const [mx, mz] = this.view.unproject(this.input.mouseX, this.input.mouseY);
        let ox = (mx - this.local.x) * 0.2, oz = (mz - this.local.z) * 0.2;
        const l = Math.hypot(ox, oz);
        if (l > 2.5) { ox *= 2.5 / l; oz *= 2.5 / l; }
        tx += ox; tz += oz;
      }
      this.view.update(tx, tz, dt, this.now, cinematic ? 0.5 : 0.3);
      drawWorld(this);
    }
    this.input.endFrame();
  }

  updateEntities(dt) {
    const latest = this.latest;
    const bracket = this.bracket(this.serverNow - INTERPOLATION_DELAY);
    const lerp = (a, b, k) => a + (b - a) * k;
    const onMap = this.session?.state === SESSION.MAP;

    // Богатыри.
    const seen = new Set();
    this.players = latest.players.map((p) => {
      seen.add(p.id);
      let avatar = this.avatars.get(p.id);
      if (!avatar) {
        const rig = createBogatyr();
        avatar = { rig, animator: new BogatyrAnimator(rig), flip: false, x: p.x, z: p.z };
        avatar.animator.setWeaponIfChanged = (w) => { if (avatar.weaponRef !== w) { avatar.weaponRef = w; avatar.animator.setWeapon(w); } };
        this.avatars.set(p.id, avatar);
      }
      Object.assign(avatar, { id: p.id, slot: p.slot, hp: p.hp, downed: p.downed, weapon: p.weapon, dropped: p.dropped,
        slippery: p.slippery || (p.id === this.myId && this.now < this.local.slipperyUntil), visible: !onMap, cards: p.cards });
      const ox = avatar.x, oz = avatar.z;
      let fx;
      if (p.id === this.myId) {
        avatar.x = this.local.x; avatar.z = this.local.z; fx = this.local.fx;
        avatar.anim = this.local.anim();
      } else {
        const [a, b, k] = bracket;
        const pa = a.players.find((q) => q.id === p.id) ?? p, pb = b.players.find((q) => q.id === p.id) ?? p;
        avatar.x = lerp(pa.x, pb.x, k); avatar.z = lerp(pa.z, pb.z, k); fx = pb.fx;
        avatar.anim = pb.anim ?? {};
      }
      if (fx > 0.15) avatar.flip = false; else if (fx < -0.15) avatar.flip = true;
      const speed = dt > 0 && Math.hypot(avatar.x - ox, avatar.z - oz) < 2 ? Math.hypot(avatar.x - ox, avatar.z - oz) / dt : 0;
      avatar.animator.update(dt, avatar.downed ? 0 : speed, this.now, Math.max(0, avatar.anim?.swing ?? 0), avatar.anim?.roll ?? 0);
      return avatar;
    });
    for (const id of [...this.avatars.keys()]) if (!seen.has(id)) this.avatars.delete(id);

    // Босс.
    const bs = latest.boss;
    if (!bs || onMap) { this.boss = null; return; }
    if (!this.boss || this.boss.kind !== bs.kind) {
      this.boss = { ...bs };
      if (bs.kind === 'likho') { this.boss.rig = createLikho(); this.boss.animator = new LikhoAnimator(this.boss.rig); }
    }
    const boss = this.boss;
    const [a, b, k] = bracket;
    const ba = a.boss ?? bs, bb = b.boss ?? bs;
    const ox = boss.x, oz = boss.z;
    Object.assign(boss, bs, { x: lerp(ba.x, bb.x, k), z: lerp(ba.z, bb.z, k), fx: bb.fx, fz: bb.fz, pose: bb.pose ?? bs.pose,
      radius: bs.kind === 'likho' ? 0.55 : 0.7 });
    if (boss.fx > 0.15) boss.flip = false; else if (boss.fx < -0.15) boss.flip = true;
    if (boss.animator) {
      const speed = dt > 0 && Math.hypot(boss.x - ox, boss.z - oz) < 3 ? Math.hypot(boss.x - ox, boss.z - oz) / dt : 0;
      boss.animator.update(dt, boss.pose, boss.eyeBlind, speed, this.now);
    }
  }

  updateMap(dt) {
    const session = this.session, input = this.input;
    this.mapView.update(dt, session.hut);
    if (session.stoneOpen) {
      for (const [code, d] of [['Digit1', 0], ['Digit2', 1], ['Digit3', 2], ['Numpad1', 0], ['Numpad2', 1], ['Numpad3', 2]])
        if (input.keyPressed(code)) this.send({ t: 'difficulty', d });
      if (input.backPressed) this.send({ t: 'closeStone' });
      return;
    }
    // Ввод уходит ~10 раз в секунду, пока жмёшь направление, и сразу — когда отпустил.
    const [dx, dz] = input.move;
    const changed = Math.hypot(dx - (this.lastMapInput?.[0] ?? 0), dz - (this.lastMapInput?.[1] ?? 0)) > 0.2;
    if (changed || ((dx || dz) && this.now >= (this.nextMapInput ?? 0))) {
      this.send({ t: 'mapInput', dx, dz });
      this.lastMapInput = [dx, dz];
      this.nextMapInput = this.now + 0.1;
    }
    if (input.interactPressed) this.send({ t: 'mapInteract' });
    if (input.backPressed) this.send({ t: 'leaveMap' });
  }
}

// ---------------------------------------------------------------- Запуск

const game = new Game();
window.knighthead = game;
const status = document.getElementById('menu-status');
const play = document.getElementById('play');

await assets.preload(ALL_IMAGES, (f) => { status.textContent = `Загрузка рисунков… ${Math.round(f * 100)}%`; });
status.textContent = 'Готово. Можно входить.';
play.disabled = false;
play.onclick = async () => {
  play.disabled = true;
  unlockAudio();
  loadSound('parry', 'audio/parry.mp3');
  game.startLocal();
};
if (new URLSearchParams(location.search).has('autojoin')) play.click();

let last = performance.now();
function loop(time) {
  const dt = Math.max(0, Math.min(0.05, (time - last) / 1000));
  last = time;
  game.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
