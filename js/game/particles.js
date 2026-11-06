import { TAU, rand } from '../core/utils.js';

export function createParticleList(max = 320) {
  return { max, items: [] };
}

export function burst(list, x, y, count, color, options = {}) {
  const speed = options.speed ?? 220;
  const size = options.size ?? 4;
  const life = options.life ?? 0.6;
  for (let i = 0; i < count; i += 1) {
    if (list.items.length >= list.max) list.items.shift();
    const angle = rand(0, TAU);
    const velocity = rand(speed * 0.25, speed);
    list.items.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      size: rand(size * 0.5, size),
      color,
      life: rand(life * 0.5, life),
      maxLife: life,
    });
  }
}

export function updateParticles(list, dt) {
  const items = list.items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const p = items[i];
    p.life -= dt;
    if (p.life <= 0) {
      items.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
  }
}
