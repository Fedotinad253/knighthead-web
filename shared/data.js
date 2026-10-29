// Данные игры — общие для сервера и браузера. Цифры перенесены из Unity-версии (ассеты оружия, GameRegistry).

const melee = (damage, windup, active, recovery, range, arc) => ({ damage, windup, active, recovery, range, arc, projectile: false });
const shot = (damage, windup, recovery, speed, { count = 1, spread = 0, pierce = false, lifetime = 1 } = {}) =>
  ({ damage, windup, active: 0.02, recovery, projectile: true, speed, count, spread, pierce, lifetime });

export const stepDuration = (s) => s.windup + s.active + s.recovery;

/**
 * Оружие (классов нет — стиль боя задаёт оружие). У каждого: лёгкое комбо, тяжёлая атака,
 * карта + лёгкая = особое комбо (больше всего урона), карта + тяжёлая = мгновенный сильный удар.
 * sprite — картинка; grip — где её держит кулак (доли картинки, y=0 — низ); height — высота, м.
 */
export const WEAPONS = [
  {
    name: 'Меч', sprite: 'weapons/Sword.png', grip: [0.5, 0.85], height: 1.05, comboWindow: 0.45, moveWhileAttacking: 0.7,
    light: [melee(12, 0.06, 0.08, 0.14, 2.3, 120), melee(12, 0.06, 0.08, 0.14, 2.3, 120), melee(20, 0.10, 0.10, 0.25, 2.5, 150)],
    heavy: melee(35, 0.35, 0.10, 0.35, 2.8, 60),
    cardCombo: [melee(20, 0.04, 0.06, 0.08, 2.5, 140), melee(20, 0.04, 0.06, 0.08, 2.5, 140), melee(25, 0.04, 0.06, 0.08, 2.5, 140),
      melee(25, 0.04, 0.06, 0.10, 2.5, 140), melee(50, 0.15, 0.10, 0.40, 3.2, 360)],
    cardStrike: melee(90, 0.02, 0.08, 0.30, 3.2, 90),
  },
  {
    name: 'Топор', sprite: 'weapons/Axe.png', grip: [0.29, 0.22], height: 0.95, comboWindow: 0.55, moveWhileAttacking: 0.55,
    light: [melee(18, 0.12, 0.10, 0.22, 2.4, 140), melee(26, 0.16, 0.10, 0.32, 2.6, 160)],
    heavy: melee(50, 0.50, 0.12, 0.45, 2.8, 180),
    cardCombo: [melee(30, 0.08, 0.08, 0.12, 2.6, 160), melee(35, 0.08, 0.08, 0.12, 2.6, 160), melee(40, 0.10, 0.08, 0.15, 2.6, 200),
      melee(60, 0.20, 0.12, 0.45, 3.0, 360)],
    cardStrike: melee(110, 0.02, 0.10, 0.35, 3.0, 120),
  },
  {
    name: 'Булава', sprite: 'weapons/Mace.png', grip: [0.5, 0.2], height: 0.9, comboWindow: 0.5, moveWhileAttacking: 0.5,
    light: [melee(15, 0.10, 0.10, 0.25, 2.3, 110), melee(15, 0.10, 0.10, 0.25, 2.3, 110), melee(28, 0.18, 0.12, 0.35, 2.8, 70)],
    heavy: melee(60, 0.55, 0.15, 0.50, 3.2, 360),
    cardCombo: [melee(50, 0.15, 0.12, 0.20, 3.5, 360), melee(55, 0.15, 0.12, 0.20, 3.5, 360), melee(75, 0.25, 0.15, 0.50, 4.0, 360)],
    cardStrike: melee(120, 0.02, 0.12, 0.40, 3.2, 100),
  },
  {
    name: 'Лук', sprite: 'weapons/Bow.png', grip: [0.22, 0.5], height: 1.35, comboWindow: 0.3, moveWhileAttacking: 0.85,
    light: [shot(9, 0.05, 0.20, 30, { lifetime: 0.9 })],
    heavy: shot(35, 0.45, 0.30, 40, { pierce: true, lifetime: 1.2 }),
    cardCombo: [shot(10, 0.06, 0.12, 32, { count: 5, spread: 30, lifetime: 0.8 }), shot(10, 0.06, 0.12, 32, { count: 5, spread: 30, lifetime: 0.8 }),
      shot(10, 0.06, 0.25, 32, { count: 5, spread: 30, lifetime: 0.8 })],
    cardStrike: shot(100, 0.05, 0.30, 50, { pierce: true, lifetime: 1.5 }),
  },
  {
    name: 'Арбалет', sprite: 'weapons/Crossbow.png', grip: [0.38, 0.45], height: 0.42, comboWindow: 0.3, moveWhileAttacking: 0.7,
    light: [shot(20, 0.08, 0.45, 38)],
    heavy: shot(14, 0.40, 0.40, 34, { count: 3, spread: 20 }),
    cardCombo: Array.from({ length: 6 }, (_, i) => shot(25, 0.03, i === 5 ? 0.30 : 0.07, 40)),
    cardStrike: shot(105, 0.02, 0.35, 55, { pierce: true, lifetime: 1.3 }),
  },
];

