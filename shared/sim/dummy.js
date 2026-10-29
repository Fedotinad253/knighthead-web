// Чучело-заглушка: играет роль боссов, у которых ещё нет своей реализации (перенесено из TrainingDummy.cs).
// Стреляет обычными и парируемыми (розовыми) снарядами, учитывает сложность, на половине здоровья злится.
import { Tasks } from './tasks.js';
import { Health } from './health.js';

const rotate = (x, z, degrees) => {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
};

export class Dummy {
  constructor(game, difficulty, name) {
    this.game = game;
    this.kind = 'dummy';
    this.name = name;
    this.d = difficulty;
    const spawn = game.sceneData.bossSpawn;
    this.x = spawn.x; this.z = spawn.z; this.fx = spawn.fx; this.fz = spawn.fz;
    this.radius = 0.7;
    this.phase = 1;
    this.pattern = 0;
    this.nextAttack = game.clock.now + 2;
    this.health = new Health(1200 * difficulty.bossHealth);
    this.health.onDamaged = () => {
      // Вторая стадия. На пробной сложности стадии урезаны — её нет.
      if (this.phase === 1 && !this.d.trimmed && this.health.fraction <= 0.5 && !this.health.depleted) {
        this.phase = 2;
        game.announce(`${this.name} злится!`);
      }
    };
    this.health.onDepleted = () => {
      game.floatText(this.x, this.z, 3.5, 'ПОВЕРЖЕНО!', '#ffd94d', 2);
      game.bossDefeated();
    };
    this.tasks = new Tasks(game.clock);
  }

  get interval() { return 1.8 / this.d.attackSpeed / (this.phase > 1 ? 1.3 : 1); }
  get speed() { return 9 * this.d.projectileSpeed; }

  applyDamage(amount) { return this.health.apply(amount, (dealt) => this.game.showDamage(this.x, this.z, dealt)); }

  snapshot() {
    return { kind: this.kind, name: this.name, x: this.x, z: this.z, fx: this.fx, fz: this.fz,
      hp: Math.round(this.health.hp), max: Math.round(this.health.max), phase: this.phase };
  }

  update() {
    this.tasks.update();
    if (this.health.depleted) return;
    if (this.game.clock.now >= this.nextAttack) {
      this.nextAttack = this.game.clock.now + this.interval;
      this.attack();
    }
  }

  attack() {
    let target = null, best = Infinity;
    for (const p of this.game.alivePlayers()) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < best) { best = d; target = p; }
    }
    if (!target) return;
    const tx = target.x - this.x, tz = target.z - this.z, l = Math.hypot(tx, tz) || 1;
    const ax = tx / l, az = tz / l;
    this.fx = ax; this.fz = az;

    // Пробная: без кольца. Былинная: добавляется спираль. Обычная: веер, кольцо, медленный шар.
    const patterns = this.d.extra ? 4 : 3;
    let pattern = this.pattern++ % patterns;
    if (this.d.trimmed && pattern === 1) pattern = 2;
    const fire = (dx, dz, speed, parry) => this.game.fireEnemy(this.x, this.z, dx, dz, speed, 15, parry, 6);

    if (pattern === 0) {
      const half = this.d.extra ? 2 : 1;
      for (let i = -half; i <= half; i++) fire(...rotate(ax, az, i * 15), this.speed, false);
    } else if (pattern === 1) {
      for (let i = 0; i < 16; i++) fire(...rotate(0, 1, i * 22.5), this.speed * 0.7, i % 4 === 0);
    } else if (pattern === 2) {
      fire(ax, az, this.speed * 0.6, true);
    } else {
      const self = this;
      this.tasks.start((function* () {
        let angle = Math.random() * 360;
        for (let i = 0; i < 18; i++) {
          if (self.health.depleted) return;
          fire(...rotate(0, 1, angle), self.speed * 0.8, i % 6 === 5);
          angle += 25;
          yield 0.05;
        }
      })());
    }
  }
}
