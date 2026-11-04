// Движения оружия. Для каждого удара заданы две позы: замах (wind) и конец удара (hit). Между ними и стойкой поза плавно
// перетекает (см. attackPose). Серии составлены так, что конец одного удара близок к замаху следующего — движение не рвётся.
//
// Поля позы: a — поворот передней руки (0 — опущена, 90 — вперёд, 180 — вверх); b — куда смотрит оружие на экране
// (0 — вперёд, 90 — вверх, -90 — вниз); t — наклон корпуса (плюс — назад, минус — вперёд); back — поворот задней руки.
import { ATTACK } from '../shared/data.js';

const p = (a, b, t = 0, back = 0) => ({ a, b, t, back });

/**
 * natural — куда смотрит оружие на самом рисунке (те же градусы, что b); mirror — рисунок нужно отразить (лук тетивой к себе);
 * ready — стойка; onBack — под каким углом висит за спиной.
 */
const STYLES = {
  Меч: {
    natural: -90, ready: p(30, 55, 0, -10), onBack: 125,
    light: [
      { wind: p(135, 130, 6, 10), hit: p(40, -35, -10, -15) },
      { wind: p(40, -40, -8, -15), hit: p(125, 70, 6, 10) },
      { wind: p(60, 15, 10, 25), hit: p(95, 0, -14, -25) }, // укол
    ],
    heavy: { wind: p(165, 150, 12, 40), hit: p(30, -50, -16, -20) },
    finishers: [
      { wind: p(30, -60, -10, -10), hit: p(150, 150, 12, 20) }, // Рассечение: широкий круг
      { wind: p(55, 10, 12, 30), hit: p(98, 0, -18, -30) }, // Выпад
      { wind: p(120, 100, 4, 10), hit: p(35, -30, -8, -10) }, // Встречный
    ],
    card: [{ wind: p(170, 170, 14, 50), hit: p(20, -60, -20, -25) }],
    ultimate: [
      { wind: p(30, -60, -8, -10), hit: p(150, 150, 10, 20) },
      { wind: p(150, 150, 10, 20), hit: p(30, -60, -10, -10) },
      { wind: p(170, 175, 14, 50), hit: p(90, 0, -18, -25) }, // волна вперёд
    ],
  },
  Топор: {
    natural: 90, ready: p(25, 70, 0, -10), onBack: 120,
    light: [
      { wind: p(150, 150, 10, 30), hit: p(30, -30, -14, -10) },
      { wind: p(20, -70, -12, -10), hit: p(140, 95, 10, 25) },
    ],
    heavy: { wind: p(175, 190, 16, 120), hit: p(25, -40, -22, 40) }, // двумя руками сверху
    finishers: [
      { wind: p(70, 10, 0, 40), hit: p(90, 0, 0, 40) }, // Вихрь: руки в стороны, крутится
      { wind: p(165, 170, 12, 50), hit: p(30, -45, -16, 0) }, // Рубка сверху
      { wind: p(178, 195, 18, 130), hit: p(15, -60, -26, 50) }, // Раскол
    ],
    card: [{ wind: p(140, 140, 10, 30), hit: p(25, -50, -18, -10) }],
    ultimate: [{ wind: p(85, 5, 0, 60), hit: p(90, 0, 0, 60) }], // Буря: крутится с вытянутым топором
  },
  Булава: {
    natural: 90, ready: p(20, 75, 0, -10), onBack: 115,
    light: [
      { wind: p(125, 160, 8, 20), hit: p(35, -15, -12, -10) },
      { wind: p(30, -30, -10, -10), hit: p(125, 110, 8, 20) },
      { wind: p(170, 180, 14, 60), hit: p(35, -50, -20, 10) }, // сверху вниз
    ],
    heavy: { wind: p(10, -120, -16, -20), hit: p(170, 200, 16, 60) }, // широкий круг снизу вверх
    finishers: [
      { wind: p(175, 190, 16, 90), hit: p(20, -70, -24, 20) }, // Сотрясение: в землю
      { wind: p(15, -90, -14, -15), hit: p(150, 150, 14, 30) }, // Подброс
      { wind: p(178, 195, 20, 130), hit: p(15, -80, -28, 40) }, // Молот
    ],
    card: [{ wind: p(175, 190, 18, 110), hit: p(15, -80, -26, 30) }],
    ultimate: [{ wind: p(178, 200, 24, 150), hit: p(10, -90, -32, 50) }],
  },
  // Стрелковое целится туда, куда смотрит курсор: к a и b прибавляется наклон прицела.
  Лук: {
    natural: 90, mirror: true, aims: true, ready: p(55, 80, 0, 5), onBack: 115,
    light: [{ wind: p(85, 90, 2, 30), hit: p(80, 94, 3, -5) }], // тетива к плечу и отпустил
    heavy: { wind: p(85, 90, 6, 42), hit: p(75, 98, 8, -10) },
    finishers: [
      { wind: p(85, 90, 3, 30), hit: p(78, 96, 5, -5) },
      { wind: p(85, 90, 8, 46), hit: p(72, 100, 10, -12) },
    ],
    card: [{ wind: p(85, 90, 1, 20), hit: p(82, 92, 2, 0) }], // часто и быстро
    ultimate: [{ wind: p(150, 160, 10, 60), hit: p(140, 170, 12, 10) }], // в небо
  },
  Арбалет: {
    natural: 0, aims: true, ready: p(45, 15, 0, 25), onBack: 60,
    light: [{ wind: p(82, 0, 3, 65), hit: p(92, 14, 7, 60) }], // отдача вверх
    heavy: { wind: p(82, 0, 5, 65), hit: p(96, 18, 9, 58) },
    finishers: [
      { wind: p(82, 0, 3, 65), hit: p(92, 12, 6, 60) },
      { wind: p(82, 0, 5, 65), hit: p(98, 18, 10, 58) },
    ],
    card: [{ wind: p(82, 0, 6, 66), hit: p(98, 20, 11, 56) }],
    ultimate: [{ wind: p(80, -4, 10, 68), hit: p(108, 30, 18, 50) }],
  },
};

