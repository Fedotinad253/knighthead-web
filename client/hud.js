// Интерфейс поверх игры (HTML): здоровье и карты, напарник, полоса босса, объявления, подсказка взаимодействия,
// диалог с NPC, камень на распутье (сложность и снаряжение перед боем), итоги боя, прогресс миров на карте, подсказка управления.
import { WEAPONS, BOSSES, DIFFICULTIES, WORLDS, CARDS, PLAYER, SESSION, ABILITIES, MAGIC, CHARMS, CURSES, RANKS } from '../shared/data.js';
import { MAP, nodeNear } from '../shared/scenes.js';
import { ACTIONS, keyName } from './input.js';
import { getVolume, setVolume, unlockAudio, blip } from './assets.js';

const $ = (id) => document.getElementById(id);
const iconUrl = (path) => new URL(`../assets/${path}`, import.meta.url).href;
const PHASES = { likho: ['Из кустов', 'Ползучее', 'Слепое бешенство'], yaga: ['Ступа', 'Избушка: бей по ногам', 'Печь'] };

export class Hud {
  constructor(game) {
    this.game = game;
    this.announceUntil = 0;
    this.dialogueItem = null;
    this.dialogueIndex = {};
    this.stoneKey = '';
    $('cards').innerHTML = Array.from({ length: CARDS.max }, () => '<div class="card"><i></i></div>').join('');
    $('stone-close').onclick = () => game.send({ t: 'closeStone' });
    $('loadout-go').onclick = () => {
      const p = this.pick;
      if (p) game.send({ t: 'startFight', weapon: p.weapon, ability: p.ability, magic: p.magic, charm: p.charm, curses: [...p.curses] });
    };
    $('loadout-retreat').onclick = () => game.send({ t: 'retreat' });
    $('result-close').onclick = () => { $('result').hidden = true; };
    $('controls-close').onclick = () => this.toggle('controls', false);
    $('controls-reset').onclick = () => { game.input.reset(); this.renderControls(); };
    $('menu-controls').onclick = () => this.toggle('controls', true);
    // Громкость: двигаешь — сразу слышно взмах на новой громкости.
    const showVolume = () => { $('volume').value = Math.round(getVolume() * 100); $('volume-value').textContent = `${Math.round(getVolume() * 100)}%`; };
    $('volume').oninput = () => { setVolume(Number($('volume').value) / 100); showVolume(); };
    $('volume').onchange = () => { unlockAudio(); blip('slash'); };
    showVolume();
    this.setupDebug();
  }

  // ---------------------------------------------------------------- Управление и отладка

  /** Открыть/закрыть панель (controls или debug). Пока панель открыта, богатырь не слушает ввод. */
  toggle(id, open = $(id).hidden) {
    $(id).hidden = !open;
    if (id === 'controls' && open) this.renderControls();
    if (id === 'debug' && open) this.syncDebug();
    this.game.input.enabled = $('controls').hidden && $('debug').hidden;
  }

  renderControls() {
    const input = this.game.input;
    const table = $('controls-table');
    table.innerHTML = ACTIONS.map(([action, label]) =>
      `<tr><td>${label}</td>${[0, 1].map((slot) => `<td><button class="bind" data-action="${action}" data-slot="${slot}">${keyName(input.bindings[action][slot])}</button></td>`).join('')}</tr>`).join('');
    for (const button of table.querySelectorAll('.bind')) button.onclick = () => {
      button.textContent = 'нажмите…';
      button.classList.add('listening');
      input.listen((code) => {
        if (code !== 'Escape') input.bind(button.dataset.action, Number(button.dataset.slot), code);
        this.renderControls();
      });
    };
  }

