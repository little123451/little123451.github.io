export const TAU = Math.PI * 2;

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function circleHit(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
}

export function closestOnCircle(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, radius / d);
  return { x: cx + dx * k, y: cy + dy * k };
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function weightedPick(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}
