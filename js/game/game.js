import { CONFIG, clamp } from '../config.js';
import { rand, TAU } from '../core/utils.js';
import { circleHit } from '../core/utils.js';
import { getSpecies } from '../data/pokedex.js';
import { getEffectiveness } from '../data/typeChart.js';
import { ITEMS, rollDrop } from '../data/items.js';
import { addExp, createPlayer, firePlayerBullets, hurtPlayer, updatePlayer } from './player.js';
import { createBulletPool, spawnEnemyBullet, spawnPlayerBullet, updateBulletPool } from './bullet.js';
import { createEnemy, updateEnemy } from './enemy.js';
import { createBoss, updateBoss } from './boss.js';
import { createWaves, notifyBossDefeated, updateWaves } from './waves.js';
import { createDrop, updateDrop } from './drops.js';
import { burst, createParticleList, updateParticles } from './particles.js';
import { Telemetry } from '../core/telemetry-api.js';

const PLAYER_HIT_FLASH = 0.25;

export class Game {
  constructor({ ctx, pokedex, images, input, audio, mechId, onGameOver, onHud }) {
    this.ctx = ctx;
    this.pokedex = pokedex;
    this.images = images;
    this.input = input;
    this.audio = audio;
    this.mechId = mechId;
    this.onGameOver = onGameOver;
    this.onHud = onHud;

    this.state = 'ready';
    this.clock = 0;
    this.playerBullets = createBulletPool(CONFIG.bullets.poolSize);
    this.enemyBullets = createBulletPool(CONFIG.bullets.enemyPoolSize);
    this.enemies = [];
    this.boss = null;
    this.drops = [];
    this.particles = createParticleList();
    this.shake = 0;
    this.hurtFlash = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.score = 0;
    this.best = 0;
    this.waveBanner = 0;
    this.waveBannerText = '';
    this.bossBanner = 0;
    this.deathTimer = 0;
    this.clouds = Array.from({ length: 7 }, () => ({
      x: rand(0, CONFIG.view.width),
      y: rand(0, CONFIG.view.height),
      w: rand(70, 170),
      h: rand(18, 40),
      speed: rand(8, 26),
      alpha: rand(0.05, 0.16),
    }));
    this.stars = Array.from({ length: 70 }, () => ({
      x: rand(0, CONFIG.view.width),
      y: rand(0, CONFIG.view.height),
      r: rand(0.6, 1.8),
      speed: rand(14, 46),
      alpha: rand(0.2, 0.8),
    }));
    try {
      this.best = Number(localStorage.getItem(CONFIG.storage.bestKey)) || 0;
    } catch {
      this.best = 0;
    }
    this.reset(false);
  }

  reset(begin = true) {
    this.player = createPlayer(getSpecies(this.mechId));
    this.playerBullets.forEach((b) => (b.active = false));
    this.enemyBullets.forEach((b) => (b.active = false));
    this.enemies.length = 0;
    this.drops.length = 0;
    this.particles.items.length = 0;
    this.boss = null;
    this.waves = createWaves();
    this.clock = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.shake = 0;
    this.hurtFlash = 0;
    this.deathTimer = 0;
    this.state = begin ? 'playing' : 'ready';
    this.lastWave = 1;
    this.run = begin ? Telemetry.start(this.mechId) : null;
    if (begin) {
      this.audio.cry(this.mechId);
      this.waveBanner = 1.8;
      this.waveBannerText = '第 1 波';
    } else {
      this.waveBanner = 0;
      this.waveBannerText = '';
    }
    this.enemySpeciesPool = this.pokedex.filter((s) => s.id !== this.mechId && s.tier !== 'boss');
  }

  get aliveCount() {
    return this.enemies.length + (this.boss && !this.boss.dead ? 1 : 0);
  }

