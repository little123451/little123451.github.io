import { CONFIG } from '../config.js';
import { rand } from '../core/utils.js';
import { nextBossSpeciesId } from './boss.js';

export function createWaves() {
  return {
    wave: 1,
    elapsed: 0,
    spawnTimer: 0.8,
    bossState: 'none',
    warning: 0,
    bossId: null,
  };
}

export function isBossWave(wave) {
  return wave % CONFIG.waves.bossEvery === 0;
}

export function updateWaves(state, dt, api) {
  if (state.bossState === 'warning') {
    state.warning -= dt;
    if (state.warning <= 0) {
      state.bossState = 'active';
      state.bossId = nextBossSpeciesId(state.wave);
      api.spawnBoss(state.bossId);
    }
    return;
  }

  if (state.bossState === 'active') return;

  if (isBossWave(state.wave)) {
    state.bossState = 'warning';
    state.warning = CONFIG.waves.bossWarningMs / 1000;
    api.onBossWarning?.(state.wave);
    return;
  }

  state.elapsed += dt;
  state.spawnTimer -= dt;

  const interval = Math.max(CONFIG.formations.intervalMin, CONFIG.formations.intervalBase - state.wave * CONFIG.formations.intervalPerWave);
  if (state.spawnTimer <= 0) {
    state.spawnTimer = interval * rand(0.85, 1.15);
    api.spawnSquad(state.wave);
  }

  if (state.elapsed >= CONFIG.waves.durationMs / 1000) {
    state.wave += 1;
    state.elapsed = 0;
    state.spawnTimer = 0.5;
  }
}

export function notifyBossDefeated(state) {
  if (state.bossState !== 'active') return;
  state.bossState = 'none';
  state.bossId = null;
  state.wave += 1;
  state.elapsed = 0;
  state.spawnTimer = 0.8;
}
