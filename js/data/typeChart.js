const CHART = {
  flying: { fighting: 2, bug: 2, grass: 2, rock: 0.5, electric: 0.5, steel: 0.5 },
  electric: { flying: 2, water: 2, grass: 0.5, electric: 0.5, dragon: 0.5, ground: 0 },
  ice: { flying: 2, grass: 2, ground: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
  rock: { flying: 2, bug: 2, fire: 2, ice: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ground: { flying: 0, electric: 2, fire: 2, poison: 2, rock: 2, bug: 0.5, grass: 0.5 },
  water: { fire: 2, ground: 2, rock: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
};

export function getEffectiveness(attackType, defenderTypes, enabled = false) {
  if (!enabled) return 1;
  const row = CHART[attackType];
  if (!row) return 1;
  return defenderTypes.reduce((mult, type) => mult * (row[type] ?? 1), 1);
}
