// Клавиатура и мышь с переназначаемым управлением (сохраняется в localStorage).
// У каждого действия до двух кнопок: клавиши (KeyboardEvent.code) или кнопки мыши: Mouse0 — левая, Mouse1 — колесо,
// Mouse2 — правая, Mouse3 и Mouse4 — боковые («назад» и «вперёд»).
const STORAGE = 'knighthead.bindings';

export const ACTIONS = [
  ['up', 'Вверх'], ['down', 'Вниз'], ['left', 'Влево'], ['right', 'Вправо'],
  ['light', 'Лёгкая атака'], ['heavy', 'Тяжёлая атака'], ['card', 'Карта (удерживать)'],
  ['dash', 'Перекат'], ['parry', 'Парирование'], ['ability', 'Бытовая способность'], ['magic', 'Магия'], ['interact', 'Взаимодействие'],
  ['back', 'Назад'], ['help', 'Управление'], ['debug', 'Отладка'],
];

const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
/** Модификаторы, у которых есть сочетания браузера: в игре они отключаются, только если кнопка назначена. */
const MODIFIERS = ['AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];

export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  light: ['Mouse0'], heavy: ['Mouse2'], card: ['ShiftLeft', 'ShiftRight'],
  dash: ['Space'], parry: ['KeyV'], ability: ['KeyQ'], magic: ['KeyR'], interact: ['KeyF'],
  back: ['Escape', 'Backspace'], help: ['F1'], debug: ['F3', 'Backquote'],
};

/** Прежние кнопки по умолчанию: если игрок их не менял, сохранённое заменяется новыми. */
const OLD_DEFAULTS = { card: ['AltLeft,AltRight', 'MetaLeft,MetaRight'], interact: ['KeyE'] };

/** Как показать кнопку игроку. */
export function keyName(code) {
  if (!code) return '—';
  const names = { Mouse0: 'ЛКМ', Mouse1: 'Колесо', Mouse2: 'ПКМ', Mouse3: 'Мышь 4 (назад)', Mouse4: 'Мышь 5 (вперёд)', Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Правый Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl', AltLeft: IS_MAC ? 'Option' : 'Alt', AltRight: IS_MAC ? 'Правый Option' : 'Правый Alt',
    MetaLeft: IS_MAC ? 'Cmd' : 'Win', MetaRight: IS_MAC ? 'Правый Cmd' : 'Правый Win', Escape: 'Esc', Backspace: 'Backspace',
    Enter: 'Enter', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', CapsLock: 'CapsLock' };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.mouseX = 0; this.mouseY = 0;
    this.enabled = true;
    /** Игра началась: сочетания браузера с назначенными Alt и Cmd больше не должны срабатывать. */
    this.playing = false;
    this.capture = null;
    this.bindings = this.load();

    const press = (code) => {
      if (this.capture) { const done = this.capture; this.capture = null; done(code); return; }
      this.down.add(code);
      this.pressed.add(code);
    };
    addEventListener('keydown', (e) => {
      if (this.capture || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'Tab'].includes(e.code) || this.blocksShortcut(e)) e.preventDefault();
      // Автоповтор возвращает удержанную клавишу, если её сбросили при отпускании Cmd.
      if (e.repeat) { if (!this.capture) this.down.add(e.code); return; }
      press(e.code);
    });
    addEventListener('keyup', (e) => {
      if (this.playing && MODIFIERS.includes(e.code)) e.preventDefault(); // одиночный Alt не открывает меню браузера
      this.down.delete(e.code);
      // Пока Cmd зажат, macOS не присылает отпускание других клавиш — иначе они «залипнут».
      if (e.code === 'MetaLeft' || e.code === 'MetaRight') {
        for (const code of [...this.down]) if (!code.startsWith('Mouse') && !MODIFIERS.includes(code)) this.down.delete(code);
      }
    });
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouseY = (e.clientY - r.top) * (canvas.height / r.height);
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button <= 4) press(`Mouse${e.button}`); });
    // Боковые кнопки и колесо не должны листать историю браузера или включать прокрутку.
    for (const type of ['mousedown', 'mouseup', 'auxclick']) addEventListener(type, (e) => { if (e.button === 1 || e.button >= 3) e.preventDefault(); });
    addEventListener('mousedown', (e) => { if (this.capture && e.target.closest?.('#controls')) { e.preventDefault(); press(`Mouse${e.button}`); } }, true);
    addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    addEventListener('contextmenu', (e) => { if (e.target === canvas || this.capture) e.preventDefault(); });
  }

  /** Нажатие в игре с зажатым назначенным Alt или Cmd — не сочетание браузера. С Shift оставлены: жёсткая перезагрузка и т.п. */
  blocksShortcut(e) {
    if (!this.playing || e.shiftKey) return false;
    const bound = (prefix) => ACTIONS.some(([action]) => this.bindings[action].some((c) => c?.startsWith(prefix)));
    return ((e.altKey || e.code.startsWith('Alt')) && bound('Alt')) || ((e.metaKey || e.code.startsWith('Meta')) && bound('Meta'));
  }

  load() {
    const bindings = structuredClone(DEFAULT_BINDINGS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE)) ?? {};
      for (const [action] of ACTIONS) {
        if (!Array.isArray(saved[action]) || OLD_DEFAULTS[action]?.includes(String(saved[action]))) continue;
        bindings[action] = saved[action].slice(0, 2);
      }
    } catch { /* настройки нет или хранилище недоступно */ }
    return bindings;
  }

  save() { try { localStorage.setItem(STORAGE, JSON.stringify(this.bindings)); } catch { /* без сохранения */ } }

  reset() { this.bindings = structuredClone(DEFAULT_BINDINGS); this.save(); }

  /** Назначить кнопку действию (slot 0 или 1). Кнопка снимается с других действий, чтобы не было двойных. */
  bind(action, slot, code) {
    for (const [other] of ACTIONS) this.bindings[other] = this.bindings[other].map((c) => (c === code ? null : c));
    const list = [...this.bindings[action]];
    list[slot] = code;
    this.bindings[action] = list;
    this.save();
  }

  /** Подождать следующую нажатую кнопку (для переназначения). */
  listen(callback) { this.capture = callback; this.down.clear(); }

  held(action) { return this.enabled && this.bindings[action].some((c) => c && this.down.has(c)); }
  hit(action) { return this.enabled && this.bindings[action].some((c) => c && this.pressed.has(c)); }
  /** Нажатие в этом кадре даже при выключенном вводе (для меню). */
  hitAlways(action) { return this.bindings[action].some((c) => c && this.pressed.has(c)); }
  keyPressed(...codes) { return this.enabled && codes.some((c) => this.pressed.has(c)); }

  get move() {
    let x = 0, z = 0;
    if (this.held('up')) z += 1;
    if (this.held('down')) z -= 1;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    const l = Math.hypot(x, z);
    return l > 0 ? [x / l, z / l] : [0, 0];
  }

  get lightPressed() { return this.hit('light'); }
  get heavyPressed() { return this.hit('heavy'); }
  get cardHeld() { return this.held('card'); }
  get dashPressed() { return this.hit('dash'); }
  get parryPressed() { return this.hit('parry'); }
  get abilityPressed() { return this.hit('ability'); }
  get magicPressed() { return this.hit('magic'); }
  get interactPressed() { return this.hit('interact'); }
  get interactHeld() { return this.held('interact'); }
  get backPressed() { return this.hit('back'); }

  /** Вызывать в конце кадра. */
  endFrame() { this.pressed.clear(); }
}
