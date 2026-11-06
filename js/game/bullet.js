import { CONFIG } from '../config.js';

export function createBulletPool(size) {
  return Array.from({ length: size }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, damage: 0, pierce: 0, color: '#fff', life: 0 }));
}

function acquire(pool) {
  for (let i = 0; i < pool.length; i += 1) {
    if (!pool[i].active) return pool[i];
  }
  return null;
}

export function spawnPlayerBullet(pool, { x, y, angle, damage, pierce }) {
  const bullet = acquire(pool);
  if (!bullet) return null;
  const speed = CONFIG.bullets.playerSpeed;
  bullet.active = true;
  bullet.x = x;
  bullet.y = y;
  bullet.vx = Math.cos(angle) * speed;
  bullet.vy = Math.sin(angle) * speed;
  bullet.r = CONFIG.bullets.playerRadius;
  bullet.damage = damage;
  bullet.pierce = pierce;
  bullet.kind = 'player';
  bullet.life = 0;
  return bullet;
}

export function spawnEnemyBullet(pool, { x, y, angle, speed, damage = 10, color = '#ffd0d0', radius = CONFIG.enemy.bullets.radius }) {
  const bullet = acquire(pool);
  if (!bullet) return null;
  bullet.active = true;
  bullet.x = x;
  bullet.y = y;
  bullet.vx = Math.cos(angle) * speed;
  bullet.vy = Math.sin(angle) * speed;
  bullet.r = radius;
  bullet.damage = damage;
  bullet.pierce = 0;
  bullet.color = color;
  bullet.kind = 'enemy';
  bullet.life = 0;
  return bullet;
}

export function updateBulletPool(pool, dt) {
  const { width, height } = CONFIG.view;
  for (const bullet of pool) {
    if (!bullet.active) continue;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life += dt;
    if (bullet.x < -40 || bullet.x > width + 40 || bullet.y < -60 || bullet.y > height + 60) {
      bullet.active = false;
    }
  }
}
