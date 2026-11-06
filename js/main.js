import { CONFIG } from './config.js';
import { loadPokedex, deriveStats, getSpecies } from './data/pokedex.js';
import { DEFAULT_MECH } from './data/roster.js';
import { loadImages } from './core/assets.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { createLoop } from './core/loop.js';
import { readAll } from './core/telemetry.js';
import { Game } from './game/game.js';

const TYPE_ZH = {
  normal: '一般',
  fire: '火',
  water: '水',
  electric: '电',
  grass: '草',
  ice: '冰',
  fighting: '格斗',
  poison: '毒',
  ground: '地面',
  flying: '飞行',
  psychic: '超能力',
  bug: '虫',
  rock: '岩石',
  ghost: '幽灵',
  dragon: '龙',
  dark: '恶',
  steel: '钢',
  fairy: '妖精',
};

const els = {
  canvas: document.getElementById('game'),
  loading: document.getElementById('loading'),
  loadBar: document.getElementById('load-bar'),
  loadText: document.getElementById('load-text'),
  title: document.getElementById('title'),
  pause: document.getElementById('pause'),
  gameover: document.getElementById('gameover'),
  startBtn: document.getElementById('start-btn'),
  resumeBtn: document.getElementById('resume-btn'),
  quitBtn: document.getElementById('quit-btn'),
  againBtn: document.getElementById('again-btn'),
  muteBtn: document.getElementById('mute-btn'),
  mechSprite: document.getElementById('mech-sprite'),
  mechName: document.getElementById('mech-name'),
  mechTypes: document.getElementById('mech-types'),
  mechStats: document.getElementById('mech-stats'),
  resScore: document.getElementById('res-score'),
  resBest: document.getElementById('res-best'),
  resWave: document.getElementById('res-wave'),
  resLevel: document.getElementById('res-level'),
  resSkill: document.getElementById('res-skill'),
};

const ctx = els.canvas.getContext('2d', { alpha: false });
let pokedex = [];
let images = new Map();
let game = null;
let loop = null;
let paused = false;
let booted = false;

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  els.canvas.width = Math.round(CONFIG.view.width * dpr);
  els.canvas.height = Math.round(CONFIG.view.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function showOnly(el) {
  [els.loading, els.title, els.pause, els.gameover].forEach((item) => {
    if (item === el) show(item);
    else hide(item);
  });
}

function updateMuteLabel() {
  els.muteBtn.textContent = Audio.muted ? '音效 关' : '音效 开';
}

function setMuted(muted) {
  if (muted !== Audio.muted) Audio.toggleMute();
  updateMuteLabel();
}

function fillMechCard(species) {
  const stats = deriveStats(species);
  els.mechSprite.src = species.sprite;
  els.mechSprite.alt = species.nameZh;
  els.mechName.textContent = species.nameZh;
  els.mechTypes.textContent = species.types.map((t) => TYPE_ZH[t] || t).join(' · ');
  els.mechStats.innerHTML = [
    ['生命', Math.round(stats.maxHp)],
    ['攻击', Math.round(stats.baseDamage * 10) / 10],
    ['防御', species.stats.defense],
    ['速度', Math.round(stats.moveSpeed)],
  ]
    .map(([label, value]) => `<li>${label} <b>${value}</b></li>`)
    .join('');
}

function startRun() {
  if (!booted) return;
  if (game.state === 'playing' || game.state === 'dying') return;
  Audio.init();
  paused = false;
  showOnly(null);
  game.reset(true);
  if (!loop.running) loop.start();
}

function togglePause() {
  if (game.state !== 'playing') return;
  paused = !paused;
  if (paused) show(els.pause);
  else hide(els.pause);
}

function quitToTitle() {
  if (game.state === 'playing') game.endRunAborted();
  paused = false;
  game.state = 'over';
  loop.stop();
  showOnly(els.title);
}

async function boot() {
  fitCanvas();
  window.addEventListener('resize', fitCanvas);

  try {
    pokedex = await loadPokedex();
  } catch (err) {
    els.loadText.textContent = '图鉴加载失败，请刷新重试';
    console.error(err);
    return;
  }

  const entries = pokedex.map((species) => ({ key: species.id, src: species.sprite }));
  try {
    images = await loadImages(entries, (ratio) => {
      els.loadBar.style.width = `${Math.round(ratio * 100)}%`;
      els.loadText.textContent = `${Math.round(ratio * 100)}%`;
    });
  } catch (err) {
    els.loadText.textContent = '素材加载失败，请刷新重试';
    console.error(err);
    return;
  }

  Audio.preloadCries(pokedex.map((species) => ({ id: species.id, src: species.cry })));
  Audio.init();
  updateMuteLabel();

  const input = new Input(els.canvas, CONFIG.view);
  game = new Game({
    ctx,
    pokedex,
    images,
    input,
    audio: Audio,
    mechId: DEFAULT_MECH,
    onGameOver: (result) => {
      els.resScore.textContent = String(result.score);
      els.resBest.textContent = String(result.best);
      els.resWave.textContent = String(result.wave);
      els.resLevel.textContent = String(result.level);
      els.resSkill.textContent = `Lv.${result.skillLevel}`;
      showOnly(els.gameover);
    },
  });

  fillMechCard(getSpecies(DEFAULT_MECH));

  loop = createLoop(
    (dt) => {
      if (!paused) game.update(dt);
    },
    () => game.render(),
  );

  input.onStart = startRun;
  input.onPause = togglePause;
  input.onMute = () => {
    Audio.toggleMute();
    updateMuteLabel();
  };

  els.startBtn.addEventListener('click', startRun);
  els.againBtn.addEventListener('click', startRun);
  els.resumeBtn.addEventListener('click', togglePause);
  els.quitBtn.addEventListener('click', quitToTitle);
  els.muteBtn.addEventListener('click', () => {
    Audio.init();
    Audio.toggleMute();
    updateMuteLabel();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing' && !paused) togglePause();
  });
  window.addEventListener('pagehide', () => {
    if (game.state === 'playing') game.endRunAborted();
  });

  window.__flyingShmup = {
    stats: () => readAll(),
    game: () => game,
  };

  booted = true;
  showOnly(els.title);
}

boot();
