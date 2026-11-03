// Кат-сцена босса: пока она идёт, богатырь не управляется и неуязвим, а камера, реплики и поза богатыря задаются здесь.
// Всё это уходит клиенту в снимке босса (поле cine). При пропуске паузы становятся нулевыми, но код сцены выполняется до конца,
// поэтому бой всегда продолжается из того же состояния. Время сцены в рейтинг не идёт.
export class Cutscene {
  constructor(boss, { skip = false } = {}) {
    this.boss = boss;
    this.game = boss.game;
    this.startedAt = this.now;
    boss.cutscene = true;
    boss.cineSkipped = false;
    boss.cine = { skip, at: this.now, x: boss.x, z: boss.z, zoom: 0.6, who: null, text: null, actor: null, pose: null };
    // Оглушение останавливает босса, а значит, и сцену.
    if (this.game.bossStatus) this.game.bossStatus.stunUntil = 0;
  }

  get now() { return this.game.clock.now; }
  get skipped() { return this.boss.cineSkipped; }

  /** Куда смотрит камера. zoom: 1 — как в бою, меньше — ближе. */
  shot(x, z, zoom = this.boss.cine.zoom) { Object.assign(this.boss.cine, { x, z, zoom }); }
  /** Босс и богатырь рисуются поверх кустов и деревьев. */
  inFront() { this.boss.cine.front = true; }
  /** Реплика внизу экрана. Без who — слова рассказчика, без text — тишина. */
  say(who = null, text = null) { Object.assign(this.boss.cine, { who, text }); }
  /** Поза богатыря (см. CINE_POSES в client/weaponanim.js). */
  pose(player, name) { Object.assign(this.boss.cine, { actor: player?.id ?? null, pose: name }); }

  /** Пауза. each — что делать каждый такт. */
  *hold(seconds, each = null) {
    const end = this.now + seconds;
    while (!this.skipped && this.now < end) { each?.(); yield; }
  }

  end() {
    const { boss, game } = this;
    boss.cutscene = false;
    boss.cine = null;
    if (game.stats) game.stats.start += this.now - this.startedAt;
  }
}
