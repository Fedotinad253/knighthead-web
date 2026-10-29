/** Здоровье босса или богатыря. Меняется только на сервере. */
export class Health {
  constructor(max) {
    this.max = max;
    this.hp = max;
    /** Урон не проходит (босс спрятался, идёт сценка). */
    this.invulnerable = false;
    /** Ниже этого здоровье не опускается — урон не перескакивает через фазу босса. */
    this.floor = 0;
    this.onDepleted = null;
    this.onDamaged = null;
  }

  get depleted() { return this.hp <= 0; }
  get fraction() { return this.max > 0 ? this.hp / this.max : 0; }

  /** Нанести урон. Возвращает, сколько прошло (для набора карт). */
  apply(amount, show) {
    if (this.depleted || amount <= 0 || this.invulnerable) return 0;
    const next = Math.max(this.floor, this.hp - amount);
    const dealt = this.hp - next;
    if (dealt <= 0) return 0;
    this.hp = next;
    show?.(dealt);
    this.onDamaged?.(dealt);
    if (this.depleted) this.onDepleted?.();
    return dealt;
  }

  setMax(max) { this.max = max; this.hp = max; }
  setFraction(f) { this.hp = Math.min(Math.max(f, 0), 1) * this.max; }
}
