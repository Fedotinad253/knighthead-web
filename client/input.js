// Клавиатура и мышь с переназначаемым управлением (сохраняется в localStorage).
// У каждого действия до двух кнопок: клавиши (KeyboardEvent.code) или кнопки мыши: Mouse0 — левая, Mouse1 — колесо,
// Mouse2 — правая, Mouse3 и Mouse4 — боковые («назад» и «вперёд»).
const STORAGE = 'knighthead.bindings';

export const ACTIONS = [
  ['up', 'Вверх'], ['down', 'Вниз'], ['left', 'Влево'], ['right', 'Вправо'],
  ['light', 'Лёгкая атака'], ['heavy', 'Тяжёлая атака'], ['card', 'Карта (удерживать)'],
  ['dash', 'Перекат'], ['parry', 'Парирование'], ['ability', 'Бытовая магия'], ['interact', 'Взаимодействие'],
  ['back', 'Назад'], ['help', 'Управление'], ['debug', 'Отладка'],
];

export const DEFAULT_BINDINGS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  light: ['Mouse0'], heavy: ['Mouse2'], card: ['ShiftLeft', 'ShiftRight'],
  dash: ['Space'], parry: ['KeyV'], ability: ['KeyQ'], interact: ['KeyE'],
  back: ['Escape', 'Backspace'], help: ['F1'], debug: ['F3', 'Backquote'],
};

/** Как показать кнопку игроку. */
export function keyName(code) {
  if (!code) return '—';
  const names = { Mouse0: 'ЛКМ', Mouse1: 'Колесо', Mouse2: 'ПКМ', Mouse3: 'Мышь 4 (назад)', Mouse4: 'Мышь 5 (вперёд)', Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Правый Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl', AltLeft: 'Alt', AltRight: 'Правый Alt', Escape: 'Esc', Backspace: 'Backspace',
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
    this.capture = null;
    this.bindings = this.load();

    const press = (code) => {
      if (this.capture) { const done = this.capture; this.capture = null; done(code); return; }
      this.down.add(code);
      this.pressed.add(code);
    };
    addEventListener('keydown', (e) => {
      if (this.capture || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      press(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
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

  load() {
    const bindings = structuredClone(DEFAULT_BINDINGS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE)) ?? {};
      for (const [action] of ACTIONS) if (Array.isArray(saved[action])) bindings[action] = saved[action].slice(0, 2);
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
  get interactPressed() { return this.hit('interact'); }
  get interactHeld() { return this.held('interact'); }
  get backPressed() { return this.hit('back'); }

  /** Вызывать в конце кадра. */
  endFrame() { this.pressed.clear(); }
}
