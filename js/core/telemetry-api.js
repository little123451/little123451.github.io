import { CONFIG } from '../config.js';
import { addDamage, addDistance, addKill, addPickup, addTaken, endRun, newRun } from './telemetry.js';

export const Telemetry = {
  start(mechId) {
    if (!CONFIG.flags.telemetry) return null;
    const run = newRun(mechId);
    run._t0 = performance.now();
    return run;
  },
  distance(run, dx, dy) {
    if (run) addDistance(run, dx, dy);
  },
  sample(run, { wave, level, score }) {
    if (!run) return;
    run.wave = wave;
    run.level = level;
    run.score = score;
  },
  damage(run, amount) {
    if (run) addDamage(run, amount);
  },
  taken(run, amount) {
    if (run) addTaken(run, amount);
  },
  kill(run, speciesId) {
    if (run) addKill(run, speciesId);
  },
  pickup(run, itemId) {
    if (run) addPickup(run, itemId);
  },
  end(run, { score, wave, level, aborted }) {
    if (!run) return null;
    const durationMs = Math.max(0, performance.now() - (run._t0 || performance.now()));
    delete run._t0;
    return endRun(run, { score, wave, level, durationMs, aborted });
  },
};
