import { CONFIG } from '../config.js';

function readStats() {
  try {
    const raw = localStorage.getItem(CONFIG.storage.statsKey);
    if (!raw) return { version: 1, totals: emptyTotals(), runs: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return { version: 1, totals: emptyTotals(), runs: [] };
    return parsed;
  } catch {
    return { version: 1, totals: emptyTotals(), runs: [] };
  }
}

function emptyTotals() {
  return {
    runs: 0,
    durationMs: 0,
    distancePx: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    score: 0,
    pickups: 0,
  };
}

function writeStats(store) {
  try {
    localStorage.setItem(CONFIG.storage.statsKey, JSON.stringify(store));
  } catch {
    /* quota or privacy mode: ignore */
  }
}

export function newRun(mechId) {
  return {
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    mechId,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    wave: 1,
    level: 1,
    score: 0,
    distancePx: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: { total: 0, bySpecies: {} },
    pickups: {},
    aborted: false,
  };
}

export function addDistance(run, dx, dy) {
  if (!run) return;
  run.distancePx += Math.hypot(dx, dy);
}

export function addDamage(run, amount) {
  if (!run) return;
  run.damageDealt += amount;
}

export function addTaken(run, amount) {
  if (!run) return;
  run.damageTaken += amount;
}

export function addKill(run, speciesId) {
  if (!run) return;
  run.kills.total += 1;
  run.kills.bySpecies[speciesId] = (run.kills.bySpecies[speciesId] || 0) + 1;
}

export function addPickup(run, itemId) {
  if (!run) return;
  run.pickups[itemId] = (run.pickups[itemId] || 0) + 1;
}

export function endRun(run, { score, wave, level, durationMs, aborted = false }) {
  if (!run) return null;
  run.score = score;
  run.wave = wave;
  run.level = level;
  run.durationMs = durationMs;
  run.aborted = aborted;
  run.endedAt = new Date().toISOString();

  const store = readStats();
  store.runs.unshift(run);
  if (store.runs.length > CONFIG.storage.maxRuns) store.runs.length = CONFIG.storage.maxRuns;

  const totals = store.totals;
  totals.runs += 1;
  totals.durationMs += run.durationMs;
  totals.distancePx += run.distancePx;
  totals.damageDealt += run.damageDealt;
  totals.damageTaken += run.damageTaken;
  totals.kills += run.kills.total;
  totals.score += run.score;
  totals.pickups += Object.values(run.pickups).reduce((a, b) => a + b, 0);

  writeStats(store);
  return store;
}

export function readAll() {
  return readStats();
}
