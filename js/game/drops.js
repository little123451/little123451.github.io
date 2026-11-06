import { CONFIG, clamp } from '../config.js';
import { rand } from '../core/utils.js';

export function createDrop(itemId, x, y) {
  const d = CONFIG.drops;
  return {
    itemId,
    x,
    y,
    vx: rand(-d.spawnVx, d.spawnVx),
    vy: -rand(d.spawnVyMin, d.spawnVyMax),
    r: d.radius,
    life: d.lifeMs / 1000,
    maxLife: d.lifeMs / 1000,
    t: 0,
    magnet: false,
  };
}

export function collideDrops(drops) {
  const d = CONFIG.drops;
  for (let i = 0; i < drops.length; i += 1) {
    for (let j = i + 1; j < drops.length; j += 1) {
      const a = drops[i];
      const b = drops[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDist = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minDist * minDist || d2 < 0.0001) continue;
      const dist = Math.sqrt(d2);
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;

      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative < 0) {
        const impulse = relative * 0.5;
        a.vx += impulse * nx;
        a.vy += impulse * ny;
        b.vx -= impulse * nx;
        b.vy -= impulse * ny;
      }
      a.vx *= d.bounceX;
      b.vx *= d.bounceX;
    }
  }
}

export function updateDrop(drop, dt, player) {
  const d = CONFIG.drops;
  const { width, height } = CONFIG.view;
  drop.t += dt;
  drop.life -= dt;
  if (drop.life <= 0) return 'expire';

  const dx = player.x - drop.x;
  const dy = player.y - drop.y;
  const dist2ToPlayer = dx * dx + dy * dy;
  const magnetRadius = d.magnetRadius;

  if (drop.magnet || dist2ToPlayer < magnetRadius * magnetRadius) {
    drop.magnet = true;
    const dist = Math.sqrt(dist2ToPlayer) || 1;
    const speed = d.magnetSpeed * (1 + Math.max(0, magnetRadius - dist) / magnetRadius);
    const blend = Math.min(1, dt * 9);
    drop.vx += ((dx / dist) * speed - drop.vx) * blend;
    drop.vy += ((dy / dist) * speed - drop.vy) * blend;
  } else {
    drop.vy += d.gravity * dt;
    const drag = Math.exp(-d.drag * dt);
    drop.vx *= drag;
    drop.vy *= drag;
  }

  drop.x += drop.vx * dt;
  drop.y += drop.vy * dt;

  if (drop.x < drop.r) {
    drop.x = drop.r;
    drop.vx = Math.abs(drop.vx) * d.bounceX;
  } else if (drop.x > width - drop.r) {
    drop.x = width - drop.r;
    drop.vx = -Math.abs(drop.vx) * d.bounceX;
  }
  if (drop.y > height - drop.r) {
    drop.y = height - drop.r;
    drop.vy = -Math.abs(drop.vy) * d.bounceY;
    drop.vx *= 0.92;
  } else if (drop.y < drop.r) {
    drop.y = drop.r;
    drop.vy = Math.abs(drop.vy) * 0.5;
  }

  const dx2 = player.x - drop.x;
  const dy2 = player.y - drop.y;
  const pickupRadius = drop.r + player.radius * 0.8;
  if (dx2 * dx2 + dy2 * dy2 < pickupRadius * pickupRadius) return 'collect';
  return 'ok';
}

export function maxDropsReached(count) {
  return count >= CONFIG.drops.max;
}

export function dropLifeRatio(drop) {
  return clamp(drop.life / (CONFIG.drops.blinkMs / 1000), 0, 1);
}
