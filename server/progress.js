// Прогресс (побеждённые боссы) хранится у того, кто запустил сервер, — как у хоста в Cuphead.
// Для каждого босса — лучшая сложность победы, -1 — не побеждён.
import { readFileSync, writeFileSync } from 'node:fs';

export function loadProgress(file, count) {
  const results = Array(count).fill(-1);
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')).bossResults ?? [];
    saved.slice(0, count).forEach((r, i) => { results[i] = Number.isInteger(r) ? r : -1; });
  } catch { /* сохранения ещё нет */ }
  return results;
}

export function saveProgress(file, results) {
  try { writeFileSync(file, JSON.stringify({ bossResults: results }, null, 2)); }
  catch (error) { console.warn(`[KnightHead] Не удалось сохранить прогресс: ${error.message}`); }
}
