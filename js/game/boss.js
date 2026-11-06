import { CONFIG } from '../config.js';
import { rand, TAU } from '../core/utils.js';

export const BOSS_ORDER = [144, 145, 146];

export function createBoss(species, wave) {
  const hp = CONFIG.boss.hpBase + wave * CONFIG.boss.hpPerWave;
  return {
    species,
    tier: 'boss',
    x: CONFIG.view.width / 2,
    y: -90,
    targetY: CONFIG.boss.entryY,
    hp,
    maxHp: hp,
    size: 132,
    radius: CONFIG.boss.radius,
    t: 0,
    attackTimer: 1.6,
    streamTimer: 0,
    angle: 0,
    entering: true,
    dead: false,
    dying: 0,
    hitAt: 0,
    scoreValue: CONFIG.score.boss,
    expValue: CONFIG.exp.yields.boss,
    damage: CONFIG.boss.contactDamage,
  };
}

function fireSpread(ctx, boss, count, spread, speed, damage, color, offset = 0) {
  const base = Math.atan2(ctx.playerY - boss.y, ctx.playerX - boss.x) + offset;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : (i - (count - 1) / 2) / ((count - 1) / 2);
    ctx.fire({
      x: boss.x,
      y: boss.y + 28,
      angle: base + t * spread,
      speed,
      damage,
      color,
      radius: 7,
    });
  }
}

function fireRing(ctx, boss, count, offset, speed, damage, color) {
  for (let i = 0; i < count; i += 1) {
    ctx.fire({
      x: boss.x,
      y: boss.y,
      angle: offset + (i / count) * TAU,
      speed,
      damage,
      color,
      radius: 6,
    });
  }
}

function attack(boss, dt, ctx) {
  const speed = Math.min(CONFIG.enemy.bullets.speedCap, 150 + ctx.wave * 6);
  const phase = boss.hp / boss.maxHp < 0.3 ? 2 : boss.hp / boss.maxHp < 0.6 ? 1 : 0;
  const rate = phase === 2 ? 0.68 : phase === 1 ? 0.84 : 1;

  if (boss.species.id === 144) {
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = rand(1.5, 1.9) * rate;
      if (Math.random() < 0.5) {
        const base = Math.PI / 2;
        for (let i = 0; i < 7 + phase * 2; i += 1) {
          const t = (i - (7 + phase * 2 - 1) / 2) / 3;
          ctx.fire({ x: boss.x, y: boss.y + 30, angle: base + t * 0.42, speed, damage: 12, color: '#8fe6ff', radius: 7 });
        }
      } else {
        fireSpread(ctx, boss, 3 + phase, 0.22, speed * 1.1, 12, '#8fe6ff');
      }
      if (phase === 2) fireRing(ctx, boss, 10, boss.t, speed * 0.8, 11, '#bff4ff');
    }
  } else if (boss.species.id === 145) {
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = rand(1.7, 2.1) * rate;
      if (Math.random() < 0.55) {
        fireRing(ctx, boss, 14 + phase * 4, boss.t * 0.9, speed * 0.85, 11, '#ffe066');
      } else {
        fireSpread(ctx, boss, 3 + phase, 0.3, speed * 1.3, 12, '#ffe066');
      }
    }
  } else {
    boss.streamTimer -= dt;
    if (boss.streamTimer <= 0) {
      boss.streamTimer = phase === 2 ? 0.07 : 0.11;
      boss.angle += 0.5 + phase * 0.16;
      ctx.fire({
        x: boss.x,
        y: boss.y,
        angle: boss.angle,
        speed: speed * 0.85,
        damage: 10,
        color: '#ff9a4d',
        radius: 6,
      });
    }
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = rand(1.9, 2.4) * rate;
      const base = Math.PI / 2 + Math.sin(boss.t * 0.8) * 0.55;
      for (let i = 0; i < 5 + phase * 2; i += 1) {
        const t = (i - (5 + phase * 2 - 1) / 2) / 3;
        ctx.fire({ x: boss.x, y: boss.y + 30, angle: base + t * 0.3, speed: speed * 1.05, damage: 12, color: '#ffc46b', radius: 7 });
      }
    }
  }
}

export function updateBoss(boss, dt, ctx) {
  boss.t += dt;
  if (boss.entering) {
    boss.y += 130 * dt;
    if (boss.y >= boss.targetY) {
      boss.y = boss.targetY;
      boss.entering = false;
      boss.attackTimer = 1.1;
    }
    return true;
  }

  if (boss.dead) {
    boss.dying -= dt;
    boss.y -= 18 * dt;
    return boss.dying > 0;
  }

  boss.x = CONFIG.view.width / 2 + Math.sin(boss.t * 0.75) * 120;
  attack(boss, dt, ctx);
  return true;
}

export function nextBossSpeciesId(wave) {
  const index = Math.floor(wave / CONFIG.waves.bossEvery) - 1;
  return BOSS_ORDER[((index % BOSS_ORDER.length) + BOSS_ORDER.length) % BOSS_ORDER.length];
}
