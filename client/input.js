// Клавиатура и мышь. Управление как в Unity-версии:
// WASD/стрелки — бег, мышь — прицел, ЛКМ — лёгкая, ПКМ — тяжёлая, Shift — карта, Пробел — рывок,
// V — парирование, E — взаимодействие, Esc — назад, F1 — подсказка.
export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.mouseX = 0; this.mouseY = 0;
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouseDown = [false, false, false]; });
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouseY = (e.clientY - r.top) * (canvas.height / r.height);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => { if (e.button <= 2) this.mouseDown[e.button] = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  key(code) { return this.enabled && this.down.has(code); }
  keyPressed(...codes) { return this.enabled && codes.some((c) => this.pressed.has(c)); }

  get move() {
    let x = 0, z = 0;
    if (this.key('KeyW') || this.key('ArrowUp')) z += 1;
    if (this.key('KeyS') || this.key('ArrowDown')) z -= 1;
    if (this.key('KeyD') || this.key('ArrowRight')) x += 1;
    if (this.key('KeyA') || this.key('ArrowLeft')) x -= 1;
    const l = Math.hypot(x, z);
    return l > 0 ? [x / l, z / l] : [0, 0];
  }

  get lightPressed() { return this.enabled && this.mousePressed[0]; }
  get heavyPressed() { return this.enabled && this.mousePressed[2]; }
  get cardHeld() { return this.key('ShiftLeft') || this.key('ShiftRight'); }
  get dashPressed() { return this.keyPressed('Space'); }
  get parryPressed() { return this.keyPressed('KeyV'); }
  get interactPressed() { return this.keyPressed('KeyE'); }
  get interactHeld() { return this.key('KeyE'); }
  get backPressed() { return this.keyPressed('Escape', 'Backspace'); }

  /** Вызывать в конце кадра. */
  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false];
  }
}
