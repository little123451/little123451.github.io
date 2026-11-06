import { CONFIG } from '../config.js';

let ctx = null;
let master = null;
let muted = false;
const cries = new Map();

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

function tone(freq, endFreq, duration, type = 'square', volume = 0.05, delay = 0) {
  const audio = ensureContext();
  if (!audio || muted) return;
  const now = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function noise(duration = 0.25, volume = 0.14, cutoff = 1200) {
  const audio = ensureContext();
  if (!audio || muted) return;
  const rate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.floor(rate * duration), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, audio.currentTime);
  filter.frequency.exponentialRampToValueAtTime(120, audio.currentTime + duration);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start();
}

export const Audio = {
  init() {
    const audio = ensureContext();
    if (audio?.state === 'suspended') audio.resume();
    try {
      muted = localStorage.getItem(CONFIG.storage.muteKey) === '1';
    } catch {
      muted = false;
    }
  },
  preloadCries(entries) {
    for (const { id, src } of entries) {
      const audio = new window.Audio(src);
      audio.preload = 'auto';
      audio.volume = 0.35;
      cries.set(id, audio);
    }
  },
  cry(id) {
    if (muted) return;
    const audio = cries.get(id);
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      /* ignore */
    }
  },
  shoot() {
    tone(760, 520, 0.06, 'square', 0.018);
  },
  hit() {
    tone(320, 180, 0.05, 'triangle', 0.03);
  },
  explode() {
    noise(0.22, 0.12, 1400);
  },
  pickup() {
    tone(660, 990, 0.12, 'sine', 0.06);
    tone(990, 1320, 0.1, 'sine', 0.04, 0.07);
  },
  levelUp() {
    [523, 659, 784, 1046].forEach((freq, i) => tone(freq, freq, 0.14, 'square', 0.045, i * 0.07));
  },
  boss() {
    tone(140, 60, 0.7, 'sawtooth', 0.07);
    tone(70, 40, 0.8, 'triangle', 0.06, 0.1);
  },
  gameOver() {
    [440, 349, 262, 196].forEach((freq, i) => tone(freq, freq * 0.9, 0.22, 'triangle', 0.05, i * 0.12));
  },
  get muted() {
    return muted;
  },
  toggleMute() {
    muted = !muted;
    try {
      localStorage.setItem(CONFIG.storage.muteKey, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return muted;
  },
};
