export class Animator {
  constructor(speciesMeta) {
    this.anims = speciesMeta.anims;
    this.state = null;
    this.frame = 0;
    this.time = 0;
    this.once = false;
    this.finished = false;
  }

  set(state, once = false) {
    if (this.state === state && !(once && this.finished)) return;
    if (this.state === state && once) return;
    this.state = this.anims[state] ? state : 'idle';
    this.frame = 0;
    this.time = 0;
    this.once = once;
    this.finished = false;
  }

  update(dtMs) {
    if (!this.state || this.finished) return;
    const slot = this.anims[this.state];
    if (!slot) return;
    this.time += dtMs;
    let guard = 0;
    while (this.time >= slot.durations[this.frame] && guard < 120) {
      this.time -= slot.durations[this.frame];
      this.frame += 1;
      if (this.frame >= slot.frames) {
        if (this.once) {
          this.frame = slot.frames - 1;
          this.finished = true;
          break;
        }
        this.frame = 0;
      }
      guard += 1;
    }
  }

  get slot() {
    return this.state ? this.anims[this.state] : null;
  }
}

export function drawAnimator(ctx, images, animator, x, y, scale, row, alpha = 1, flash = false) {
  const slot = animator?.slot;
  if (!slot) return;
  const img = images.get(slot.src);
  if (!img) return;
  const frame = Math.min(animator.frame, slot.frames - 1);
  const safeRow = Math.min(Math.max(row, 0), slot.rows - 1);
  const rowAnchors = Array.isArray(slot.anchors?.[safeRow]?.[0]) ? slot.anchors[safeRow] : null;
  const anchor = (rowAnchors && rowAnchors[frame]) || (Array.isArray(slot.anchors?.[frame]) ? slot.anchors[frame] : null) || [slot.fw / 2, slot.fh / 2];
  const sx = frame * slot.fw;
  const sy = safeRow * slot.fh;
  const destX = x - anchor[0] * scale;
  const destY = y - anchor[1] * scale;
  const destW = slot.fw * scale;
  const destH = slot.fh * scale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, sx, sy, slot.fw, slot.fh, destX, destY, destW, destH);
  if (flash) {
    if ('filter' in ctx) {
      ctx.filter = 'brightness(0) invert(1)';
      ctx.globalAlpha = alpha * 0.85;
      ctx.drawImage(img, sx, sy, slot.fw, slot.fh, destX, destY, destW, destH);
      ctx.filter = 'none';
    } else {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.7;
      ctx.drawImage(img, sx, sy, slot.fw, slot.fh, destX, destY, destW, destH);
    }
  }
  ctx.restore();
}

export function drawIdlePreview(ctx, images, speciesMeta, x, y, scale, row = 0) {
  const slot = speciesMeta?.anims?.idle;
  if (!slot) return;
  const img = images.get(slot.src);
  if (!img) return;
  const safeRow = Math.min(Math.max(row, 0), slot.rows - 1);
  const rowAnchors = Array.isArray(slot.anchors?.[safeRow]?.[0]) ? slot.anchors[safeRow] : null;
  const anchor = (rowAnchors && rowAnchors[0]) || (Array.isArray(slot.anchors?.[0]) ? slot.anchors[0] : null) || [slot.fw / 2, slot.fh / 2];
  ctx.drawImage(img, 0, safeRow * slot.fh, slot.fw, slot.fh, x - anchor[0] * scale, y - anchor[1] * scale, slot.fw * scale, slot.fh * scale);
}

export function spriteHeight(speciesMeta) {
  const idle = speciesMeta?.anims?.idle;
  const move = speciesMeta?.anims?.move;
  return Math.max(idle?.fh || 32, move?.fh || 0);
}

export function spriteWidth(speciesMeta) {
  const idle = speciesMeta?.anims?.idle;
  const move = speciesMeta?.anims?.move;
  return Math.max(idle?.fw || 32, move?.fw || 0);
}
