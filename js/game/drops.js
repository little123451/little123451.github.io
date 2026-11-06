import { CONFIG } from '../config.js';
import { dist2 } from '../core/utils.js';

export function createDrop(itemId, x, y) {
  return { itemId, x, y, vy: CONFIG.drops.fallSpeed, life: CONFIG.drops.lifeMs / 1000, t: 0, magnet: false };
}

export function updateDrop(drop, dt, player) {
  drop.t += dt;
  drop.life -= dt;
  if (drop.life <= 0) return 'expire';

  const dx = player.x - drop.x;
  const dy = player.y - drop.y;
  const d2 = dx * dx + dy * dy;
  const magnetRadius = CONFIG.drops.magnetRadius;

  if (drop.magnet || d2 < magnetRadius * magnetRadius) {
    drop.magnet = true;
    const d = Math.sqrt(d2) || 1;
    const speed = 140 + Math.max(0, magnetRadius - d) * 4;
    drop.x += (dx / d) * speed * dt;
    drop.y += (dy / d) * speed * dt;
  } else {
    drop.y += drop.vy * dt;
    drop.x += Math.sin(drop.t * 3) * 12 * dt;
  }

  if (dist2(drop.x, drop.y, player.x, player.y) < (CONFIG.drops.radius + player.radius) ** 2) return 'collect';
  if (drop.y > CONFIG.view.height + 30) return 'expire';
  return 'ok';
}