/** Вид атаки: лёгкая, тяжёлая, карта + лёгкая (серия), карта + тяжёлая (мгновенный удар). */
export const ATTACK = { LIGHT: 0, HEAVY: 1, CARD_COMBO: 2, CARD_STRIKE: 3 };

export function attackStep(weapon, kind, index) {
  switch (kind) {
    case ATTACK.LIGHT: return weapon.light[Math.min(Math.max(index, 0), weapon.light.length - 1)];
    case ATTACK.HEAVY: return weapon.heavy;
    case ATTACK.CARD_COMBO: return weapon.cardCombo[Math.min(Math.max(index, 0), weapon.cardCombo.length - 1)];
    default: return weapon.cardStrike;
  }
}

/** Карты (аналог super-карт Cuphead): заполняются уроном и парированием. */
export const CARDS = { max: 5, damagePerCard: 150, perParry: 1 };

export const WORLDS = [
  { name: 'Явь', color: '#f2cc4d', ground: '#5c8040' },
  { name: 'Навь', color: '#9a4de6', ground: '#2e1f38' },
  { name: 'Правь', color: '#80ccff', ground: '#c7b880' },
];

/** Боссы. Порядок — индексы на карте и в сохранении. kind: 'likho' или 'dummy' (Чучело-заглушка). */
export const BOSSES = [
  { name: 'Лихо Одноглазое', world: 0, description: 'Хитрое и скрытное. Нападает из кустов', kind: 'likho', arena: 'forest' },
  { name: 'Соловей-Разбойник', world: 0, description: '', kind: 'dummy', arena: 'arena' },
  { name: 'Змей Горыныч', world: 0, description: 'Страж Калинова моста', kind: 'dummy', arena: 'arena' },
  { name: 'Водяной', world: 1, description: '', kind: 'dummy', arena: 'arena' },
  { name: 'Вий', world: 1, description: '', kind: 'dummy', arena: 'arena' },
  { name: 'Кощей Бессмертный', world: 1, description: 'Хозяин Нави', kind: 'dummy', arena: 'arena' },
  { name: 'Перун', world: 2, description: '', kind: 'dummy', arena: 'arena' },
  { name: 'Морена', world: 2, description: '', kind: 'dummy', arena: 'arena' },
  { name: 'Чернобог', world: 2, description: '', kind: 'dummy', arena: 'arena' },
];

/** Сложности — камень на распутье перед каждым боем. */
export const DIFFICULTIES = [
  {
    name: 'Пробная', stone: 'Налево пойдёшь — жив будешь',
    description: 'Атаки медленнее, у боссов меньше стадий. Чтобы освоиться с боем.',
    attackSpeed: 0.7, projectileSpeed: 0.75, bossHealth: 0.75, trimmed: true, extra: false,
  },
  {
    name: 'Богатырская', stone: 'Направо пойдёшь — коня потеряешь',
    description: 'Обычный бой: так, как боссы задуманы.',
    attackSpeed: 1, projectileSpeed: 1, bossHealth: 1, trimmed: false, extra: false,
  },
  {
    name: 'Былинная', stone: 'Прямо пойдёшь — смерть найдёшь',
    description: 'Новые атаки, всё быстрее и злее. Для тех, кто уже знает босса.',
    attackSpeed: 1.3, projectileSpeed: 1.2, bossHealth: 1.15, trimmed: false, extra: true,
  },
];

/** Богатырь: движение как в Enter the Gungeon, рывок без выносливости, парирование на V. */
export const PLAYER = {
  speed: 5.5, acceleration: 65, deceleration: 85,
  dashDistance: 4.5, dashDuration: 0.16, dashCooldown: 0.35, dashInvulnerability: 0.2,
  parryWindow: 1, parryCooldown: 0.4, parryInvulnerability: 0.5,
  hurtRadius: 0.45, hitInvulnerability: 1, blinkRate: 6, blinkBrightness: 0.55,
  radius: 0.4, maxHealth: 100,
  reviveRadius: 2.2, reviveDuration: 2, reviveHealth: 0.5,
  inputBuffer: 0.2,
};

export const PLAYER_COLORS = ['#d9402e', '#3f73e6'];
export const PARRY_COLOR = '#ff59c7';
export const DANGER_COLOR = '#ff8c26';

export const SESSION = { TAVERN: 'tavern', MAP: 'map', ARENA: 'arena' };
