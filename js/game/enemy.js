import { CONFIG, clamp } from '../config.js';
import { rand } from '../core/utils.js';
import {
  attackFor,
  bulletSpeedFactor,
  damageClassForSpecies,
  hpFor,
  intervalFor,
  rewardFactor,
} from '../data/combatFormulas.js';
import { pathSpeed, samplePath } from './paths.js';

export const TIER_SIZE = { common: 56, elite: 78 };

export function createEnemy(species, wave, options = {}) {
  const tier = species.tier === 'elite' ? 'elite' : 'common';
  const isElite = tier === 'elite';
  const tuning = CONFIG.enemyTuning;
  const damageClass = damageClassForSpecies(species);
  const hpGrowth = 1 + CONFIG.combat.growth.enemyWave * wave;
  const hp = hpFor(tier, species, hpGrowth);
  const reward = rewardFactor(species);
  const jitter = 1 + (Math.random() * 2 - 1) * CONFIG.combat.jitter.enemyInterval;
  const shotMs = intervalFor(tier, species) * jitter;
  const path = options.path;
  const start = path ? samplePath(path, 0) : { x: CONFIG.view.width / 2, y: -60, angle: Math.PI / 2 };

  return {
    species,
    tier,
    damageClass,
    path,
    pathDist: 0,
    speed: pathSpeed(species),
    moveAngle: start.angle,
    mode: 'path',
    hold: Boolean(options.hold),
    holdTimer: 0,
    holdDir: 1,
    holdMinX: start.x,
    holdMaxX: start.x,
    delay: options.delay || 0,
    x: start.x,
    y: start.y,
    baseX: start.x,
    hp,
    maxHp: hp,
    size: TIER_SIZE[tier],
    radius: TIER_SIZE[tier] * 0.32,
    t: 0,
    tilt: 0,
    shotTimer: isElite ? rand(0.6, 1.4) : rand(0.4, 0.9),
    shotMs,
    shots: isElite ? 3 : 1,
    bulletMul: bulletSpeedFactor(species),
    dead: false,
    hitAt: 0,
    scoreValue: Math.round((isElite ? CONFIG.score.elite : CONFIG.score.common) * reward),
    expValue: Math.round(CONFIG.exp.yields[tier] * reward),
    damage: attackFor(tier, species, damageClass),
    contactDamage: tuning.contactBase[tier],
  };
}

export function enemyBulletSpeed(wave) {
  const { speedBase, speedPerWave, speedCap } = CONFIG.enemy.bullets;
  return Math.min(speedBase + wave * speedPerWave, speedCap);
}

function aimAt(enemy, ctx, spread = 0) {
  return Math.atan2(ctx.playerY - enemy.y, ctx.playerX - enemy.x) + spread;
}

function updateMovement(enemy, dt) {
  if (enemy.mode === 'path' && enemy.path) {
    enemy.pathDist += enemy.speed * dt;
    const point = samplePath(enemy.path, enemy.pathDist);
    enemy.x = point.x;
    enemy.y = point.y;
    enemy.moveAngle = point.angle;
    if (enemy.pathDist >= enemy.path.total) {
      if (enemy.hold) {
        enemy.mode = 'hold';
        enemy.holdTimer = rand(CONFIG.paths.holdMin, CONFIG.paths.holdMax);
        enemy.baseX = clamp(enemy.x, 60, CONFIG.view.width - 60);
        enemy.holdDir = Math.random() < 0.5 ? -1 : 1;
        const holdRange = Math.max(CONFIG.paths.holdRangeMin, enemy.speed * CONFIG.paths.holdRangeFactor);
        enemy.holdMinX = Math.max(40, enemy.baseX - holdRange);
        enemy.holdMaxX = Math.min(CONFIG.view.width - 40, enemy.baseX + holdRange);
      } else {
        enemy.mode = 'fall';
      }
    }
  } else if (enemy.mode === 'hold') {
    enemy.holdTimer -= dt;
    enemy.x += enemy.holdDir * enemy.speed * dt;
    if (enemy.x <= enemy.holdMinX) {
      enemy.x = enemy.holdMinX;
      enemy.holdDir = 1;
    } else if (enemy.x >= enemy.holdMaxX) {
      enemy.x = enemy.holdMaxX;
      enemy.holdDir = -1;
    }
    if (enemy.holdTimer <= 0) enemy.mode = 'fall';
  } else if (enemy.mode === 'fall') {
    enemy.y += enemy.speed * dt;
  }
  const targetTilt = clamp((enemy.moveAngle - Math.PI / 2) * 0.32, -0.3, 0.3);
  enemy.tilt = targetTilt;
}

export function updateEnemy(enemy, dt, ctx) {
  enemy.t += dt;

  if (enemy.delay > 0) {
    enemy.delay -= dt;
    return true;
  }

  updateMovement(enemy, dt);

  const onScreen = enemy.x > -30 && enemy.x < CONFIG.view.width + 30;
  if (enemy.shotMs && ctx.canShoot && enemy.mode !== 'fall' && enemy.y > 20 && onScreen) {
    enemy.shotTimer -= dt;
    if (enemy.shotTimer <= 0) {
      enemy.shotTimer = enemy.shotMs * rand(0.85, 1.2);
      const speed = Math.min(CONFIG.enemy.bullets.speedCap, enemyBulletSpeed(ctx.wave) * enemy.bulletMul);
      const shots = enemy.shots;
      for (let i = 0; i < shots; i += 1) {
        const spread = shots === 1 ? 0 : (i - (shots - 1) / 2) * 0.16;
        enemy.firedAt = ctx.clock;
        ctx.fire({
          type: enemy.species.types[0],
          damageClass: enemy.damageClass,
          x: enemy.x,
          y: enemy.y + 16,
          angle: aimAt(enemy, ctx, spread),
          speed,
          damage: enemy.damage,
        });
      }
    }
  }

  if (enemy.y > CONFIG.enemy.despawnY) return false;
  if (enemy.x < -140 || enemy.x > CONFIG.view.width + 140) return false;
  return true;
}
