export class Input {
  constructor(canvas, view) {
    this.canvas = canvas;
    this.view = view;
    this.keys = new Set();
    this.pointer = { x: view.width / 2, y: view.height * 0.8, active: false, down: false, type: 'mouse' };
    this.onPause = null;
    this.onStart = null;
    this.onMute = null;
    this._bind();
  }

  _toLogical(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.view.width,
      y: ((clientY - rect.top) / rect.height) * this.view.height,
    };
  }

  _bind() {
    const block = (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    };

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' || event.code === 'KeyP') this.onPause?.();
      if (event.code === 'KeyM') this.onMute?.();
      if (event.code === 'Enter' || event.code === 'Space') this.onStart?.();
      block(event);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));

    const updatePointer = (event) => {
      const p = this._toLogical(event.clientX, event.clientY);
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      updatePointer(event);
      this.pointer.type = event.pointerType;
      this.pointer.active = true;
      this.pointer.down = true;
      this.onStart?.();
    });
    this.canvas.addEventListener('pointermove', (event) => {
      updatePointer(event);
      this.pointer.type = event.pointerType;
      this.pointer.active = true;
    });
    this.canvas.addEventListener('pointerup', () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  axis() {
    let x = 0;
    let y = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) x += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) y += 1;
    return { x, y };
  }

  isFocusing() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  pointerTarget() {
    return this.pointer;
  }
}
