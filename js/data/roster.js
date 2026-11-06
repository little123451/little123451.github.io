export const ROSTER = [
  { id: 6, unlocked: false },
  { id: 12, unlocked: false },
  { id: 16, unlocked: true },
  { id: 17, unlocked: false },
  { id: 18, unlocked: false },
  { id: 21, unlocked: false },
  { id: 22, unlocked: false },
  { id: 41, unlocked: false },
  { id: 42, unlocked: false },
  { id: 83, unlocked: false },
  { id: 84, unlocked: false },
  { id: 85, unlocked: false },
  { id: 123, unlocked: false },
  { id: 130, unlocked: false },
  { id: 142, unlocked: false },
  { id: 144, unlocked: false },
  { id: 145, unlocked: false },
  { id: 146, unlocked: false },
  { id: 149, unlocked: false },
];

export const DEFAULT_MECH = 16;

export function unlockedMechs() {
  return ROSTER.filter((entry) => entry.unlocked).map((entry) => entry.id);
}
