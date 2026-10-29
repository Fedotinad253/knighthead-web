// Интерфейс поверх игры (HTML): здоровье и карты, напарник, полоса босса, объявления, подсказка «E»,
// диалог с NPC, камень на распутье (выбор сложности), прогресс миров на карте, подсказка управления.
import { WEAPONS, BOSSES, DIFFICULTIES, WORLDS, CARDS, PLAYER, SESSION } from '../shared/data.js';
import { MAP, nodeNear } from '../shared/scenes.js';

const $ = (id) => document.getElementById(id);
const PHASES = { likho: ['Из кустов', 'Ползучее', 'Слепое бешенство'] };

export class Hud {
  constructor(game) {
    this.game = game;
    this.announceUntil = 0;
    this.dialogueItem = null;
    this.dialogueIndex = {};
    this.stoneKey = '';
    $('cards').innerHTML = Array.from({ length: CARDS.max }, () => '<div class="card"><i></i></div>').join('');
    $('stone-close').onclick = () => game.send({ t: 'closeStone' });
  }

  show() { $('hud').hidden = false; }

  announce(text) {
    const el = $('announce');
    el.textContent = text;
    el.style.opacity = 1;
    this.announceUntil = this.game.now + 2.6;
  }

  /** Реплика NPC: E — следующая, Esc — закрыть. */
  dialogue(item) {
    const index = this.dialogueIndex[item.id] ?? 0;
    this.dialogueItem = item;
    this.dialogueIndex[item.id] = (index + 1) % item.lines.length;
    $('dialogue-speaker').textContent = item.speaker;
    $('dialogue-text').textContent = item.lines[index];
    $('dialogue').hidden = false;
  }

  get dialogueOpen() { return !$('dialogue').hidden; }

  update() {
    const game = this.game, input = game.input, now = game.now;
    if (now > this.announceUntil) $('announce').style.opacity = 0;
    if (input.keyPressed('F1')) $('help').hidden = !$('help').hidden;

    // Диалог: закрыть, листать, или закрыть, если отошёл.
    if (this.dialogueOpen) {
      const item = this.dialogueItem, local = game.local;
      const far = !local || Math.hypot(item.x - local.x, item.z - local.z) > item.radius + 0.6;
      if (input.backPressed || far || game.session?.state !== SESSION.TAVERN) $('dialogue').hidden = true;
      else if (input.interactPressed) { this.dialogue(item); input.pressed.delete('KeyE'); }
    }

    const session = game.session, me = game.me;
    const onMap = session?.state === SESSION.MAP;
    $('me').hidden = onMap || !me;
    $('worlds').hidden = !onMap;

    if (me && !onMap) {
      $('me-name').textContent = `Богатырь ${me.slot + 1}`;
      $('me-name').style.color = ['#ff8a7a', '#8ab0ff'][me.slot] ?? '#fff';
      $('me-weapon').textContent = me.dropped ? 'оружие выпало!' : WEAPONS[me.weapon].name;
      $('me-hp').style.width = `${Math.max(0, me.hp / PLAYER.maxHealth) * 100}%`;
      const cards = $('cards').children;
      for (let i = 0; i < CARDS.max; i++) {
        const f = Math.max(0, Math.min(1, me.cards - i));
        cards[i].firstChild.style.height = `${f * 100}%`;
        cards[i].classList.toggle('full', f >= 0.999);
      }
      const local = game.local;
      $('dash').classList.toggle('off', now < local.nextDash);
      $('parry').classList.toggle('off', now < local.parryReadyAt && !local.parrying);
    }

    const mate = game.players.find((p) => p.id !== me?.id);
    $('mate').hidden = !mate || onMap;
    if (mate) {
      $('mate-name').textContent = `Богатырь ${mate.slot + 1}${mate.downed ? ' — пал' : ''}`;
      $('mate-hp').style.width = `${Math.max(0, mate.hp / PLAYER.maxHealth) * 100}%`;
    }

    const boss = game.boss;
    $('boss').hidden = !boss || onMap;
    if (boss) {
      $('boss-name').textContent = boss.name;
      $('boss-hp').style.width = `${Math.max(0, boss.hp / boss.max) * 100}%`;
      const names = PHASES[boss.kind];
      $('boss-phase').textContent = names ? `Фаза ${boss.phase}: ${names[boss.phase - 1] ?? ''}` : boss.phase > 1 ? 'Злится!' : '';
    }

    this.updatePrompt(onMap);
    this.updateMap(onMap);
  }

  updatePrompt(onMap) {
    const game = this.game, local = game.local;
    let text = '';
    if (onMap) {
      const node = nodeNear(...(game.session.hut ?? MAP.nodes[0]));
      if (node > 0 && !game.session.stoneOpen) {
        const boss = BOSSES[node - 1];
        text = game.isWorldUnlocked(boss.world) ? `[E] В бой: ${boss.name}` : 'Путь закрыт';
      }
    } else if (local?.reviveTarget) text = `Удерживай [E] — поднять Богатыря ${local.reviveTarget.slot + 1}`;
    else if (local?.focused && !this.dialogueOpen) text = `[E] ${local.focused.prompt}`;
    $('prompt').hidden = !text;
    $('prompt').textContent = text;
    $('revive').hidden = !(local?.reviveProgress > 0);
    if (local?.reviveProgress > 0) $('revive-fill').style.width = `${(local.reviveProgress / PLAYER.reviveDuration) * 100}%`;

    $('hint').textContent = onMap
      ? (game.session.stoneOpen ? '1 / 2 / 3 — выбрать сложность     Esc — отойти' : 'WASD — бежать избушкой     E — в бой у логова     Esc — отойти от карты')
      : 'ЛКМ/ПКМ — атаки   Shift — карта   Пробел — рывок   V — парирование   E — действие   F1 — управление';
  }

  updateMap(onMap) {
    const game = this.game, session = game.session;
    if (onMap) {
      $('worlds').innerHTML = WORLDS.map((w, i) => {
        const open = game.isWorldUnlocked(i);
        let defeated = 0, total = 0;
        BOSSES.forEach((b, k) => { if (b.world === i) { total++; if (session.results[k] >= 0) defeated++; } });
        return `<div style="color:${open ? w.color : '#8c8080'}">${w.name}: ${open ? `${defeated}/${total}` : 'закрыто'}</div>`;
      }).join('');
    }

    // Камень на распутье: три надписи — три сложности.
    const open = onMap && session.stoneOpen && session.stoneBoss >= 0;
    $('stone').hidden = !open;
    if (!open) { this.stoneKey = ''; return; }
    const key = `${session.stoneBoss}:${session.results[session.stoneBoss]}`;
    if (key === this.stoneKey) return;
    this.stoneKey = key;
    const boss = BOSSES[session.stoneBoss], best = session.results[session.stoneBoss];
    $('stone-title').textContent = boss.name;
    $('stone-description').textContent = boss.description;
    $('stone-lines').innerHTML = DIFFICULTIES.map((d, i) =>
      `<button class="stone-line" data-d="${i}">${i + 1}. <em>«${d.stone}»</em><br><b>${d.name}</b>${best >= i ? ' ✓' : ''}<br><span class="small">${d.description}</span></button>`).join('');
    for (const button of $('stone-lines').children) button.onclick = () => game.send({ t: 'difficulty', d: Number(button.dataset.d) });
  }
}
