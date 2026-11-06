import { CONFIG, clamp } from '../config.js';

const REF = { hp: 68.3, attack: 85.4, defense: 66.4, spAttack: 69.2, spDefense: 70.5, speed: 85.7, total: 445.5 };

const SPECIAL_TYPES = new Set(['electric', 'ice', 'fire', 'water', 'grass', 'psychic', 'poison', 'dragon', 'fairy', 'ghost']);

export function damageClassForSpecies(species) {
  return SPECIAL_TYPES.has(species?.types?.[0]) ? 'special' : 'physical';
}

export function damageClassForMove(move, fallback = 'special') {
  if (!move || !move.damageClass) return fallback;
  return move.damageClass === 'physical' ? 'physical' : 'special';
}

export function mitigation(defense) {
  return CONFIG.combat.defenseScale / (CONFIG.combat.defenseScale + Math.max(0, defense || 0));
}

export function hpFor(baseKey, species, growth = 1) {
  const base = CONFIG.combat.bases[baseKey];
  return (base.hp * species.stats.hp) / 255 * growth;
}

export function intervalFor(baseKey, species, growth = 1) {
  const base = CONFIG.combat.bases[baseKey];
  const speed = Math.max(1, species.stats.speed);
  return (base.intervalMs / 1000) * (255 / speed) * growth;
}

export function moveFor(baseKey, species) {
  const base = CONFIG.combat.bases[baseKey];
  return (base.move * species.stats.speed) / 255;
}

export function attackFor(baseKey, species, damageClass, powerFactor = 1, skillMult = 1, growth = 1) {
  const base = CONFIG.combat.bases[baseKey];
  const stat = damageClass === 'physical' ? species.stats.attack : species.stats.spAttack;
  return (base.attack * stat) / 255 * powerFactor * skillMult * growth;
}

export function bulletSpeedFactor(species) {
  const ratio = species.stats.speed / REF.speed;
  return clamp(1 + 0.3 * (ratio - 1), 0.9, 1.12);
}

export function rewardFactor(species) {
  const total = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'].reduce(
    (sum, key) => sum + species.stats[key],
    0,
  );
  return clamp(total / REF.total, CONFIG.enemyTuning.rewardFactor.min, CONFIG.enemyTuning.rewardFactor.max);
}
