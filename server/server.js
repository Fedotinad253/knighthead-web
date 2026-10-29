// KnightHead в браузере: сервер раздаёт страницу игры. Сейчас игра одиночная и считается в самом браузере;
// общий бой для двух богатырей по WebSocket (/ws) уже есть — кооп вернём позже (его проверяет selftest.js).
//
//   node server/server.js [--port 7777] [--boss N] [--difficulty 0|1|2] [--debugwin] [--godmode] [--progressfile путь]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { Game } from '../shared/sim/game.js';
import { loadProgress, saveProgress } from './progress.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseFlags(argv) {
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  return {
    port: Number(value('--port', process.env.PORT ?? 7777)),
    boss: Number(value('--boss', -1)),
    difficulty: Number(value('--difficulty', 1)),
    debugwin: argv.includes('--debugwin'),
    godmode: argv.includes('--godmode'),
    quiet: argv.includes('--quiet'),
    progressFile: value('--progressfile', join(root, 'progress.json')),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/** Раздаёт client/, shared/ и assets/. Остальное (сервер, сохранение) наружу не отдаётся. */
async function serveFile(request, response) {
  let path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(root, path));
  const allowed = file === join(root, 'index.html') || ['client', 'shared', 'assets'].some((dir) => file.startsWith(join(root, dir) + '/'));
  if (!allowed) { response.writeHead(404).end('Not found'); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

export function startServer(flags) {
  const game = new Game(flags, {
    load: (count) => loadProgress(flags.progressFile, count),
    save: (results) => saveProgress(flags.progressFile, results),
  });
  const server = createServer(serveFile);
  attachWebSocket(server, '/ws', (socket) => game.join(socket));

  // Такт игры — 60 раз в секунду, состояние уходит игрокам 30 раз в секунду.
  let last = performance.now(), tick = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    if (++tick % 2 === 0 && game.players.length) game.broadcast(game.snapshot());
  }, 1000 / 60);

  server.listen(flags.port, () => {
    if (flags.quiet) return;
    console.log(`[KnightHead] Сервер запущен. Открой в браузере: http://localhost:${flags.port}`);
    for (const list of Object.values(networkInterfaces()))
      for (const net of list ?? [])
        if (net.family === 'IPv4' && !net.internal) console.log(`[KnightHead] Для друга в локальной сети: http://${net.address}:${flags.port}`);
  });
  return { game, server, stop: () => { clearInterval(loop); server.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer(parseFlags(process.argv.slice(2)));
