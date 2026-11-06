export const ITEMS = {
  skill_up: {
    id: 'skill_up',
    name: '技能强化',
    desc: '当前技能等级 +1',
    maxLevel: 5,
    apply(player) {
      if (player.skillLevel >= this.maxLevel) return false;
      player.skillLevel += 1;
      return true;
    },
  },
};

export const DROP_TABLE = {
  83: { item: 'skill_up', chance: 0.25 },
  22: { item: 'skill_up', chance: 0.15 },
  85: { item: 'skill_up', chance: 0.15 },
  142: { item: 'skill_up', chance: 0.3 },
  130: { item: 'skill_up', chance: 0.3 },
  149: { item: 'skill_up', chance: 0.35 },
  17: { item: 'skill_up', chance: 0.2 },
  42: { item: 'skill_up', chance: 0.2 },
  84: { item: 'skill_up', chance: 0.2 },
};

export function rollDrop(speciesId, isBoss) {
  if (isBoss) return 'skill_up';
  const entry = DROP_TABLE[speciesId];
  if (!entry) return null;
  return Math.random() < entry.chance ? entry.item : null;
}
