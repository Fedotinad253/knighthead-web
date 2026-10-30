// Прогресс хранится у того, кто запустил сервер, — как у хоста в Cuphead. Состав — в shared/progress.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeProgress } from '../shared/progress.js';

export function loadProgress(file, count) {
  try { return normalizeProgress(JSON.parse(readFileSync(file, 'utf8')), count); }
  catch { return normalizeProgress(null, count); } // сохранения ещё нет
}

export function saveProgress(file, progress) {
  try { writeFileSync(file, JSON.stringify(progress, null, 2)); }
  catch (error) { console.warn(`[KnightHead] Не удалось сохранить прогресс: ${error.message}`); }
}
