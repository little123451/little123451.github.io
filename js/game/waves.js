import { CONFIG, clamp } from '../config.js';
import { pick, rand } from '../core/utils.js';
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

  const interval = Math.max(0.32, 0.95 - state.wave * 0.035);
  if (state.spawnTimer <= 0 && api.alive < CONFIG.enemy.maxAlive) {
    state.spawnTimer = interval * rand(0.8, 1.2);
    const batch = clamp(1 + Math.floor(state.wave / 5), 1, 3);
    for (let i = 0; i < batch; i += 1) {
      const eliteWeight = clamp(10 + state.wave * 5, 10, 65);
      const tier = Math.random() * 100 < eliteWeight ? 'elite' : 'common';
      const behavior =
        tier === 'elite'
          ? pick(['hover', 'dive', 'sine'])
          : pick(['straight', 'sine', 'dive']);
      api.spawnEnemy({ tier, behavior, wave: state.wave });
    }
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
