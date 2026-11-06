export const SKILLS = {
  gust: {
    id: 'gust',
    name: '起风',
    type: 'flying',
    pattern: 'volley',
    route: 'scatter',
    routeName: '散射',
    move: 'gust',
    maxLevel: 5,
    levels: [
      { shots: 1, damageMult: 1.0, spreadDeg: 0, pierce: 0, fireRateMult: 1.0 },
      { shots: 2, damageMult: 1.0, spreadDeg: 0, pierce: 0, fireRateMult: 1.0 },
      { shots: 3, damageMult: 1.0, spreadDeg: 0, pierce: 0, fireRateMult: 0.92 },
      { shots: 4, damageMult: 1.0, spreadDeg: 10, pierce: 0, fireRateMult: 0.92 },
      { shots: 5, damageMult: 0.95, spreadDeg: 12, pierce: 1, fireRateMult: 0.92 },
    ],
  },
};

export const DEFAULT_SKILL = 'gust';

let MOVE_DATA = {};

export function setMoveData(map) {
  MOVE_DATA = map || {};
}

export function getMoveForSkill(skillId) {
  const skill = SKILLS[skillId];
  if (!skill || !skill.move) return null;
  return MOVE_DATA[skill.move] || null;
}

export function skillLevelData(skillId, level) {
  const skill = SKILLS[skillId];
  const idx = Math.min(Math.max(level, 1), skill.maxLevel) - 1;
  return skill.levels[idx];
}
