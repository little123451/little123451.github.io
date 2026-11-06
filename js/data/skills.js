export const SKILLS = {
  gust: {
    id: 'gust',
    name: '起风',
    type: 'flying',
    maxLevel: 5,
    levels: [
      { shots: 1, damageMult: 1.0, spreadDeg: 0, pierce: 0, fireRateMult: 1.0 },
      { shots: 2, damageMult: 0.95, spreadDeg: 0, pierce: 0, fireRateMult: 1.0 },
      { shots: 2, damageMult: 1.15, spreadDeg: 0, pierce: 0, fireRateMult: 0.92 },
      { shots: 3, damageMult: 0.9, spreadDeg: 10, pierce: 0, fireRateMult: 0.92 },
      { shots: 3, damageMult: 1.0, spreadDeg: 12, pierce: 1, fireRateMult: 0.92 },
    ],
  },
};

export const DEFAULT_SKILL = 'gust';

export function skillLevelData(skillId, level) {
  const skill = SKILLS[skillId];
  const idx = Math.min(Math.max(level, 1), skill.maxLevel) - 1;
  return skill.levels[idx];
}
