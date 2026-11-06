import { CONFIG, clamp } from '../config.js';
import { rand, TAU } from '../core/utils.js';
import { SCENES } from '../data/scenes.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTerrain(themeKey, theme, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rng = seeded(themeKey.length * 7919 + 13);

  ctx.fillStyle = theme.far;
  ctx.beginPath();
  ctx.moveTo(0, height);
  const peaks = 7;
  for (let i = 0; i <= peaks; i += 1) {
    const x = (i / peaks) * width;
    let y = height - 40 - rng() * 70;
    if (themeKey === 'ice') y = height - 60 - rng() * 120;
    if (themeKey === 'volcano') y = height - 30 - rng() * 50;
    ctx.lineTo(x, y);
    ctx.lineTo(x + width / peaks / 2, height - rng() * 20);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = theme.farEdge;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i <= peaks * 2; i += 1) {
    const x = (i / (peaks * 2)) * width;
    ctx.lineTo(x, height - 10 - rng() * 34);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  if (themeKey === 'volcano') {
    const glow = ctx.createLinearGradient(0, height - 120, 0, height);
    glow.addColorStop(0, 'rgba(255,120,40,0)');
    glow.addColorStop(1, 'rgba(255,120,40,0.35)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, height - 120, width, 120);
  }

  return canvas;
}

function createWeatherOverlay(type, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const rng = seeded(type.length * 3301 + 7);

  if (type === 'snow') {
    for (let i = 0; i < 90; i += 1) {
      ctx.globalAlpha = 0.25 + rng() * 0.6;
      ctx.fillStyle = '#eaf9ff';
      ctx.beginPath();
      ctx.arc(rng() * width, rng() * height, 0.8 + rng() * 1.6, 0, TAU);
      ctx.fill();
    }
  } else if (type === 'rain') {
    ctx.strokeStyle = 'rgba(170,200,255,0.5)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 110; i += 1) {
      const x = rng() * width;
      const y = rng() * height;
      const len = 9 + rng() * 10;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + len);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 70; i += 1) {
      ctx.globalAlpha = 0.2 + rng() * 0.45;
      ctx.fillStyle = rng() < 0.25 ? '#ffb066' : '#8a5a44';
      const r = 0.8 + rng() * 1.6;
      ctx.beginPath();
      ctx.arc(rng() * width, rng() * height, r, 0, TAU);
      ctx.fill();
    }
  }

  return canvas;
}

export class Scene {
  constructor(view) {
    this.view = view;
    this.theme = 'sky';
    this.target = 'sky';
    this.prevTheme = null;
    this.transition = 1;
    this.time = 0;
    this.backgrounds = new Map();
    this.weatherOverlays = new Map();
    this.flash = 0;
    this.lightningTimer = rand(3, 7);
    this.clouds = Array.from({ length: CONFIG.scene.cloudCount }, () => ({
      x: rand(0, view.width),
      y: rand(0, view.height),
      w: rand(70, 190),
      h: rand(16, 44),
      speed: rand(10, 30),
      layer: rand(0.6, 1.4),
    }));
    this.stars = Array.from({ length: CONFIG.scene.starCount }, () => ({
      x: rand(0, view.width),
      y: rand(0, view.height),
      r: rand(0.6, 1.8),
      speed: rand(12, 40),
      phase: rand(0, TAU),
    }));
  }

  getBackground(key) {
    let bg = this.backgrounds.get(key);
    if (bg) return bg;
    const theme = SCENES[key];
    const { width, height } = this.view;
    bg = document.createElement('canvas');
    bg.width = width;
    bg.height = height;
    const ctx = bg.getContext('2d');

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    if (theme.stars) {
      for (const star of this.stars) {
        ctx.globalAlpha = 0.45 + (star.phase / TAU) * 0.4;
        ctx.fillStyle = '#cfe6ff';
        ctx.fillRect(star.x, star.y, star.r, star.r * 2.2);
      }
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = 0.9;
    ctx.drawImage(createTerrain(key, theme, width, 320), 0, height - 300);
    ctx.globalAlpha = 1;

    const fog = ctx.createLinearGradient(0, height - 240, 0, height);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, theme.fog);
    ctx.fillStyle = fog;
    ctx.fillRect(0, height - 240, width, 240);

    const vignette = ctx.createRadialGradient(width / 2, height * 0.42, 40, width / 2, height * 0.42, height * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    this.backgrounds.set(key, bg);
    return bg;
  }

  getWeatherOverlay(type) {
    let overlay = this.weatherOverlays.get(type);
    if (!overlay) {
      overlay = createWeatherOverlay(type, this.view.width, this.view.height);
      this.weatherOverlays.set(type, overlay);
    }
    return overlay;
  }

  setTheme(name) {
    if (!SCENES[name] || name === this.target) return;
    this.prevTheme = this.target;
    this.target = name;
    this.transition = 0;
    this.flash = 0;
  }

  update(dt, themeName) {
    this.setTheme(themeName);
    if (this.transition < 1) this.transition = Math.min(1, this.transition + (dt * 1000) / CONFIG.scene.transitionMs);
    if (this.transition >= 1) {
      this.theme = this.target;
      this.prevTheme = null;
    }
    this.time += dt;

    const theme = SCENES[this.target];
    for (const cloud of this.clouds) {
      cloud.y += cloud.speed * dt * (theme.weather === 'rain' ? 2.2 : 1);
      if (cloud.y - cloud.h > this.view.height) {
        cloud.y = -cloud.h;
        cloud.x = rand(0, this.view.width);
      }
    }
    for (const star of this.stars) {
      star.y += star.speed * dt;
      if (star.y > this.view.height) {
        star.y = 0;
        star.x = rand(0, this.view.width);
      }
    }

    if (theme.lightning) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = rand(3.5, 8);
        this.flash = 0.5;
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
  }

  draw(ctx) {
    if (!this.prevTheme || this.transition >= 1) {
      this.drawTheme(ctx, this.target, 1);
      return;
    }
    this.drawTheme(ctx, this.prevTheme, 1 - this.transition);
    this.drawTheme(ctx, this.target, this.transition);
  }

  drawWeather(ctx, theme, key, alpha) {
    if (!theme.weather) return;
    const overlay = this.getWeatherOverlay(theme.weather);
    const { height } = this.view;
    const speed = theme.weather === 'rain' ? 520 : theme.weather === 'snow' ? 46 : -22;
    let offset = (this.time * speed) % height;
    if (offset < 0) offset += height;
    ctx.globalAlpha = alpha * (theme.weather === 'rain' ? 0.55 : 0.8);
    ctx.drawImage(overlay, 0, offset);
    ctx.drawImage(overlay, 0, offset - height);
  }

  drawTheme(ctx, key, alpha) {
    const theme = SCENES[key];
    if (!theme) return;
    const { width, height } = this.view;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.getBackground(key), 0, 0);
    this.drawWeather(ctx, theme, key, alpha);

    ctx.globalAlpha = alpha * 0.16;
    ctx.fillStyle = theme.cloud;
    for (const cloud of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(cloud.x, cloud.y, (cloud.w * cloud.layer) / 2, (cloud.h * cloud.layer) / 2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(this.flash, 0, 0.5) * 0.55 * alpha;
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }
}