const FALLBACK = STYLES['Меч'];
export const weaponStyle = (weapon) => STYLES[weapon?.name] ?? FALLBACK;

/** Позы богатыря в кат-сценах, оружие при этом за спиной. */
export const CINE_POSES = {
  awlDraw: p(55, 0, 2, -5), // достал шило
  awlWind: p(155, 0, 14, 35), // замахнулся
  awlStrike: p(108, 0, -20, -30), // удар в глаз
  awlHold: p(106, 0, -16, -25),
  awlPull: p(70, 0, 8, 5),
  speak: p(115, 0, 4, 15), // рука протянута вперёд
};

/** Защитная поза при блоке. */
export const BLOCK_POSE = p(100, 80, 5, 25);
/** Рука тянется за спину, когда убирает оружие. */
export const STOW_POSE = p(160, 120, 3, 0);

const lerp = (from, to, k) => ({
  a: from.a + (to.a - from.a) * k, b: from.b + (to.b - from.b) * k,
  t: from.t + (to.t - from.t) * k, back: from.back + (to.back - from.back) * k,
});
const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const smooth = (k) => k * k * (3 - 2 * k);

/**
 * Поза в момент удара. stage: 0..1 — замах, 1..2 — удар, 2..3 — возврат в стойку.
 * В конце удара оружие немного задерживается в конечной точке: так чувствуется вес.
 */
export function attackPose(style, kind, index, stage) {
  const list = kind === ATTACK.LIGHT ? style.light : kind === ATTACK.CARD ? style.card : kind === ATTACK.ULTIMATE ? style.ultimate
    : kind === ATTACK.FINISHER ? style.finishers : null;
  const motion = list ? list[Math.min(Math.max(index, 0), list.length - 1)] : style.heavy;
  if (stage < 1) return lerp(style.ready, motion.wind, easeOut(Math.max(0, stage)));
  if (stage < 2) return lerp(motion.wind, motion.hit, easeOutCubic(stage - 1));
  return lerp(motion.hit, style.ready, smooth(Math.max(0, (stage - 2 - 0.3) / 0.7)));
}
