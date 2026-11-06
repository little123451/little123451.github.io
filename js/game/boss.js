import { CONFIG } from '../config.js';
import { rand, TAU } from '../core/utils.js';
import { attackFor, bulletSpeedFactor, hpFor, intervalFor, rewardFactor } from '../data/combatFormulas.js';

export const BOSS_ORDER = [144, 145, 146];

export function createBoss(species, wave) {
  const damageClass = 'special';
  const hp = hpFor('boss', species, 1 + CONFIG.combat.growth.bossWave * wave);
  const intervalMul = CONFIG.boss.intervalMul[species.id] || 1;
  return {
    species,
    tier: 'boss',
    damageClass,
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
    damageBase: attackFor('boss', species, damageClass),
    intervalBase: intervalFor('boss', species) * intervalMul,
    bulletMul: bulletSpeedFactor(species),
    scoreValue: Math.round(CONFIG.score.boss * rewardFactor(species)),
    expValue: Math.round(CONFIG.exp.yields.boss * rewardFactor(species)),
    damage: CONFIG.boss.contactDamage,
  };
}

function fireSpread(ctx, boss, count, spread, speed, damage, color, offset = 0) {
  boss.firedAt = ctx.clock;
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
      damageClass: boss.damageClass,
    });
  }
}

function fireRing(ctx, boss, count, offset, speed, damage, color) {
  boss.firedAt = ctx.clock;
  for (let i = 0; i < count; i += 1) {
    ctx.fire({
      x: boss.x,
      y: boss.y,
      angle: offset + (i / count) * TAU,
      speed,
      damage,
      color,
      radius: 6,
      damageClass: boss.damageClass,
    });
  }
}

function attack(boss, dt, ctx) {
  const baseSpeed = Math.min(CONFIG.enemy.bullets.speedCap, 150 + ctx.wave * 6);
  const speed = Math.min(CONFIG.enemy.bullets.speedCap, baseSpeed * boss.bulletMul);
  const dmg = boss.damageBase;
  const phase = boss.hp / boss.maxHp < 0.3 ? 2 : boss.hp / boss.maxHp < 0.6 ? 1 : 0;
  const rate = phase === 2 ? 0.68 : phase === 1 ? 0.84 : 1;
  const nextAttack = () => boss.intervalBase * rand(0.95, 1.05) * rate;

  if (boss.species.id === 144) {
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = nextAttack();
      if (Math.random() < 0.5) {
        const base = Math.PI / 2;
        boss.firedAt = ctx.clock;
        for (let i = 0; i < 7 + phase * 2; i += 1) {
          const t = (i - (7 + phase * 2 - 1) / 2) / 3;
          ctx.fire({ x: boss.x, y: boss.y + 30, angle: base + t * 0.42, speed, damage: dmg, color: '#8fe6ff', radius: 7, damageClass: boss.damageClass });
        }
      } else {
        fireSpread(ctx, boss, 3 + phase, 0.22, speed * 1.1, dmg, '#8fe6ff');
      }
      if (phase === 2) fireRing(ctx, boss, 10, boss.t, speed * 0.8, dmg * 0.92, '#bff4ff');
    }
  } else if (boss.species.id === 145) {
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = nextAttack();
      if (Math.random() < 0.55) {
        fireRing(ctx, boss, 14 + phase * 4, boss.t * 0.9, speed * 0.85, dmg * 0.92, '#ffe066');
      } else {
        fireSpread(ctx, boss, 3 + phase, 0.3, speed * 1.3, dmg, '#ffe066');
      }
    }
  } else {
    boss.streamTimer -= dt;
    if (boss.streamTimer <= 0) {
      boss.streamTimer = phase === 2 ? 0.07 : 0.11;
      boss.angle += 0.5 + phase * 0.16;
      boss.firedAt = ctx.clock;
      ctx.fire({
        x: boss.x,
        y: boss.y,
        angle: boss.angle,
        speed: speed * 0.85,
        damage: dmg * 0.85,
        color: '#ff9a4d',
        radius: 6,
        damageClass: boss.damageClass,
      });
    }
    boss.attackTimer -= dt;
    if (boss.attackTimer <= 0) {
      boss.attackTimer = nextAttack();
      const base = Math.PI / 2 + Math.sin(boss.t * 0.8) * 0.55;
      boss.firedAt = ctx.clock;
      for (let i = 0; i < 5 + phase * 2; i += 1) {
        const t = (i - (5 + phase * 2 - 1) / 2) / 3;
        ctx.fire({ x: boss.x, y: boss.y + 30, angle: base + t * 0.3, speed: speed * 1.05, damage: dmg, color: '#ffc46b', radius: 7, damageClass: boss.damageClass });
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
