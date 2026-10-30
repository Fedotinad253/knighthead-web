// Проверка без людей: сервер + два бота по настоящему WebSocket проходят бой с боссом до победы.
//   node server/selftest.js [--boss 0] [--difficulty 0]
// Боты бегают по арене и шлют позицию; урон боссу и добивание — как с флагами --debugwin --godmode.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { startServer, parseFlags } from './server.js';

const flags = parseFlags(process.argv.slice(2));
const progressFile = join(tmpdir(), `knighthead-selftest-${process.pid}.json`);
const port = 7790 + Math.floor(Math.random() * 100);
const boss = flags.boss >= 0 ? flags.boss : 0;
const { game, stop } = startServer({ ...flags, port, boss, debugwin: true, godmode: true, quiet: true, progressFile });

const log = [];
const original = game.log.bind(game);
game.log = (text) => { log.push(text); console.log(`  ${text}`); original(text); };

const errors = [];
process.on('uncaughtException', (e) => { errors.push(e); console.error(e); });

function bot(index) {
  return new Promise((resolveBot) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    let snaps = 0, x = index ? 1.5 : -1.5, z = -8, t = 0;
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.t === 'snap') snaps++;
      if (m.t === 'teleport') { x = m.x; z = m.z; }
    };
    const timer = setInterval(() => {
      t += 0.05;
      x += Math.cos(t * 0.7 + index) * 0.15;
      z += Math.sin(t * 0.5 + index) * 0.15;
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'state', x, z, fx: 0, fz: 1, anim: {} }));
    }, 50);
    ws.onopen = () => resolveBot({ ws, timer, snaps: () => snaps });
  });
}

const bots = [await bot(0), await bot(1)];
const started = Date.now();
const timeout = 240000;
await new Promise((done) => {
  const check = setInterval(() => {
    const won = log.some((l) => l.startsWith('Победа'));
    const backOnMap = won && game.state === 'map';
    if (backOnMap || Date.now() - started > timeout) { clearInterval(check); done(); }
  }, 200);
});

for (const b of bots) { clearInterval(b.timer); b.ws.close(); }
stop();
rmSync(progressFile, { force: true });

const won = log.some((l) => l.startsWith('Победа'));
console.log(`\nснимков у ботов: ${bots.map((b) => b.snaps()).join(', ')}, ошибок: ${errors.length}`);
console.log(won && game.state === 'map' && !errors.length ? 'ПРОЙДЕНО: бой до победы, возврат на карту' : 'ПРОВАЛ');
process.exit(won && !errors.length ? 0 : 1);
