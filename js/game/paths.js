import { CONFIG, clamp } from '../config.js';
import { moveFor } from '../data/combatFormulas.js';

const SEGMENT_SAMPLES = 16;

const BUILDERS = {
  topDive: ({ dx, w }) => [
    [w / 2 + dx, -70],
    [w / 2 + dx * 1.25, 120],
    [w / 2 + dx * 0.55, 260],
    [w / 2 + dx * 1.2, 420],
    [w / 2 + dx * 1.7, 900],
  ],
  leftArc: ({ dx, w }) => [
    [-80, 100 + dx * 0.5],
    [w * 0.18, 150 + dx * 0.5],
    [w * 0.55, 240 + dx * 0.8],
    [w + 90, 340 + dx],
  ],
  rightArc: ({ dx, w }) => [
    [w + 80, 100 + dx * 0.5],
    [w * 0.82, 150 + dx * 0.5],
    [w * 0.45, 240 + dx * 0.8],
    [-90, 340 + dx],
  ],
  column: ({ dx, w }) => [
    [w / 2 + dx, -80],
    [w / 2 + dx, 170],
    [w / 2 + dx * 1.6, 300],
    [w / 2 + dx * 1.6, 880],
  ],
  figure8: ({ dx, w }) => [
    [w / 2 + dx, -70],
    [w / 2 + dx + 90, 150],
    [w / 2 + dx, 40],
    [w / 2 + dx - 90, 190],
    [w / 2 + dx, 320],
    [w / 2 + dx + 70, 470],
    [w / 2 + dx, 900],
  ],
  divePlayer: ({ dx, w, playerX, playerY }) => [
    [w / 2 + dx, -70],
    [w / 2 + dx * 2, 130],
    [playerX + dx * 0.4, clamp(playerY - 180, 160, 560)],
    [playerX + dx, clamp(playerY - 40, 250, 660)],
    [clamp(playerX + dx * 1.6, 60, w - 60), 900],
  ],
  pincerLeft: ({ dx, w }) => [
    [-80, 80 + dx * 0.4],
    [w * 0.2, 130],
    [w * 0.5, 210 + dx * 0.5],
    [w * 0.5 + 40, 340],
    [w * 0.2, 520 + dx],
    [-80, 900],
  ],
  pincerRight: ({ dx, w }) => [
    [w + 80, 80 + dx * 0.4],
    [w * 0.8, 130],
    [w * 0.5, 210 + dx * 0.5],
    [w * 0.5 - 40, 340],
    [w * 0.8, 520 + dx],
    [w + 80, 900],
  ],
  spiral: ({ dx, w }) => {
    const cx = w / 2 + dx;
    const points = [[cx, -70]];
    for (let i = 0; i < 5; i += 1) {
      const angle = i * Math.PI * 0.62;
      const radius = 130 - i * 14;
      points.push([cx + Math.cos(angle) * radius, 110 + i * 55]);
    }
    points.push([cx, 900]);
    return points;
  },
};

export const PATH_KEYS = Object.keys(BUILDERS);

export const HOLD_PATHS = new Set(['column', 'figure8', 'spiral']);

function catmullRom(points, samples) {
  const out = [];
  const pts = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < pts.length - 2; i += 1) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    for (let s = 0; s < samples; s += 1) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function buildPath(key, options = {}) {
  const builder = BUILDERS[key] || BUILDERS.topDive;
  const w = CONFIG.view.width;
  const built = builder({ dx: options.dx || 0, w, playerX: options.playerX ?? w / 2, playerY: options.playerY ?? 600 });
  const raw = options.hold ? built.slice(0, -1) : built;
  const points = catmullRom(raw, SEGMENT_SAMPLES);
  const lengths = new Float32Array(points.length - 1);
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy);
    lengths[i] = len;
    total += len;
  }
  return { key, points, lengths, total };
}

export function samplePath(path, distance) {
  const d = clamp(distance, 0, path.total);
  let index = 0;
  let acc = 0;
  while (index < path.lengths.length - 1 && acc + path.lengths[index] < d) {
    acc += path.lengths[index];
    index += 1;
  }
  const segLen = path.lengths[index] || 1;
  const t = clamp((d - acc) / segLen, 0, 1);
  const a = path.points[index];
  const b = path.points[index + 1];
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
  };
}

export function pathSpeed(species) {
  const tier = species?.tier === 'elite' ? 'elite' : 'common';
  return moveFor(tier, species);
}