  setupDebug() {
    const game = this.game;
    $('dbg-boss').innerHTML = BOSSES.map((b, i) => `<option value="${i}">${b.name}</option>`).join('');
    $('dbg-difficulty').innerHTML = DIFFICULTIES.map((d, i) => `<option value="${i}"${i === 0 ? ' selected' : ''}>${d.name}</option>`).join('');
    $('dbg-fight').onclick = () => game.send({ t: 'debug', cmd: 'fight', boss: Number($('dbg-boss').value), d: Number($('dbg-difficulty').value) });
    $('dbg-god').onchange = (e) => game.send({ t: 'debug', cmd: 'godmode', on: e.target.checked });
    $('dbg-auto').onchange = (e) => game.send({ t: 'debug', cmd: 'debugwin', on: e.target.checked });
    $('dbg-hitbox').onchange = (e) => { game.showHitboxes = e.target.checked; };
    for (const button of document.querySelectorAll('#debug [data-cmd]')) button.onclick = () => game.send({ t: 'debug', cmd: button.dataset.cmd });
  }

  syncDebug() {
    const flags = this.game.world?.game.flags ?? {};
    $('dbg-god').checked = !!flags.godmode;
    $('dbg-auto').checked = !!flags.debugwin;
    $('dbg-hitbox').checked = !!this.game.showHitboxes;
  }

  show() { $('hud').hidden = false; }

  announce(text) {
    const el = $('announce');
    el.textContent = text;
    el.style.opacity = 1;
    this.announceUntil = this.game.now + 2.6;
  }

  /** Реплика NPC: взаимодействие — следующая, «назад» — закрыть. */
  dialogue(item) {
    const index = this.dialogueIndex[item.id] ?? 0;
    this.dialogueItem = item;
    this.dialogueIndex[item.id] = (index + 1) % item.lines.length;
    $('dialogue-speaker').textContent = item.speaker;
    $('dialogue-text').textContent = item.lines[index];
    const bindings = this.game.input.bindings;
    $('dialogue-hint').textContent = `${keyName(bindings.interact[0])} — дальше, ${keyName(bindings.back[0])} — закрыть`;
    $('dialogue').hidden = false;
  }

  get dialogueOpen() { return !$('dialogue').hidden; }

  /** Картинка на панели боя: меняется, только когда сменился предмет (панель обновляется каждый кадр). */
  setIcon(id, path = '') {
    const el = $(id);
    if (el.dataset.path === path) return;
    el.dataset.path = path;
    el.hidden = !path;
    if (path) el.src = iconUrl(path);
  }

  /** Итоги боя: рейтинг, из чего он сложился, очки прокачки и монеты. */
  showResult(m) {
    const rank = RANKS[m.rank];
    const minutes = Math.floor(m.time / 60), seconds = String(m.time % 60).padStart(2, '0');
    $('result-title').textContent = `Победа: ${BOSSES[m.boss].name}`;
    $('result-rank').textContent = rank.name;
    $('result-rank').style.color = rank.color;
    const rows = [
      ['Время', `${minutes}:${seconds}`, m.parts.time, 40],
      ['Получено урона', m.damageTaken, m.parts.damage, 40],
      ['Парирования', m.parries, m.parts.parries, 20],
      ['Сложность', DIFFICULTIES[m.difficulty].name, m.difficulty >= 1 ? 10 : 0, 10],
    ];
    $('result-table').innerHTML = rows.map(([name, value, score, max]) =>
      `<tr><td>${name}</td><td>${value}</td><td>${score} / ${max}</td></tr>`).join('') + `<tr><td><b>Оценка</b></td><td></td><td><b>${m.score}</b></td></tr>`;
    const curses = m.curses ? `, за проклятия ${m.cursePoints} из ${m.curses}` : '';
    $('result-rewards').innerHTML = [
      `Очки прокачки: <b>+${m.gained}</b> <span class="small dim">(за рейтинг ${m.rankPoints}${curses}; по каждому боссу считается лучший бой)</span>`,
      `<img class="coin" src="${iconUrl('items/coin.png')}" alt=""> Монеты от трактирщика: <b>+${m.coinsGained}</b>`,
      `<span class="small dim">Всего: очков ${m.points}, монет ${m.coins}</span>`,
      m.firstStar ? '<b style="color:#ffcf3a">★ Звёздочка на карте!</b>' : '',
    ].filter(Boolean).join('<br>');
    $('result').hidden = false;
  }

