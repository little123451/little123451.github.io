import { CONFIG, clamp } from '../config.js';
import { rand } from '../core/utils.js';

export const TIER_HP = { common: 16, elite: 54 };
export const TIER_SIZE = { common: 56, elite: 78 };

export function createEnemy(species, wave, behavior) {
  const tier = species.tier === 'elite' ? 'elite' : 'common';
  const difficulty = 1 + wave * CONFIG.waves.difficultyPerWave;
  const x = rand(56, CONFIG.view.width - 56);
  const hp = TIER_HP[tier] * difficulty;
  const isElite = tier === 'elite';
  return {
    species,
    tier,
    behavior,
    x,
    y: -TIER_SIZE[tier] / 2 - 20,
    baseX: x,
    hp,
    maxHp: hp,
    size: TIER_SIZE[tier],
    radius: TIER_SIZE[tier] * 0.32,
    vy: clamp((isElite ? 68 : 92) + wave * 2.2, 68, 210),
    t: 0,
    shotTimer: isElite ? rand(0.6, 1.4) : Infinity,
    shotMs: isElite ? rand(1.5, 2.2) : 0,
    dead: false,
    hitAt: 0,
    scoreValue: isElite ? CONFIG.score.elite : CONFIG.score.common,
    expValue: CONFIG.exp.yields[tier],
    damage: isElite ? 10 : 8,
  };
}

export function enemyBulletSpeed(wave) {
  const { speedBase, speedPerWave, speedCap } = CONFIG.enemy.bullets;
  return Math.min(speedBase + wave * speedPerWave, speedCap);
}

function aimAt(enemy, ctx, spread = 0) {
  const angle = Math.atan2(ctx.playerY - enemy.y, ctx.playerX - enemy.x) + spread;
  return angle;
}

export function updateEnemy(enemy, dt, ctx) {
  enemy.t += dt;
  if (enemy.behavior === 'sine') {
    enemy.x = enemy.baseX + Math.sin(enemy.t * 1.8) * 52;
    enemy.y += enemy.vy * dt;
  } else if (enemy.behavior === 'dive') {
    const steer = clamp((ctx.playerX - enemy.x) * 0.9, -140, 140);
    enemy.x += steer * dt;
    enemy.y += enemy.vy * 1.25 * dt;
  } else if (enemy.behavior === 'hover') {
    const targetY = 180 + (enemy.tier === 'elite' ? 24 : 0);
    if (enemy.y < targetY) {
      enemy.y += enemy.vy * dt;
    } else {
      enemy.x = clamp(enemy.baseX + Math.sin(enemy.t * 1.2) * 66, 40, CONFIG.view.width - 40);
    }
  } else {
    enemy.y += enemy.vy * dt;
  }

  if (enemy.shotMs && ctx.canShoot && enemy.y > 20) {
    enemy.shotTimer -= dt;
    if (enemy.shotTimer <= 0) {
      enemy.shotTimer = enemy.shotMs * rand(0.85, 1.2);
      const speed = enemyBulletSpeed(ctx.wave);
      const shots = enemy.tier === 'elite' ? 3 : 1;
      for (let i = 0; i < shots; i += 1) {
        const spread = shots === 1 ? 0 : (i - (shots - 1) / 2) * 0.16;
        ctx.fire({
          x: enemy.x,
          y: enemy.y + 16,
          angle: aimAt(enemy, ctx, spread),
          speed,
          damage: enemy.damage,
          color: '#ffb3c8',
        });
      }
    }
  }

  if (enemy.y > CONFIG.enemy.despawnY) return false;
  return true;
}
