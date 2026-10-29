// Одиночная игра: та же логика боя, что на сервере (shared/sim), но прямо в браузере.
// Клиент общается с ней теми же сообщениями, что и по сети, — поэтому кооп потом вернётся без переделок.
// Прогресс хранится в localStorage. Для проверки: ?boss=0&difficulty=1&debugwin&godmode.
import { Game } from '../shared/sim/game.js';

const KEY = 'knighthead.progress';

const progress = {
  load(count) {
    const results = Array(count).fill(-1);
    try {
      (JSON.parse(localStorage.getItem(KEY))?.bossResults ?? []).slice(0, count)
        .forEach((r, i) => { results[i] = Number.isInteger(r) ? r : -1; });
    } catch { /* сохранения нет или хранилище недоступно */ }
    return results;
  },
  save(results) {
    try { localStorage.setItem(KEY, JSON.stringify({ bossResults: results })); } catch { /* без сохранения */ }
  },
};

export class LocalWorld {
  constructor(onMessage) {
    const params = new URLSearchParams(location.search);
    this.game = new Game({
      boss: params.has('boss') ? Number(params.get('boss')) : -1,
      difficulty: Number(params.get('difficulty') ?? 1),
      debugwin: params.has('debugwin'), godmode: params.has('godmode'), quiet: false, allowDebug: true,
    }, progress);
    // «Сокет» внутри страницы: сообщения доходят сразу.
    this.socket = { send: (text) => onMessage(JSON.parse(text)), close() {}, onmessage: null, onclose: null };
    this.game.join(this.socket);
    this.accumulator = 0;
    this.tick = 0;
  }

  send(message) { this.socket.onmessage?.(JSON.stringify(message)); }

  /** Такт логики — 60 раз в секунду, снимок состояния — 30 раз в секунду (как у сервера). */
  update(dt) {
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= 1 / 60) {
      this.accumulator -= 1 / 60;
      this.game.update(1 / 60);
      if (++this.tick % 2 === 0) this.socket.send(JSON.stringify(this.game.snapshot()));
    }
  }
}