  update() {
    const game = this.game, input = game.input, now = game.now;
    if (now > this.announceUntil) $('announce').style.opacity = 0;
    if (!input.capture) {
      if (input.hitAlways('help')) this.toggle('controls');
      if (input.hitAlways('debug')) this.toggle('debug');
      if (!$('controls').hidden && input.hitAlways('back')) this.toggle('controls', false);
      // Итоги боя закрываются «назад» или взаимодействием — и это нажатие больше никуда не идёт.
      if (!$('result').hidden && (input.hitAlways('back') || input.hitAlways('interact'))) {
        $('result').hidden = true;
        for (const c of [...input.bindings.back, ...input.bindings.interact]) input.pressed.delete(c);
      }
    }

    // Диалог: закрыть, листать, или закрыть, если отошёл.
    if (this.dialogueOpen) {
      const item = this.dialogueItem, local = game.local;
      const far = !local || Math.hypot(item.x - local.x, item.z - local.z) > item.radius + 0.6;
      if (input.backPressed || far || game.session?.state !== SESSION.TAVERN) $('dialogue').hidden = true;
      else if (input.interactPressed) { this.dialogue(item); for (const c of input.bindings.interact) input.pressed.delete(c); }
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
      $('dash').classList.toggle('off', now < local.nextRoll);
      $('parry').classList.toggle('off', now < local.parryReadyAt && !local.parrying);
      // Снаряжение из-под камня: способность с перезарядкой и оберег.
      const ability = ABILITIES[me.ability], magic = MAGIC[me.magic], charm = CHARMS[me.charm];
      $('gear').hidden = !ability && !magic && !charm;
      const magicCooldown = me.magicCooldown ?? 0;
      $('gear-magic').textContent = magic ? `${keyName(input.bindings.magic[0])} — ${magic.name}${magicCooldown > 0 ? `: ${Math.ceil(magicCooldown)} с` : ''}` : '';
      $('gear-magic').parentElement.classList.toggle('off', magicCooldown > 0);
      this.setIcon('gear-ability-icon', ability?.icon);
      this.setIcon('gear-magic-icon', magic?.icon);
      const cooldown = me.abilityCooldown ?? 0;
      $('gear-ability').textContent = ability ? `${keyName(input.bindings.ability[0])} — ${ability.name}${cooldown > 0 ? `: ${Math.ceil(cooldown)} с` : ''}` : '';
      $('gear-ability').parentElement.classList.toggle('off', cooldown > 0);
      $('gear-charm').textContent = charm ? `Оберег: ${charm.name}${me.charm === 'belt' && me.beltUsed ? ' (порван)' : ''}` : '';
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
      const fraction = Math.max(0, boss.hp / boss.max);
      $('boss-hp').style.width = `${fraction * 100}%`;
      // Деления полосы — границы фаз; пройденные тускнеют.
      const marks = boss.phaseMarks ?? [];
      const key = `${boss.kind}:${marks.join(',')}`;
      if (this.marksKey !== key) {
        this.marksKey = key;
        $('boss-marks').innerHTML = marks.map((m) => `<i class="boss-mark" style="left:${m * 100}%"></i>`).join('');
      }
      marks.forEach((m, i) => $('boss-marks').children[i]?.classList.toggle('passed', fraction <= m + 0.001));
      const names = PHASES[boss.kind];
      $('boss-phase').textContent = names ? `Фаза ${boss.phase}: ${names[boss.phase - 1] ?? ''}` : boss.phase > 1 ? 'Злится!' : '';
      const curses = (session?.curses ?? []).map((c) => CURSES[c]?.name).filter(Boolean);
      $('boss-curses').textContent = curses.length ? `Проклятия: ${curses.join(', ')}` : '';
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
        text = game.isWorldUnlocked(boss.world) ? `[${keyName(game.input.bindings.interact[0])}] В бой: ${boss.name}` : 'Путь закрыт';
      }
    } else if (game.me?.dragged) text = `Жми атаку — вырывайся! Ещё ${game.me.struggle}`;
    else if (local?.reviveTarget) text = `Удерживай [${keyName(game.input.bindings.interact[0])}] — поднять Богатыря ${local.reviveTarget.slot + 1}`;
    else if (local?.focused && !this.dialogueOpen) text = `[${keyName(game.input.bindings.interact[0])}] ${local.focused.prompt}`;
    $('prompt').hidden = !text;
    $('prompt').textContent = text;
    $('revive').hidden = !(local?.reviveProgress > 0);
    if (local?.reviveProgress > 0) $('revive-fill').style.width = `${(local.reviveProgress / PLAYER.reviveDuration) * 100}%`;

