import { CONFIG } from '../config.js';
import { hpFor, intervalFor, moveFor } from './combatFormulas.js';

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
    maxHp: hpFor('player', entry),
    fireRateMs: intervalFor('player', entry) * 1000,
    moveSpeed: moveFor('player', entry),
    regenPerSec: p.regenBase + entry.stats.defense * p.regenPerDef + entry.stats.spDefense * p.regenPerSpDef,
    attack: entry.stats.attack,
    spAttack: entry.stats.spAttack,
    defense: entry.stats.defense,
    spDefense: entry.stats.spDefense,
    radius: p.radius,
  };
}

export function levelMultiplier(level) {
  return 1 + CONFIG.player.levelGrowth * (level - 1);
}
