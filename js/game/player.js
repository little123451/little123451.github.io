import { CONFIG, clamp, lerp } from '../config.js';
import { deriveStats } from '../data/pokedex.js';
import { DEFAULT_SKILL, SKILLS, skillLevelData } from '../data/skills.js';
import { firePattern } from './outputPatterns.js';
import { intervalFactor } from '../data/moveFormulas.js';

export function createPlayer(species) {
  const stats = deriveStats(species);
  const start = CONFIG.player.startPos;
  const player = {
    species,
    stats,
    x: start.x,
    y: start.y,
    vx: 0,
    tilt: 0,
    level: CONFIG.player.startLevel,
    exp: 0,
    maxHp: stats.maxHp,
    hp: stats.maxHp,
    skillId: DEFAULT_SKILL,
    skillLevel: 1,
    skillData: skillLevelData(DEFAULT_SKILL, 1),
    overloadCount: 0,
    statBoostCount: 0,
    buffs: { damage: 1, fireRate: 1, skillDamage: 0, skillInterval: 1 },
    skillType: SKILLS[DEFAULT_SKILL].type,
    skillName: SKILLS[DEFAULT_SKILL].name,
    cooldown: 0,
    invulnUntil: 0,
    radius: stats.radius,
    dead: false,
  };
  return player;
}

export function updatePlayer(player, dt, input, now) {
  const keys = input.axis();
  const pointer = input.pointerTarget();
  const focus = input.isFocusing() ? 0.5 : 1;
  const speed = player.stats.moveSpeed * focus;
  const prevX = player.x;
  const prevY = player.y;

  if (keys.x || keys.y) {
    const len = Math.hypot(keys.x, keys.y) || 1;
    player.x += (keys.x / len) * speed * dt;
    player.y += (keys.y / len) * speed * dt;
  } else if (pointer.active) {
    const targetY = pointer.y - (pointer.down && pointer.type !== 'mouse' ? 60 : 0);
    const dx = pointer.x - player.x;
    const dy = targetY - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 1.5) {
      const step = Math.min(distance, speed * dt);
      player.x += (dx / distance) * step;
      player.y += (dy / distance) * step;
    }
  }

  player.x = clamp(player.x, 26, CONFIG.view.width - 26);
  player.y = clamp(player.y, 70, CONFIG.view.height - 40);

  const dx = player.x - prevX;
  const dy = player.y - prevY;
  player.vx = dx / Math.max(dt, 0.0001);
  const targetTilt = clamp(player.vx * 0.0009, -0.22, 0.22);
  player.tilt = lerp(player.tilt, targetTilt, Math.min(1, dt * 10));

  player.hp = Math.min(player.maxHp, player.hp + player.stats.regenPerSec * dt);
  player.skillData = skillLevelData(player.skillId, player.skillLevel);

  return { dx, dy };
}

export function addExp(player, amount) {
  if (player.level >= CONFIG.player.levelCap || player.dead) return 0;
  player.exp += amount;
  let levelUps = 0;
  while (player.level < CONFIG.player.levelCap && player.exp >= CONFIG.exp.toNext(player.level)) {
    player.exp -= CONFIG.exp.toNext(player.level);
    player.level += 1;
    levelUps += 1;
  }
  if (player.level >= CONFIG.player.levelCap) player.exp = 0;
  if (levelUps > 0) {
    player.maxHp = player.stats.maxHp * (1 + CONFIG.player.levelGrowth * (player.level - 1));
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * CONFIG.player.levelHealPct);
  }
  return levelUps;
}

export function hurtPlayer(player, amount, now) {
  if (now < player.invulnUntil || player.dead) return false;
  player.hp -= amount;
  player.invulnUntil = now + CONFIG.player.invulnMs;
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
  }
  return true;
}

export function firePlayerBullets(player, spawn) {
  const skill = player.skillData;
  firePattern(SKILLS[player.skillId]?.pattern || 'volley', player, spawn);
  player.cooldown =
    player.stats.fireRateMs *
    intervalFactor(player.skillId) *
    skill.fireRateMult *
    player.buffs.fireRate *
    player.buffs.skillInterval;
}