    const k = (action) => keyName(game.input.bindings[action][0]);
    const move = ['up', 'left', 'down', 'right'].map(k).join('');
    $('hint').textContent = onMap
      ? (game.session.stoneOpen ? `1 / 2 — выбрать сложность     ${k('back')} — отойти` : `${move} — бежать избушкой     ${k('interact')} — в бой у логова     ${k('back')} — отойти от карты`)
      : `${k('light')}/${k('heavy')} — атаки   ${k('card')} — карта   ${k('dash')} — перекат   ${k('parry')} — парирование   ${k('ability')} — способность   ${k('magic')} — магия   ${k('interact')} — действие   ${k('help')} — управление   ${k('debug')} — отладка`;
  }

  updateMap(onMap) {
    const game = this.game, session = game.session;
    if (onMap) {
      $('worlds').innerHTML = WORLDS.map((w, i) => {
        const open = game.isWorldUnlocked(i);
        let defeated = 0, total = 0;
        BOSSES.forEach((b, k) => { if (b.world === i) { total++; if (session.results[k] >= 0) defeated++; } });
        return `<div style="color:${open ? w.color : '#8c8080'}">${w.name}: ${open ? `${defeated}/${total}` : 'закрыто'}</div>`;
      }).join('') + `<div class="small">Очки прокачки: ${session.points ?? 0}<br><img class="coin" src="${iconUrl('items/coin.png')}" alt=""> Монеты: ${session.coins ?? 0}</div>`;
    }

    // Камень у логова: выбор сложности.
    const stoneOpen = onMap && session.stoneOpen && session.stoneBoss >= 0;
    $('stone').hidden = !stoneOpen;
    if (!stoneOpen) this.stoneKey = '';
    else {
      const key = `${session.stoneBoss}:${session.results[session.stoneBoss]}:${session.ranks?.[session.stoneBoss]}`;
      if (key !== this.stoneKey) {
        this.stoneKey = key;
        const boss = BOSSES[session.stoneBoss], best = session.results[session.stoneBoss], rank = session.ranks?.[session.stoneBoss] ?? -1;
        $('stone-title').textContent = boss.name;
        $('stone-description').textContent = `${boss.description}${rank >= 0 ? `${boss.description ? '. ' : ''}Лучший рейтинг: ${RANKS[rank].name}` : ''}`;
        $('stone-difficulty').innerHTML = DIFFICULTIES.map((d, i) =>
          `<button class="choice" data-d="${i}"><b>${i + 1}. ${d.name}${best >= i ? ' ✓' : ''}</b>${d.description}</button>`).join('');
        for (const button of $('stone-difficulty').children) button.onclick = () => game.send({ t: 'difficulty', d: Number(button.dataset.d) });
      }
    }

    // На локации босса, до начала боя: по три на выбор — оружие, бытовая магия, оберег, проклятия.
    const offer = session?.offer;
    const choosing = session?.state === SESSION.ARENA && session.preparing && offer;
    $('loadout').hidden = !choosing;
    if (!choosing) { this.loadoutKey = ''; this.pick = null; $('loadout-tip').hidden = true; return; }
    const key = JSON.stringify(offer);
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.pick = { weapon: offer.weapons[0], ability: offer.abilities[0] ?? null, magic: offer.magic[0] ?? null, charm: offer.charms[0] ?? null, curses: new Set() };
    $('loadout-title').textContent = `${BOSSES[session.boss]?.name ?? ''} — ${DIFFICULTIES[session.difficulty]?.name ?? ''}: снаряжение`;
    this.renderLoadout();
  }

  /** Карточки снаряжения: картинка и название; описание — во всплывающей подсказке при наведении. */
  renderLoadout() {
    const offer = this.game.session.offer, pick = this.pick;
    const fill = (id, list, field, item, iconClass = '', cls = '') => {
      $(id).innerHTML = list.map((key) => {
        const it = item(key), boss = BOSSES[it.unique];
        const pic = it.icon ? `<img class="choice-icon ${iconClass}" src="${iconUrl(it.icon)}" alt="">` : `<span class="choice-letter">${it.name.match(/\p{L}/u)[0]}</span>`;
        // Пока у босса нет своего значка, особый предмет отмечен звёздочкой.
        const mark = !boss ? '' : boss.mark ? `<img class="unique-mark" src="${iconUrl(boss.mark)}" alt="Особый предмет">` : '<span class="unique-mark unique-star">★</span>';
        return `<button class="choice item ${cls}" data-${field}="${key}"><span class="choice-pic">${pic}${mark}</span><b>${it.name}</b></button>`;
      }).join('');
      for (const button of $(id).children) {
        const key = button.dataset[field], it = item(key);
        button.onpointerenter = button.onfocus = () => this.showTip(button, it);
        button.onpointerleave = button.onblur = () => { $('loadout-tip').hidden = true; };
        button.onclick = () => {
          if (field === 'curse') { if (pick.curses.has(key)) pick.curses.delete(key); else pick.curses.add(key); }
          else pick[field] = field === 'weapon' ? Number(key) : key;
          this.markPicked();
        };
      }
    };
    const weapon = (w) => ({ name: WEAPONS[w].name, description: WEAPONS[w].description, icon: WEAPONS[w].sprite });
    fill('loadout-weapons', offer.weapons, 'weapon', weapon, 'weapon');
    fill('loadout-abilities', offer.abilities, 'ability', (a) => ABILITIES[a]);
    fill('loadout-magic', offer.magic, 'magic', (a) => MAGIC[a]);
    fill('loadout-charms', offer.charms, 'charm', (c) => CHARMS[c]);
    fill('loadout-curses', offer.curses, 'curse', (c) => CURSES[c], '', 'curse');
    // В самом первом бою с Ягой нет ни проклятий, ни бегства.
    $('loadout-curses').previousElementSibling.hidden = !offer.curses.length;
    $('loadout-curses').hidden = !offer.curses.length;
    $('loadout-summary').hidden = !offer.curses.length;
    $('loadout-retreat').hidden = !!this.game.session.firstYaga;
    this.markPicked();
    const bindings = this.game.input.bindings;
    $('loadout-ability-key').textContent = `(${keyName(bindings.ability[0])})`;
    $('loadout-magic-key').textContent = `(${keyName(bindings.magic[0])})`;
  }

  /** Подсветить выбранное. Карточки не перестраиваются — подсказка и наведение не сбиваются. */
  markPicked() {
    const pick = this.pick;
    for (const button of document.querySelectorAll('#loadout .choice')) {
      const d = button.dataset;
      const picked = d.weapon !== undefined ? pick.weapon === Number(d.weapon)
        : d.ability ? pick.ability === d.ability : d.magic ? pick.magic === d.magic : d.charm ? pick.charm === d.charm : pick.curses.has(d.curse);
      button.classList.toggle('picked', picked);
    }
    const n = pick.curses.size;
    $('loadout-summary').textContent = n ? `Проклятий: ${n}. Засчитаются за рейтинг: D — 1, C и B — до 2, A и выше — до 3.` : 'Без проклятий.';
  }

  /** Подсказка над карточкой (не влезает — под ней), в пределах экрана. */
  showTip(button, item) {
    const tip = $('loadout-tip');
    $('tip-name').textContent = item.name;
    $('tip-text').textContent = item.description;
    $('tip-unique').textContent = BOSSES[item.unique] ? `Особый предмет: ${BOSSES[item.unique].name}` : '';
    tip.hidden = false;
    const r = button.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 6 >= 8 ? r.top - h - 6 : Math.min(innerHeight - h - 8, r.bottom + 6)}px`;
  }
}
