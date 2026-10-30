// Сохранение: какие боссы побеждены и на какой сложности, лучший рейтинг, звёздочки (S+), очки прокачки, монеты.
// Общее для браузера (localStorage) и сервера (файл). Старые сохранения (три сложности) переводятся на две.

/**
 * results — лучшая сложность победы над каждым боссом (-1 — не побеждён); ranks — лучший рейтинг (индекс RANKS, -1 — нет);
 * rankPoints / cursePoints — лучшие очки прокачки за рейтинг и за проклятия по каждому боссу (в сумме — очки прокачки);
 * coins — монеты от трактирщика.
 */
export function emptyProgress(count) {
  return {
    version: 2, results: Array(count).fill(-1), ranks: Array(count).fill(-1),
    rankPoints: Array(count).fill(0), cursePoints: Array(count).fill(0), coins: 0,
  };
}

export function normalizeProgress(raw, count) {
  const p = emptyProgress(count);
  if (!raw || typeof raw !== 'object') return p;
  const ints = (list, min, fallback) => (Array.isArray(list) ? list : []).slice(0, count)
    .map((v) => (Number.isInteger(v) && v >= min ? v : fallback));
  if (raw.version === 2) {
    ints(raw.results, -1, -1).forEach((v, i) => { p.results[i] = Math.min(v, 1); });
    ints(raw.ranks, -1, -1).forEach((v, i) => { p.ranks[i] = v; });
    ints(raw.rankPoints, 0, 0).forEach((v, i) => { p.rankPoints[i] = v; });
    ints(raw.cursePoints, 0, 0).forEach((v, i) => { p.cursePoints[i] = v; });
    p.coins = Number.isInteger(raw.coins) && raw.coins > 0 ? raw.coins : 0;
  } else {
    // Было: 0 — пробная, 1 — богатырская, 2 — былинная. Стало: 0 — средняя, 1 — тяжёлая.
    ints(raw.bossResults, -1, -1).forEach((v, i) => { p.results[i] = v < 0 ? -1 : v >= 2 ? 1 : 0; });
  }
  return p;
}

export const totalPoints = (p) => p.rankPoints.reduce((a, b) => a + b, 0) + p.cursePoints.reduce((a, b) => a + b, 0);
