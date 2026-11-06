import { getMoveForSkill } from './skills.js';

const FALLBACK_POWER = 40;
const FALLBACK_PP = 35;

function moveOf(skillId) {
  const move = getMoveForSkill(skillId);
  return {
    power: Number.isFinite(move?.power) ? move.power : FALLBACK_POWER,
    pp: Number.isFinite(move?.pp) && move.pp > 0 ? move.pp : FALLBACK_PP,
  };
}

export function damageFactor(skillId) {
  return moveOf(skillId).power / 150;
}

export function intervalFactor(skillId) {
  return FALLBACK_PP / moveOf(skillId).pp;
}
