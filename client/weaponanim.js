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
    cardCombo: [
      { wind: p(130, 120, 6, 10), hit: p(40, -35, -10, -15) },
      { wind: p(40, -40, -8, -15), hit: p(125, 70, 6, 10) },
      { wind: p(125, 110, 6, 10), hit: p(35, -40, -12, -15) },
      { wind: p(35, -45, -10, -15), hit: p(130, 80, 8, 10) },
      { wind: p(170, 175, 12, 40), hit: p(15, -70, -18, -25) },
    ],
    cardStrike: { wind: p(70, 10, 12, 30), hit: p(100, 5, -18, -30) },
  },
  Топор: {
    natural: 90, ready: p(25, 70, 0, -10), onBack: 120,
    light: [
      { wind: p(150, 150, 10, 30), hit: p(30, -30, -14, -10) },
      { wind: p(20, -70, -12, -10), hit: p(140, 95, 10, 25) },
    ],
    heavy: { wind: p(175, 190, 16, 120), hit: p(25, -40, -22, 40) }, // двумя руками сверху
    cardCombo: [
      { wind: p(150, 150, 10, 30), hit: p(30, -30, -14, -10) },
      { wind: p(20, -70, -12, -10), hit: p(140, 95, 10, 25) },
      { wind: p(150, 150, 12, 40), hit: p(25, -45, -16, -10) },
      { wind: p(175, 190, 16, 120), hit: p(15, -60, -22, 40) },
    ],
    cardStrike: { wind: p(170, 180, 16, 110), hit: p(20, -55, -24, 40) },
  },
  Булава: {
    natural: 90, ready: p(20, 75, 0, -10), onBack: 115,
    light: [
      { wind: p(125, 160, 8, 20), hit: p(35, -15, -12, -10) },
      { wind: p(30, -30, -10, -10), hit: p(125, 110, 8, 20) },
      { wind: p(170, 180, 14, 60), hit: p(35, -50, -20, 10) }, // сверху вниз
    ],
    heavy: { wind: p(10, -120, -16, -20), hit: p(170, 200, 16, 60) }, // широкий круг снизу вверх
    cardCombo: [
      { wind: p(165, 170, 12, 60), hit: p(30, -50, -18, 10) },
      { wind: p(20, -110, -14, -20), hit: p(165, 195, 14, 60) },
      { wind: p(175, 190, 16, 90), hit: p(25, -60, -24, 20) },
    ],
    cardStrike: { wind: p(170, 180, 16, 70), hit: p(30, -60, -24, 20) },
  },
  // Стрелковое целится туда, куда смотрит курсор: к a и b прибавляется наклон прицела.
  Лук: {
    natural: 90, mirror: true, aims: true, ready: p(55, 80, 0, 5), onBack: 115,
    light: [{ wind: p(85, 90, 2, 30), hit: p(80, 94, 3, -5) }], // тетива к плечу и отпустил
    heavy: { wind: p(85, 90, 6, 42), hit: p(75, 98, 8, -10) },
    cardCombo: [{ wind: p(85, 90, 2, 28), hit: p(80, 94, 3, 0) }],
    cardStrike: { wind: p(85, 90, 8, 48), hit: p(72, 100, 10, -12) },
  },
  Арбалет: {
    natural: 0, aims: true, ready: p(45, 15, 0, 25), onBack: 60,
    light: [{ wind: p(82, 0, 3, 65), hit: p(92, 14, 7, 60) }], // отдача вверх
    heavy: { wind: p(82, 0, 5, 65), hit: p(96, 18, 9, 58) },
    cardCombo: [{ wind: p(82, 0, 2, 65), hit: p(90, 8, 4, 62) }],
    cardStrike: { wind: p(82, 0, 7, 68), hit: p(100, 22, 12, 55) },
  },
};

const FALLBACK = STYLES['Меч'];
export const weaponStyle = (weapon) => STYLES[weapon?.name] ?? FALLBACK;

/** Защитная поза при парировании. */
export const PARRY_POSE = p(100, 80, 5, 25);
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
  const list = kind === ATTACK.LIGHT ? style.light : kind === ATTACK.CARD_COMBO ? style.cardCombo : null;
  const motion = list ? list[Math.min(Math.max(index, 0), list.length - 1)] : kind === ATTACK.HEAVY ? style.heavy : style.cardStrike;
  if (stage < 1) return lerp(style.ready, motion.wind, easeOut(Math.max(0, stage)));
  if (stage < 2) return lerp(motion.wind, motion.hit, easeOutCubic(stage - 1));
  return lerp(motion.hit, style.ready, smooth(Math.max(0, (stage - 2 - 0.3) / 0.7)));
}
