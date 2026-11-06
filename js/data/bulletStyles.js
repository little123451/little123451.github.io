export const TYPE_STYLES = {
  normal: { color: '#a8a878', glow: 'rgba(200,200,160,0.55)', shape: 'pellet', size: 1, spin: 0, trail: 0.6 },
  flying: { color: '#bfe3ff', glow: 'rgba(155,210,255,0.75)', shape: 'wind', size: 1.2, spin: 5, trail: 1 },
  fire: { color: '#f08030', glow: 'rgba(255,120,40,0.65)', shape: 'flame', size: 1.1, spin: 0, trail: 1 },
  water: { color: '#4b9bff', glow: 'rgba(75,155,255,0.6)', shape: 'drop', size: 1.05, spin: 0, trail: 0.5 },
  grass: { color: '#5fcb6a', glow: 'rgba(95,203,106,0.6)', shape: 'leaf', size: 1.1, spin: 7, trail: 0.6 },
  electric: { color: '#ffd33d', glow: 'rgba(255,211,61,0.7)', shape: 'bolt', size: 1.2, spin: 0, trail: 0.4 },
  ice: { color: '#7fe0e0', glow: 'rgba(127,224,224,0.6)', shape: 'crystal', size: 1.1, spin: 2, trail: 0.6 },
  fighting: { color: '#e0533d', glow: 'rgba(224,83,61,0.6)', shape: 'shock', size: 1.15, spin: 0, trail: 0 },
  poison: { color: '#a040a0', glow: 'rgba(160,64,160,0.6)', shape: 'bubble', size: 1.05, spin: 1.5, trail: 0.3 },
  ground: { color: '#d6b25c', glow: 'rgba(214,178,92,0.55)', shape: 'rock', size: 1.2, spin: 4, trail: 0.5 },
  rock: { color: '#bfa96b', glow: 'rgba(191,169,107,0.55)', shape: 'rock', size: 1.25, spin: 3, trail: 0.5 },
  bug: { color: '#a3c43d', glow: 'rgba(163,196,61,0.6)', shape: 'sting', size: 1.1, spin: 0, trail: 0.6 },
  psychic: { color: '#ff5f9e', glow: 'rgba(255,95,158,0.6)', shape: 'pulse', size: 1.2, spin: 0, trail: 0.2 },
  ghost: { color: '#7a6bc4', glow: 'rgba(122,107,196,0.6)', shape: 'wisp', size: 1.1, spin: 1.2, trail: 0.4 },
  dragon: { color: '#6b58ff', glow: 'rgba(107,88,255,0.65)', shape: 'flame', size: 1.2, spin: 0, trail: 0.9 },
  dark: { color: '#6b5c52', glow: 'rgba(120,60,110,0.55)', shape: 'wisp', size: 1.15, spin: 0.8, trail: 0.5 },
  steel: { color: '#a8b8c4', glow: 'rgba(200,220,235,0.55)', shape: 'blade', size: 1.15, spin: 0, trail: 0.7 },
  fairy: { color: '#ff9ed8', glow: 'rgba(255,158,216,0.6)', shape: 'sparkle', size: 1.15, spin: 2.5, trail: 0.4 },
};

export function styleForType(type) {
  return TYPE_STYLES[type] || TYPE_STYLES.normal;
}