  update(dt) {
    if (this.state !== 'playing') {
      if (this.state === 'dying') {
        this.deathTimer -= dt;
        this.updateEffects(dt, false);
        if (this.deathTimer <= 0) this.finishRun();
      }
      return;
    }

    this.clock += dt;
    this.updateEffects(dt, true);

    const moved = updatePlayer(this.player, dt, this.input, this.clock * 1000);
    Telemetry.distance(this.run, moved.dx, moved.dy);
    Telemetry.sample(this.run, { wave: this.waves.wave, level: this.player.level, score: this.score });

    this.player.cooldown -= dt * 1000;
    if (this.player.cooldown <= 0) {
      firePlayerBullets(this.player, (spec) =>
        spawnPlayerBullet(this.playerBullets, {
          ...spec,
          damage: this.player.stats.baseDamage * this.player.skillData.damageMult * (1 + CONFIG.player.levelGrowth * (this.player.level - 1)),
        }),
      );
      this.audio.shoot();
    }

    updateBulletPool(this.playerBullets, dt);
    updateBulletPool(this.enemyBullets, dt);

    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateDrops(dt);
    this.resolveCollisions();

    updateWaves(this.waves, dt, {
      alive: this.aliveCount,
      spawnEnemy: ({ tier, behavior, wave }) => this.spawnEnemy(tier, behavior, wave),
      spawnBoss: (id) => this.spawnBoss(id),
      onBossWarning: (wave) => {
        const id = this.bossIdForWave(wave);
        const species = getSpecies(id);
        this.waveBanner = CONFIG.waves.bossWarningMs / 1000;
        this.waveBannerText = `警告：${species ? species.nameZh : '强敌'} 接近`;
        this.audio.boss();
        this.shake = Math.max(this.shake, 0.5);
      },
    });

    if (this.waves.wave !== this.lastWave && this.waves.bossState === 'none') {
      if (this.lastWave) {
        this.waveBanner = 1.6;
        this.waveBannerText = `第 ${this.waves.wave} 波`;
      }
      this.lastWave = this.waves.wave;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    if (this.player.dead && this.state === 'playing') {
      this.state = 'dying';
      this.deathTimer = 1.3;
      this.shake = 0.9;
      burst(this.particles, this.player.x, this.player.y, 40, '#ffd27a', { speed: 320, size: 6 });
      this.audio.explode();
      this.audio.gameOver();
    }
  }

  updateEffects(dt, scroll) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.waveBanner > 0) this.waveBanner -= dt;
    updateParticles(this.particles, dt);
    if (scroll) {
      for (const cloud of this.clouds) {
        cloud.y += cloud.speed * dt;
        if (cloud.y - cloud.h > CONFIG.view.height) {
          cloud.y = -cloud.h;
          cloud.x = rand(0, CONFIG.view.width);
        }
      }
      for (const star of this.stars) {
        star.y += star.speed * dt;
        if (star.y > CONFIG.view.height) {
          star.y = 0;
          star.x = rand(0, CONFIG.view.width);
        }
      }
    }
  }

  updateEnemies(dt) {
    const canShoot = this.enemyBullets.filter((b) => b.active).length < CONFIG.enemy.maxBullets;
    const ctx = {
      playerX: this.player.x,
      playerY: this.player.y,
      wave: this.waves.wave,
      canShoot,
      fire: (spec) => spawnEnemyBullet(this.enemyBullets, spec),
    };
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.dead) {
        this.enemies.splice(i, 1);
        continue;
      }
      if (!updateEnemy(enemy, dt, ctx)) this.enemies.splice(i, 1);
      if (!enemy.entered && enemy.y > -20) {
        enemy.entered = true;
        if (enemy.tier === 'elite') this.audio.cry(enemy.species.id);
      }
    }
  }

  updateBoss(dt) {
    if (!this.boss) return;
    const canShoot = this.enemyBullets.filter((b) => b.active).length < CONFIG.enemy.maxBullets;
    const alive = updateBoss(this.boss, dt, {
      playerX: this.player.x,
      playerY: this.player.y,
      wave: this.waves.wave,
      fire: (spec) => spawnEnemyBullet(this.enemyBullets, spec),
      canShoot,
    });
    if (this.boss.dead) {
      if (this.boss.dying > 0 && Math.random() < dt * 22) {
        burst(this.particles, this.boss.x + rand(-60, 60), this.boss.y + rand(-40, 40), 10, '#ffb457', { speed: 260, size: 8 });
        this.shake = Math.max(this.shake, 0.45);
        this.audio.explode();
      }
      if (!alive) this.killBoss();
    }
  }

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const result = updateDrop(this.drops[i], dt, this.player);
      if (result === 'collect') {
        this.collectDrop(this.drops[i]);
        this.drops.splice(i, 1);
      } else if (result === 'expire') {
        this.drops.splice(i, 1);
      }
    }
  }

  resolveCollisions() {
    const player = this.player;
    for (const bullet of this.playerBullets) {
      if (!bullet.active) continue;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (!circleHit(bullet.x, bullet.y, bullet.r, enemy.x, enemy.y, enemy.radius)) continue;
        const typeMult = getEffectiveness('flying', enemy.species.types, CONFIG.flags.typeChart);
        const damage = bullet.damage * typeMult;
        enemy.hp -= damage;
        enemy.hitAt = this.clock;
        Telemetry.damage(this.run, damage);
        this.audio.hit();
        burst(this.particles, bullet.x, bullet.y, 3, '#fff2a8', { speed: 90, size: 2.4, life: 0.28 });
        if (enemy.hp <= 0) this.killEnemy(enemy);
        if (bullet.pierce > 0) {
          bullet.pierce -= 1;
        } else {
          bullet.active = false;
        }
        break;
      }
      if (!bullet.active) continue;
      if (this.boss && !this.boss.dead && this.boss.y > 0 && circleHit(bullet.x, bullet.y, bullet.r, this.boss.x, this.boss.y, this.boss.radius)) {
        const typeMult = getEffectiveness('flying', this.boss.species.types, CONFIG.flags.typeChart);
        const damage = bullet.damage * typeMult;
        this.boss.hp -= damage;
        this.boss.hitAt = this.clock;
        Telemetry.damage(this.run, damage);
        this.audio.hit();
        burst(this.particles, bullet.x, bullet.y, 3, '#fff2a8', { speed: 110, size: 2.6, life: 0.3 });
        if (bullet.pierce > 0) bullet.pierce -= 1;
        else bullet.active = false;
        if (this.boss.hp <= 0 && !this.boss.dead) {
          this.boss.dead = true;
          this.boss.dying = 1.4;
          this.score += this.boss.scoreValue;
          this.audio.cry(this.boss.species.id);
        }
      }
    }

    for (const bullet of this.enemyBullets) {
      if (!bullet.active) continue;
      if (!circleHit(bullet.x, bullet.y, bullet.r, player.x, player.y, player.radius * 0.7)) continue;
      bullet.active = false;
      this.damagePlayer(bullet.damage);
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (!circleHit(enemy.x, enemy.y, enemy.radius * 0.8, player.x, player.y, player.radius * 0.7)) continue;
      enemy.hp -= 14;
      this.damagePlayer(enemy.damage);
      enemy.hitAt = this.clock;
      if (enemy.hp <= 0) this.killEnemy(enemy);
    }

    if (this.boss && !this.boss.dead && this.boss.y > 0) {
      if (circleHit(this.boss.x, this.boss.y, this.boss.radius * 0.8, player.x, player.y, player.radius * 0.7)) {
        this.damagePlayer(CONFIG.boss.contactDamage);
      }
    }
  }

  damagePlayer(amount) {
    if (!hurtPlayer(this.player, amount, this.clock * 1000)) return;
    Telemetry.taken(this.run, amount);
    this.hurtFlash = PLAYER_HIT_FLASH;
    this.shake = Math.max(this.shake, 0.45);
    this.combo = 0;
    this.comboTimer = 0;
    burst(this.particles, this.player.x, this.player.y, 10, '#ff6b6b', { speed: 200, size: 4, life: 0.5 });
  }

  killEnemy(enemy) {
    enemy.dead = true;
    this.combo += 1;
    this.comboTimer = CONFIG.score.comboWindowMs / 1000;
    const multiplier = Math.min(CONFIG.score.comboMax, 1 + Math.floor(this.combo / 6));
    this.score += Math.round(enemy.scoreValue * multiplier);
    Telemetry.kill(this.run, enemy.species.id);
    const levelUps = addExp(this.player, enemy.expValue);
    if (levelUps > 0) {
      this.audio.levelUp();
      burst(this.particles, this.player.x, this.player.y, 18, '#9be7ff', { speed: 180, size: 4.5, life: 0.7 });
    }
    burst(this.particles, enemy.x, enemy.y, 14, '#ffb457', { speed: 260, size: 5, life: 0.5 });
    this.audio.explode();
    this.audio.cry(enemy.species.id);
    this.shake = Math.max(this.shake, 0.18);

    const itemId = rollDrop(enemy.species.id, false);
    if (itemId) this.drops.push(createDrop(itemId, enemy.x, enemy.y));
  }

  killBoss() {
    const boss = this.boss;
    this.enemies.length = 0;
    this.enemyBullets.forEach((b) => (b.active = false));
    burst(this.particles, boss.x, boss.y, 60, '#ffd27a', { speed: 380, size: 7, life: 1 });
    this.audio.explode();
    this.audio.cry(boss.species.id);
    this.drops.push(createDrop('skill_up', boss.x, boss.y));
    notifyBossDefeated(this.waves);
    this.boss = null;
    this.waveBanner = 1.8;
    this.waveBannerText = `第 ${this.waves.wave} 波`;
    this.lastWave = this.waves.wave;
    this.shake = 0.7;
  }

  collectDrop(drop) {
    const item = ITEMS[drop.itemId];
    const upgraded = item.apply(this.player);
    Telemetry.pickup(this.run, drop.itemId);
    this.score += upgraded ? 0 : CONFIG.drops.scoreValue;
    this.audio.pickup();
    burst(this.particles, drop.x, drop.y, 12, upgraded ? '#9be7ff' : '#ffe066', { speed: 170, size: 4, life: 0.5 });
    if (!upgraded) {
      this.waveBanner = 0.8;
      this.waveBannerText = '技能已满级 +500 分';
    }
  }

  spawnEnemy(tier, behavior, wave) {
    const pool = this.enemySpeciesPool.filter((s) => (tier === 'elite' ? s.tier === 'elite' : s.tier === 'common'));
    const species = pool.length ? pool[Math.floor(Math.random() * pool.length)] : this.enemySpeciesPool[0];
    const enemy = createEnemy(species, wave, behavior);
    this.enemies.push(enemy);
  }

  spawnBoss(id) {
    const species = getSpecies(id);
    this.boss = createBoss(species, this.waves.wave);
    this.audio.cry(id);
    this.shake = 0.6;
    this.waveBanner = 1.4;
    this.waveBannerText = `${species.nameZh} 出现`;
    this.lastWave = this.waves.wave;
  }

  bossIdForWave(wave) {
    const index = Math.floor(wave / CONFIG.waves.bossEvery) - 1;
    const order = [144, 145, 146];
    return order[((index % order.length) + order.length) % order.length];
  }

  finishRun() {
    this.state = 'over';
    this.best = Math.max(this.best, this.score);
    try {
      localStorage.setItem(CONFIG.storage.bestKey, String(this.best));
    } catch {
      /* ignore */
    }
    const store = Telemetry.end(this.run, {
      score: this.score,
      wave: this.waves.wave,
      level: this.player.level,
      aborted: false,
    });
    this.onGameOver?.({
      score: this.score,
      best: this.best,
      wave: this.waves.wave,
      level: this.player.level,
      skillLevel: this.player.skillLevel,
      runs: store?.totals.runs ?? 0,
    });
  }

  endRunAborted() {
    if (this.state !== 'playing') return;
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem(CONFIG.storage.bestKey, String(this.best));
      } catch {
        /* ignore */
      }
    }
    Telemetry.end(this.run, {
      score: this.score,
      wave: this.waves.wave,
      level: this.player.level,
      aborted: true,
    });
  }

  render(alpha = 1) {
    const ctx = this.ctx;
    const { width, height } = CONFIG.view;
    ctx.clearRect(0, 0, width, height);

    const shakeX = this.shake > 0 ? rand(-1, 1) * 12 * this.shake : 0;
    const shakeY = this.shake > 0 ? rand(-1, 1) * 12 * this.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawBackground(ctx);
    this.drawDrops(ctx);
    this.drawEnemies(ctx);
    this.drawBoss(ctx);
    this.drawBullets(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    ctx.restore();

    this.drawHud(ctx);
    this.drawBanners(ctx);
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,60,60,${this.hurtFlash * 1.4})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (this.state === 'dying' || this.state === 'over') {
      ctx.fillStyle = `rgba(0,0,0,${this.state === 'over' ? 0.62 : 0.3})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  drawBackground(ctx) {
    const { width, height } = CONFIG.view;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    const bossHue = this.boss ? this.boss.species.id : 0;
    if (bossHue === 146) {
      grad.addColorStop(0, '#2a0d0d');
      grad.addColorStop(1, '#120608');
    } else if (bossHue === 145) {
      grad.addColorStop(0, '#1c1a05');
      grad.addColorStop(1, '#0a0a10');
    } else if (bossHue === 144) {
      grad.addColorStop(0, '#061a24');
      grad.addColorStop(1, '#060912');
    } else {
      grad.addColorStop(0, '#0b1430');
      grad.addColorStop(1, '#05070f');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    for (const star of this.stars) {
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = '#cfe6ff';
      ctx.fillRect(star.x, star.y, star.r, star.r * 2.4);
    }
    ctx.globalAlpha = 1;

    for (const cloud of this.clouds) {
      ctx.globalAlpha = cloud.alpha;
      ctx.fillStyle = '#7fa6d8';
      ctx.beginPath();
      ctx.ellipse(cloud.x, cloud.y, cloud.w / 2, cloud.h / 2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawPlayer(ctx) {
    const p = this.player;
    if (p.dead) return;
    const blink = p.invulnUntil > this.clock * 1000 && Math.floor(this.clock * 20) % 2 === 0;
    const img = this.images.get(p.species.id);
    const y = p.y + Math.sin(this.clock * 2.4) * 3;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.translate(p.x, y);
    ctx.rotate(p.tilt);
    if (img) ctx.drawImage(img, -38, -38, 76, 76);
    ctx.restore();

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9be7ff';
    ctx.beginPath();
    ctx.ellipse(p.x, y + 30, 16, 5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawEnemies(ctx) {
    for (const enemy of this.enemies) {
      const img = this.images.get(enemy.species.id);
      const flash = this.clock - enemy.hitAt < 0.08;
      const bob = Math.sin((this.clock + enemy.baseX) * 3) * 4;
      ctx.save();
      ctx.translate(enemy.x, enemy.y + bob);
      const tilt = clamp((enemy.x - enemy.baseX) * 0.002, -0.2, 0.2);
      ctx.rotate(tilt);
      if (img) {
        ctx.globalAlpha = 1;
        ctx.drawImage(img, -enemy.size / 2, -enemy.size / 2, enemy.size, enemy.size);
      }
      if (flash) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.6;
        if (img) ctx.drawImage(img, -enemy.size / 2, -enemy.size / 2, enemy.size, enemy.size);
      }
      ctx.restore();

      if (enemy.hp < enemy.maxHp) {
        const w = enemy.size * 0.7;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(enemy.x - w / 2, enemy.y - enemy.size / 2 - 9, w, 4);
        ctx.fillStyle = enemy.tier === 'elite' ? '#ffb457' : '#8fe6a8';
        ctx.fillRect(enemy.x - w / 2, enemy.y - enemy.size / 2 - 9, w * (enemy.hp / enemy.maxHp), 4);
      }
    }
  }

  drawBoss(ctx) {
    const boss = this.boss;
    if (!boss) return;
    const img = this.images.get(boss.species.id);
    const flash = this.clock - boss.hitAt < 0.1;
    const bob = Math.sin(this.clock * 1.6) * 6;
    ctx.save();
    ctx.translate(boss.x, boss.y + bob);
    if (img) ctx.drawImage(img, -boss.size / 2, -boss.size / 2, boss.size, boss.size);
    if (flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.65;
      if (img) ctx.drawImage(img, -boss.size / 2, -boss.size / 2, boss.size, boss.size);
    }
    ctx.restore();

    ctx.globalAlpha = 0.22 + Math.sin(this.clock * 3) * 0.06;
    ctx.fillStyle = boss.species.id === 144 ? '#8fe6ff' : boss.species.id === 145 ? '#ffe066' : '#ff9a4d';
    ctx.beginPath();
    ctx.arc(boss.x, boss.y + bob, boss.size * 0.62, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawBullets(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const bullet of this.playerBullets) {
      if (!bullet.active) continue;
      ctx.fillStyle = '#bff4ff';
      ctx.beginPath();
      ctx.ellipse(bullet.x, bullet.y, bullet.r, bullet.r * 2.6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r * 0.55, 0, TAU);
      ctx.fill();
    }
    for (const bullet of this.enemyBullets) {
      if (!bullet.active) continue;
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r * 2, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawDrops(ctx) {
    for (const drop of this.drops) {
      const pulse = 1 + Math.sin(drop.t * 6) * 0.12;
      const r = CONFIG.drops.radius * pulse;
      ctx.save();
      ctx.translate(drop.x, drop.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(155,231,255,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.8, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0e2a3a';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#9be7ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#9be7ff';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(r * 0.18, 0);
      ctx.lineTo(r * 0.18, r * 0.55);
      ctx.lineTo(-r * 0.18, r * 0.55);
      ctx.lineTo(-r * 0.18, 0);
      ctx.lineTo(-r * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawParticles(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles.items) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawHud(ctx) {
    const { width } = CONFIG.view;
    const p = this.player;

    ctx.save();
    ctx.fillStyle = 'rgba(5,10,20,0.55)';
    ctx.fillRect(0, 0, width, 62);

    const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(14, 14, 170, 12);
    ctx.fillStyle = hpRatio > 0.5 ? '#5ee08a' : hpRatio > 0.25 ? '#ffd166' : '#ff5c5c';
    ctx.fillRect(14, 14, 170 * hpRatio, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(14.5, 14.5, 170, 12);

    ctx.fillStyle = '#dce9ff';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)}`, 14, 36);

    const expNeed = CONFIG.exp.toNext(p.level);
    const expRatio = p.level >= CONFIG.player.levelCap ? 1 : clamp(p.exp / expNeed, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(60, 44, 104, 5);
    ctx.fillStyle = '#9be7ff';
    ctx.fillRect(60, 44, 104 * expRatio, 5);
    ctx.fillStyle = '#9be7ff';
    ctx.fillText(`Lv.${p.level}${p.level >= CONFIG.player.levelCap ? ' MAX' : ''}`, 14, 50);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(this.score).padStart(6, '0'), width - 14, 26);
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9fb6d6';
    ctx.fillText(`最高 ${this.best}  第 ${this.waves.wave} 波`, width - 14, 43);

    if (this.combo > 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`${this.combo} COMBO`, width / 2, 40);
    }

    const skill = this.player;
    ctx.textAlign = 'left';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9be7ff';
    ctx.fillText(`${skill.skillName} Lv.${skill.skillLevel}`, 14, 74);
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < skill.skillLevel ? '#9be7ff' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(72 + i * 12, 66, 8, 8);
    }
    ctx.restore();

    if (this.boss && !this.boss.dead) {
      const boss = this.boss;
      const w = width - 80;
      const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(40, 86, w, 9);
      const color = boss.species.id === 144 ? '#8fe6ff' : boss.species.id === 145 ? '#ffe066' : '#ff9a4d';
      ctx.fillStyle = color;
      ctx.fillRect(40, 86, w * ratio, 9);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.strokeRect(40.5, 86.5, w, 9);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(boss.species.nameZh, width / 2, 80);
    }
  }

  drawBanners(ctx) {
    const { width } = CONFIG.view;
    if (this.waveBanner > 0) {
      const alpha = Math.min(1, this.waveBanner * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 200, width, 62);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.waveBannerText, width / 2, 240);
      ctx.restore();
    }
  }
}
