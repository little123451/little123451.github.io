import { TAU } from '../core/utils.js';
import { styleForType } from '../data/bulletStyles.js';

const FRAMES = 8;
const BASE = 40;
const cache = new Map();

function createFrames(type) {
  const style = styleForType(type);
  const frames = [];
  for (let f = 0; f < FRAMES; f += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = BASE;
    canvas.height = BASE;
    const ctx = canvas.getContext('2d');
    ctx.translate(BASE / 2, BASE / 2);
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = 7;
    drawTrail(ctx, style);
    drawShape(ctx, style, f / FRAMES);
    frames.push(canvas);
  }
  return frames;
}

function getFrames(type) {
  const key = styleForType(type).shape + '|' + type;
  let frames = cache.get(key);
  if (!frames) {
    frames = createFrames(type);
    cache.set(key, frames);
  }
  return frames;
}

function drawTrail(ctx, style) {
  if (!style.trail) return;
  const len = 12 + style.trail * 10;
  const grad = ctx.createLinearGradient(0, 2, 0, len);
  grad.addColorStop(0, style.glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-3.2, 2);
  ctx.lineTo(3.2, 2);
  ctx.lineTo(0, len);
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx, style, t) {
  const color = style.color;
  const white = '#ffffff';
  const pulse = 1 + Math.sin(t * TAU) * 0.12;
  const spin = style.spin ? t * TAU : 0;
  ctx.rotate(spin);

  switch (style.shape) {
    case 'pellet': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 6.4 * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(-1, -1, 2.6, 0, TAU);
      ctx.fill();
      break;
    }
    case 'wind': {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i += 1) {
        ctx.globalAlpha = 0.95 - i * 0.22;
        ctx.lineWidth = 3.8 - i * 0.7;
        ctx.beginPath();
        ctx.arc(0, 4 + i * 2.2, 7.4 - i * 1.2, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 4, 7.4, Math.PI * 0.3, Math.PI * 0.7);
      ctx.stroke();
      break;
    }
    case 'flame': {
      const wobble = Math.sin(t * TAU) * 1.2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(wobble, -10);
      ctx.quadraticCurveTo(6, -2, 4.4, 3.5);
      ctx.quadraticCurveTo(2.4, 7.5, 0, 7.5);
      ctx.quadraticCurveTo(-2.4, 7.5, -4.4, 3.5);
      ctx.quadraticCurveTo(-6, -2, wobble, -10);
      ctx.fill();
      ctx.fillStyle = white;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(wobble * 0.4, 2, 2.1, 3.6, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'drop': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.bezierCurveTo(6, -1, 5.6, 3, 3.6, 5.6);
      ctx.bezierCurveTo(1.6, 8.2, -1.6, 8.2, -3.6, 5.6);
      ctx.bezierCurveTo(-5.6, 3, -6, -1, 0, -9);
      ctx.fill();
      ctx.fillStyle = white;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(-1.6, 1.6, 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'leaf': {
      ctx.rotate(-0.5);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.4, 8.4, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      break;
    }
    case 'bolt': {
      ctx.strokeStyle = color;
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-3, -9);
      ctx.lineTo(3, -2);
      ctx.lineTo(-2, 1);
      ctx.lineTo(4, 9);
      ctx.stroke();
      ctx.strokeStyle = white;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
    }
    case 'crystal': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(4.6, -2.4);
      ctx.lineTo(2.4, 8);
      ctx.lineTo(-2.4, 8);
      ctx.lineTo(-4.6, -2.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = white;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(1.6, 2);
      ctx.lineTo(-1.6, 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'shock': {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 1 - t * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, 4 + t * 6, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(0, 0, 2.4, 0, TAU);
      ctx.fill();
      break;
    }
    case 'bubble': {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 6.4 * pulse, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(-2, -2.4, 2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(1.6, 2.4, 1.4, 0, TAU);
      ctx.fill();
      break;
    }
    case 'rock': {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        const r = i % 2 === 0 ? 7.4 : 5.4;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(-2, -4);
      ctx.lineTo(2, -5);
      ctx.lineTo(3, -1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'sting': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(3.6, 3);
      ctx.lineTo(0, 1.4);
      ctx.lineTo(-3.6, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = white;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(1.2, 0);
      ctx.lineTo(-1.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'pulse': {
      const r = 4.2 + Math.sin(t * TAU) * 2.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, TAU);
      ctx.fill();
      break;
    }
    case 'wisp': {
      for (let i = 0; i < 3; i += 1) {
        ctx.globalAlpha = 0.75 - i * 0.2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(Math.sin((t + i * 0.2) * TAU) * 2.4, -2 + i * 3, 4.6 - i * 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(0, -3, 1.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'blade': {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -10.5);
      ctx.lineTo(2.8, 0);
      ctx.lineTo(0, 10.5);
      ctx.lineTo(-2.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = white;
      ctx.globalAlpha = 0.55 + Math.sin(t * TAU) * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, -8.5);
      ctx.lineTo(1.1, 0);
      ctx.lineTo(0, 8.5);
      ctx.lineTo(-1.1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    default: {
      const rotate = t * TAU;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = rotate + (i / 8) * TAU;
        const r = i % 2 === 0 ? 8 : 2.6;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = white;
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, TAU);
      ctx.fill();
      break;
    }
  }
}

export function bulletColor(type) {
  return styleForType(type).color;
}

export function drawBullet(ctx, bullet) {
  const style = styleForType(bullet.type);
  const frames = getFrames(bullet.type);
  const frameIndex = Math.floor(bullet.life * 16 + (bullet.phase || 0)) % FRAMES;
  const frame = frames[(frameIndex + FRAMES) % FRAMES];
  const size = (bullet.r || 5) * 5.8 * style.size * (bullet.kind === 'player' ? 1.4 : 1);

  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  const direction = Number.isFinite(bullet.angle) ? bullet.angle : Math.atan2(bullet.vy, bullet.vx);
  ctx.rotate(direction + Math.PI / 2);

  ctx.drawImage(frame, -size / 2, -size / 2, size, size);
  ctx.restore();
}
