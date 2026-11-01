// Данные игры — общие для сервера и браузера. Цифры перенесены из Unity-версии (ассеты оружия, GameRegistry).

const melee = (damage, windup, active, recovery, range, arc) => ({ damage, windup, active, recovery, range, arc, projectile: false });
const shot = (damage, windup, recovery, speed, { count = 1, spread = 0, pierce = false, lifetime = 1 } = {}) =>
  ({ damage, windup, active: 0.02, recovery, projectile: true, speed, count, spread, pierce, lifetime });

export const stepDuration = (s) => s.windup + s.active + s.recovery;

/**
 * Оружие (классов нет — стиль боя задаёт оружие). У каждого: лёгкое комбо, тяжёлая атака,
 * карта + лёгкая = особое комбо (больше всего урона), карта + тяжёлая = мгновенный сильный удар.
 * sprite — картинка; grip — где её держит кулак (доли картинки, y=0 — низ); height — высота, м; description — подсказка при выборе.
 */
export const WEAPONS = [
  {
    name: 'Меч', description: 'Ближний бой. Быстрые ровные удары, можно двигаться на ходу.', sprite: 'weapons/Sword.png', grip: [0.5, 0.85], height: 1.05, comboWindow: 0.45, moveWhileAttacking: 0.7,
    light: [melee(12, 0.06, 0.08, 0.14, 2.3, 120), melee(12, 0.06, 0.08, 0.14, 2.3, 120), melee(20, 0.10, 0.10, 0.25, 2.5, 150)],
    heavy: melee(35, 0.35, 0.10, 0.35, 2.8, 60),
    cardCombo: [melee(20, 0.04, 0.06, 0.08, 2.5, 140), melee(20, 0.04, 0.06, 0.08, 2.5, 140), melee(25, 0.04, 0.06, 0.08, 2.5, 140),
      melee(25, 0.04, 0.06, 0.10, 2.5, 140), melee(50, 0.15, 0.10, 0.40, 3.2, 360)],
    cardStrike: melee(90, 0.02, 0.08, 0.30, 3.2, 90),
  },
  {
    name: 'Топор', description: 'Ближний бой. Медленнее меча, зато бьёт сильнее и шире.', sprite: 'weapons/Axe.png', grip: [0.29, 0.22], height: 0.95, comboWindow: 0.55, moveWhileAttacking: 0.55,
    light: [melee(18, 0.12, 0.10, 0.22, 2.4, 140), melee(26, 0.16, 0.10, 0.32, 2.6, 160)],
    heavy: melee(50, 0.50, 0.12, 0.45, 2.8, 180),
    cardCombo: [melee(30, 0.08, 0.08, 0.12, 2.6, 160), melee(35, 0.08, 0.08, 0.12, 2.6, 160), melee(40, 0.10, 0.08, 0.15, 2.6, 200),
      melee(60, 0.20, 0.12, 0.45, 3.0, 360)],
    cardStrike: melee(110, 0.02, 0.10, 0.35, 3.0, 120),
  },
  {
    name: 'Булава', description: 'Ближний бой. Самая медленная, тяжёлый удар бьёт вокруг себя.', sprite: 'weapons/Mace.png', grip: [0.5, 0.2], height: 0.9, comboWindow: 0.5, moveWhileAttacking: 0.5,
    light: [melee(15, 0.10, 0.10, 0.25, 2.3, 110), melee(15, 0.10, 0.10, 0.25, 2.3, 110), melee(28, 0.18, 0.12, 0.35, 2.8, 70)],
    heavy: melee(60, 0.55, 0.15, 0.50, 3.2, 360),
    cardCombo: [melee(50, 0.15, 0.12, 0.20, 3.5, 360), melee(55, 0.15, 0.12, 0.20, 3.5, 360), melee(75, 0.25, 0.15, 0.50, 4.0, 360)],
    cardStrike: melee(120, 0.02, 0.12, 0.40, 3.2, 100),
  },
  {
    name: 'Лук', description: 'Дальний бой. Частые слабые выстрелы, сильный — пробивает насквозь.', sprite: 'weapons/Bow.png', grip: [0.22, 0.5], height: 1.35, comboWindow: 0.3, moveWhileAttacking: 0.85,
    light: [shot(9, 0.05, 0.20, 30, { lifetime: 0.9 })],
    heavy: shot(35, 0.45, 0.30, 40, { pierce: true, lifetime: 1.2 }),
    cardCombo: [shot(10, 0.06, 0.12, 32, { count: 5, spread: 30, lifetime: 0.8 }), shot(10, 0.06, 0.12, 32, { count: 5, spread: 30, lifetime: 0.8 }),
      shot(10, 0.06, 0.25, 32, { count: 5, spread: 30, lifetime: 0.8 })],
    cardStrike: shot(100, 0.05, 0.30, 50, { pierce: true, lifetime: 1.5 }),
  },
  {
    name: 'Арбалет', description: 'Дальний бой. Редкие сильные болты, тяжёлый выстрел — тремя сразу.', sprite: 'weapons/Crossbow.png', grip: [0.38, 0.45], height: 0.42, comboWindow: 0.3, moveWhileAttacking: 0.7,
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

/**
 * Боссы. Порядок — индексы на карте и в сохранении. kind: 'likho' или 'dummy' (Чучело-заглушка).
 * par — за сколько секунд бой считается быстрым (для рейтинга). mark — значок на особых предметах этого босса. pools — из чего выпадает снаряжение перед боем:
 * под каждого босса только то, что в этом бою полезно (у Лиха — только ближний бой).
 */
const DUMMY_POOLS = { weapons: [0, 1, 2, 3, 4], abilities: ['peas', 'coals'], magic: ['spark', 'water'], charms: ['belt', 'wolf'], curses: ['cataract'] };
export const BOSSES = [
  { name: 'Лихо Одноглазое', world: 0, description: 'Хитрое и скрытное. Нападает из кустов', kind: 'likho', arena: 'forest', par: 150, mark: 'characters/likho/eye.png',
    pools: { weapons: [0, 1, 2], abilities: ['salt', 'peas', 'sickle', 'coals'], magic: ['wind', 'spark', 'decoy', 'water'], charms: ['chicken', 'belt', 'bear', 'wolf'],
      curses: ['cataract', 'wicked', 'crooked', 'hiddenTraps'] } },
  { name: 'Соловей-Разбойник', world: 0, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Змей Горыныч', world: 0, description: 'Страж Калинова моста', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Водяной', world: 1, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Вий', world: 1, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Кощей Бессмертный', world: 1, description: 'Хозяин Нави', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Перун', world: 2, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Морена', world: 2, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
  { name: 'Чернобог', world: 2, description: '', kind: 'dummy', arena: 'arena', par: 60, pools: DUMMY_POOLS },
];

/** Сложности: на средней босс такой, как задуман; на тяжёлой — новые атаки и всё быстрее. Только на тяжёлой бывает S+. */
export const DIFFICULTIES = [
  {
    name: 'Средняя', description: 'Босс такой, как задуман.',
    attackSpeed: 1, projectileSpeed: 1, bossHealth: 1, trimmed: false, extra: false,
  },
  {
    name: 'Тяжёлая', description: 'Новые атаки, всё быстрее и злее. Только здесь можно взять S+.',
    attackSpeed: 1.3, projectileSpeed: 1.2, bossHealth: 1.15, trimmed: false, extra: true,
  },
];

/**
 * Бытовая способность (кнопка Q). Бросок — в точку под курсором (не дальше range). cooldown — секунды.
 * icon — картинка для карточки и панели боя (в assets/); нет — вместо неё буква.
 * unique — номер босса, для которого предмет сделан особо (значок в углу картинки). Без него предмет общий: в описании только общие слова.
 */
export const ABILITIES = {
  salt: { name: 'Соль', icon: 'items/ability/salt.png', cooldown: 10, range: 9, radius: 1.8, duration: 6,
    description: 'Соляной круг: нечисть его не переступает. Брошенная в укрытие — выгоняет оттуда.' },
  peas: { name: 'Горсть гороха', icon: 'items/ability/peas.png', cooldown: 8, range: 10, radius: 2, duration: 8,
    description: 'Рассыпанный горох: враг на нём еле ползёт. Кто не видит — бежит на стук горошин.' },
  sickle: { name: 'Серп', icon: 'items/ability/sickle.png', unique: 0, cooldown: 6, range: 3.2, radius: 1.4, duration: 0, damage: 25,
    description: 'Срезает ближайший куст до конца боя — Лиху негде прятаться. Сидело в нём — получит по лапам.' },
  coals: { name: 'Горшок с углями', icon: 'items/ability/coals.png', cooldown: 12, range: 9, radius: 1.9, duration: 5, damage: 18,
    description: 'Горящие угли жгут врага, а кусты в огне сгорают — вместе с теми, кто в них прятался.' },
};

/** Магия (кнопка E) — заговоры и чары: сильнее бытовой, но перезаряжается дольше. */
export const MAGIC = {
  wind: { name: 'Ветер-ветрило', icon: 'items/magic/wind.png', cooldown: 14, range: 6, arc: 70, push: 4,
    description: 'Порыв ветра из ладоней отбрасывает врага и выдувает его из укрытия.' },
  spark: { name: 'Перунова искра', icon: 'items/magic/spark.png', cooldown: 16, range: 10, radius: 1.6, delay: 0.6, damage: 55,
    description: 'Через миг в точку под курсором бьёт молния. Кусты от неё сгорают.' },
  decoy: { name: 'Морок', icon: 'items/magic/decoy.png', cooldown: 20, range: 8, duration: 6,
    description: 'Морок-двойник богатыря: пока он не рассеется, враг нападает на него.' },
  water: { name: 'Живая вода', cooldown: 25, heal: 40, range: 0,
    description: 'Глоток живой воды возвращает 40 здоровья.' },
};

/** Обереги — пассивные свойства на весь бой. */
export const CHARMS = {
  chicken: { name: 'Куриный бог', unique: 0, description: 'Камень с дыркой: сквозь него видно спрятавшееся Лихо и любые капканы.' },
  belt: { name: 'Пояс с наузами', description: 'Раз за бой смертельный удар рвёт пояс, а богатырь остаётся жив.' },
  bear: { name: 'Медвежий коготь', description: 'Удары по уставшему, оглушённому или обессилевшему врагу — в полтора раза сильнее.' },
  wolf: { name: 'Волчий клык', description: 'Когда здоровья меньше половины, атаки на треть быстрее.' },
};

/** Проклятия — по желанию, от нуля до трёх. Каждое делает бой труднее и даёт очко прокачки (смотри RANKS). */
export const CURSES = {
  cataract: { name: 'Бельмо', description: 'Богатырь плохо видит: всё, что дальше нескольких шагов, тонет во тьме.' },
  wicked: { name: 'Злое Лихо', unique: 0, description: 'Выпады и броски Лиха на половину дальше.' },
  crooked: { name: 'Кривая доля', unique: 0, description: 'Неудачи от проклятия Лиха случаются вдвое чаще.' },
  hiddenTraps: { name: 'Невидимые капканы', unique: 0, description: 'Капканы Лиха видно, только когда подошёл к ним вплотную.' },
};

/**
 * Рейтинг боя (от худшего): очки прокачки за рейтинг и сколько взятых проклятий засчитывается.
 * S+ — только на тяжёлой сложности, даёт звёздочку на карте. coins — монеты от трактирщика за победу.
 */
export const RANKS = [
  { name: 'D', min: 0, points: 1, curses: 1, coins: 5, color: '#a89a8a' },
  { name: 'C', min: 40, points: 2, curses: 2, coins: 8, color: '#8fc27a' },
  { name: 'B', min: 55, points: 3, curses: 2, coins: 12, color: '#6fb0ff' },
  { name: 'A', min: 70, points: 4, curses: 3, coins: 16, color: '#c48cff' },
  { name: 'S', min: 85, points: 6, curses: 3, coins: 20, color: '#ffd966' },
  { name: 'S+', min: 85, points: 6, curses: 3, coins: 25, color: '#ff9a3c' },
];
export const RANK_S_PLUS = 5;

/**
 * Оценка боя 0–100: время (40), полученный урон (40), парирования (20), и тяжёлая сложность добавляет 10.
 * S+ — тяжёлая сложность и S без этой добавки.
 */
export function rateFight({ time, par, damageTaken, parries, difficulty }) {
  const timeScore = 40 * Math.min(1, Math.max(0, (par * 2.5 - time) / (par * 1.5)));
  const damageScore = 40 * Math.max(0, 1 - damageTaken / PLAYER.maxHealth);
  const parryScore = 20 * Math.min(1, parries / 5);
  const base = timeScore + damageScore + parryScore;
  const score = Math.min(100, base + (difficulty >= 1 ? 10 : 0));
  let rank = 0;
  for (let i = 0; i < RANK_S_PLUS; i++) if (score >= RANKS[i].min) rank = i;
  if (difficulty >= 1 && base >= RANKS[4].min) rank = RANK_S_PLUS;
  return { rank, score: Math.round(score), parts: { time: Math.round(timeScore), damage: Math.round(damageScore), parries: Math.round(parryScore) } };
}

/**
 * Богатырь: движение как в Enter the Gungeon, перекат без выносливости, парирование на V.
 * Перекат — только перемещение: снаряды через него не перепрыгнуть (защита — уклониться или парировать).
 */
export const PLAYER = {
  speed: 5.5, acceleration: 65, deceleration: 85,
  rollDistance: 3.2, rollDuration: 0.42, rollCooldown: 0.15,
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
