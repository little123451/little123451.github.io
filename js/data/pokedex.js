import { CONFIG, clamp } from '../config.js';
import { getEffectiveness } from './typeChart.js';

let byId = new Map();
let all = [];

export async function loadPokedex() {
  const res = await fetch('data/pokemon.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error(`pokedex ${res.status}`);
  all = await res.json();
  byId = new Map(all.map((entry) => [entry.id, entry]));
  return all;
}

export function getSpecies(id) {
  return byId.get(Number(id));
}

export function speciesList() {
  return all;
}

export function deriveStats(entry) {
  const p = CONFIG.player;
  return {
    maxHp: p.maxHpBase + entry.stats.hp * p.hpPerStat,
    baseDamage: p.damageBase + entry.stats.attack * p.damagePerAttack,
    fireRateMs: clamp(p.fireRateBase - entry.stats.speed * p.fireRatePerSpeed, p.fireRateMin, p.fireRateBase),
    moveSpeed: p.moveSpeedBase + entry.stats.speed * p.moveSpeedPerSpeed,
    regenPerSec: p.regenBase + entry.stats.defense * p.regenPerDef + entry.stats.spDefense * p.regenPerSpDef,
    radius: p.radius,
  };
}

export function levelMultiplier(level) {
  return 1 + CONFIG.player.levelGrowth * (level - 1);
}

export function computeDamage(player, defenderTypes) {
  const stats = player.stats;
  const skill = player.skillData;
  const typeMult = getEffectiveness(player.skillType, defenderTypes, CONFIG.flags.typeChart);
  return stats.baseDamage * skill.damageMult * levelMultiplier(player.level) * typeMult;
}
