import { CONFIG, clamp } from '../config.js';
import { rand, TAU } from '../core/utils.js';
import { circleHit } from '../core/utils.js';
import { getSpecies } from '../data/pokedex.js';
import { getEffectiveness } from '../data/typeChart.js';
import { ITEMS } from '../data/items.js';
import { damageFactor } from '../data/moveFormulas.js';
import { attackFor, damageClassForMove, mitigation } from '../data/combatFormulas.js';
import { getMoveForSkill } from '../data/skills.js';
import { addExp, createPlayer, firePlayerBullets, hurtPlayer, updatePlayer } from './player.js';
import { createBulletPool, spawnEnemyBullet, spawnPlayerBullet, updateBulletPool } from './bullet.js';
import { createEnemy, updateEnemy } from './enemy.js';
import { createBoss, updateBoss } from './boss.js';
import { createWaves, notifyBossDefeated, updateWaves } from './waves.js';
import { createSquad } from './formations.js';
import { buildPath } from './paths.js';
import { Scene } from './scene.js';
import { BOSS_SCENES, SCENE_ORDER } from '../data/scenes.js';
import { collideDrops, createDrop, maxDropsReached, updateDrop } from './drops.js';
import { burst, createParticleList, updateParticles } from './particles.js';
import { Animator, drawAnimator, spriteHeight, spriteWidth } from './animator.js';
import { bulletColor, drawBullet } from './bulletArt.js';
import { Telemetry } from '../core/telemetry-api.js';

const PLAYER_HIT_FLASH = 0.25;
const ROLE_TARGET_HEIGHT = { player: 80, common: 84, elite: 112, boss: 170 };

export class Game {
  constructor({ ctx, pokedex, pmd, images, input, audio, mechId, onGameOver, onHud }) {
    this.ctx = ctx;
    this.pokedex = pokedex;
    this.pmd = pmd;
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
    this.scene = new Scene(CONFIG.view);
    try {
      this.best = Number(localStorage.getItem(CONFIG.storage.bestKey)) || 0;
    } catch {
      this.best = 0;
    }
    this.reset(false);
  }

  reset(begin = true) {
    this.player = createPlayer(getSpecies(this.mechId));
    this.attachSprite(this.player, this.mechId, 'player');
    this.lastShotAt = -10;
    this.playerMoving = false;
    this.playerBullets.forEach((b) => (b.active = false));
    this.enemyBullets.forEach((b) => (b.active = false));
    this.enemies.length = 0;
    this.pendingSpawns = [];
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

  attachSprite(entity, speciesId, role) {
    const meta = this.pmd[speciesId];
    if (!meta) return;
    const height = spriteHeight(meta);
    const target = ROLE_TARGET_HEIGHT[role] || ROLE_TARGET_HEIGHT.common;
    const override = CONFIG.sprite?.scaleOverrides?.[speciesId];
    const scale = override || clamp(Math.round(target / Math.max(height, 1)), 1, 4);
    const idle = meta.anims.idle;
    const width = spriteWidth(meta);
    entity.meta = meta;
    entity.scale = scale;
    entity.row = role === 'player' ? 4 : 0;
    entity.anim = new Animator(meta);
    entity.anim.set(role === 'player' ? 'idle' : 'move');
    entity.drawW = width * scale;
    entity.drawH = height * scale;
    entity.radius = Math.min(idle.fw, idle.fh) * scale * 0.32;
    entity.firedAt = -10;
  }

  updateAnimator(entity, dtMs, state) {
    if (!entity.anim) return;
    entity.anim.set(state);
    entity.anim.update(dtMs);
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
    this.playerMoving = Math.hypot(moved.dx, moved.dy) > dt * 12;

    this.player.cooldown -= dt * 1000;
    if (this.player.cooldown <= 0) {
      firePlayerBullets(this.player, (spec) =>
        spawnPlayerBullet(this.playerBullets, {
          ...spec,
          type: this.player.skillType,
          damageClass: damageClassForMove(getMoveForSkill(this.player.skillId)),
          damage:
            attackFor(
              'player',
              this.player.species,
              damageClassForMove(getMoveForSkill(this.player.skillId)),
              damageFactor(this.player.skillId),
              this.player.skillData.damageMult,
              1 + CONFIG.player.levelGrowth * (this.player.level - 1),
            ) *
            (1 + this.player.buffs.skillDamage) *
            this.player.buffs.damage,
        }),
      );
      this.audio.shoot();
      this.lastShotAt = this.clock;
    }
    const playerHurt = this.clock - (this.player.hitAt || -10) < 0.2;
    this.updateAnimator(this.player, dt * 1000, playerHurt ? 'hurt' : 'move');

    updateBulletPool(this.playerBullets, dt);
    updateBulletPool(this.enemyBullets, dt);

    this.processSpawns();
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updateDrops(dt);
    this.resolveCollisions();

    updateWaves(this.waves, dt, {
      alive: this.aliveCount,
      spawnSquad: (wave) => this.spawnSquad(wave),
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
      this.scene.update(dt, this.currentSceneTheme());
    }
  }

  currentSceneTheme() {
    if (this.boss && !this.boss.dead) {
      const bossTheme = BOSS_SCENES[this.boss.species.id];
      if (bossTheme) return bossTheme;
    }
    const index = Math.floor((Math.max(1, this.waves.wave) - 1) / CONFIG.scene.switchEveryWaves) % SCENE_ORDER.length;
    return SCENE_ORDER[index];
  }

  updateEnemies(dt) {
    const canShoot = this.enemyBullets.filter((b) => b.active).length < CONFIG.enemy.maxBullets;
    const ctx = {
      playerX: this.player.x,
      playerY: this.player.y,
      wave: this.waves.wave,
      clock: this.clock,
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
      const state =
        this.clock - (enemy.hitAt || -10) < 0.2
          ? 'hurt'
          : this.clock - (enemy.firedAt || -10) < 0.32
            ? 'attack'
            : enemy.mode === 'hold'
              ? 'idle'
              : 'move';
      this.updateAnimator(enemy, dt * 1000, state);
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
      clock: this.clock,
      fire: (spec) => spawnEnemyBullet(this.enemyBullets, { type: this.boss.species.types[0], color: bulletColor(this.boss.species.types[0]), ...spec }),
      canShoot,
    });
    const bossState = this.clock - (this.boss.hitAt || -10) < 0.2 ? 'hurt' : this.clock - (this.boss.firedAt || -10) < 0.5 ? 'attack' : 'idle';
    this.updateAnimator(this.boss, dt * 1000, bossState);
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
    collideDrops(this.drops);
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
        const defStat = bullet.damageClass === 'physical' ? enemy.species.stats.defense : enemy.species.stats.spDefense;
        const damage = bullet.damage * mitigation(defStat) * typeMult;
        enemy.hp -= damage;
        enemy.hitAt = this.clock;
        Telemetry.damage(this.run, damage);
        this.audio.hit();
        burst(this.particles, bullet.x, bullet.y, 3, bullet.color || '#fff2a8', { speed: 90, size: 2.4, life: 0.28 });
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
        const defStat = bullet.damageClass === 'physical' ? this.boss.species.stats.defense : this.boss.species.stats.spDefense;
        const damage = bullet.damage * mitigation(defStat) * typeMult;
        this.boss.hp -= damage;
        this.boss.hitAt = this.clock;
        Telemetry.damage(this.run, damage);
        this.audio.hit();
        burst(this.particles, bullet.x, bullet.y, 3, bullet.color || '#fff2a8', { speed: 110, size: 2.6, life: 0.3 });
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
      const defStat = bullet.damageClass === 'physical' ? player.stats.defense : player.stats.spDefense;
      this.damagePlayer(bullet.damage * mitigation(defStat));
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (!circleHit(enemy.x, enemy.y, enemy.radius * 0.8, player.x, player.y, player.radius * 0.7)) continue;
      enemy.hp -= 14;
      this.damagePlayer(enemy.contactDamage ?? enemy.damage);
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
    this.player.hitAt = this.clock;
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

    const dropChance = enemy.tier === 'elite' ? CONFIG.drops.eliteChance : CONFIG.drops.commonChance;
    const itemId = Math.random() < dropChance ? (enemy.tier === 'elite' ? 'skill_up' : 'heal') : null;
    if (itemId && !maxDropsReached(this.drops.length)) this.drops.push(createDrop(itemId, enemy.x, enemy.y));
  }

  killBoss() {
    const boss = this.boss;
    this.enemies.length = 0;
    this.enemyBullets.forEach((b) => (b.active = false));
    burst(this.particles, boss.x, boss.y, 60, '#ffd27a', { speed: 380, size: 7, life: 1 });
    this.audio.explode();
    this.audio.cry(boss.species.id);
    const bossLevelUps = addExp(this.player, boss.expValue || 0);
    if (bossLevelUps > 0) {
      this.audio.levelUp();
      burst(this.particles, this.player.x, this.player.y, 18, '#9be7ff', { speed: 180, size: 4.5, life: 0.7 });
    }
    if (!maxDropsReached(this.drops.length)) this.drops.push(createDrop('skill_up', boss.x, boss.y));
    const utilityDrop = this.player.hp / this.player.maxHp < CONFIG.drops.bossHealThreshold ? 'heal' : 'stat_boost';
    if (!maxDropsReached(this.drops.length)) this.drops.push(createDrop(utilityDrop, boss.x + 18, boss.y - 8));
    notifyBossDefeated(this.waves);
    this.boss = null;
    this.waveBanner = 1.8;
    this.waveBannerText = `第 ${this.waves.wave} 波`;
    this.lastWave = this.waves.wave;
    this.shake = 0.7;
  }

  collectDrop(drop) {
    const item = ITEMS[drop.itemId];
    const gained = item.apply(this.player);
    Telemetry.pickup(this.run, drop.itemId);
    const wastedScore = item.scoreValue ?? CONFIG.drops.scoreValue;
    this.score += gained ? 0 : wastedScore;
    this.audio.pickup();
    burst(this.particles, drop.x, drop.y, 12, gained ? '#9be7ff' : '#ffe066', { speed: 170, size: 4, life: 0.5 });
    if (!gained) {
      this.waveBanner = 0.8;
      this.waveBannerText = `${item.name}已满 +${wastedScore} 分`;
    }
  }

  spawnSquad(wave) {
    if (this.pendingSpawns.length > 40) return;
    const squad = createSquad(wave);
    for (const member of squad.members) {
      this.pendingSpawns.push({ at: this.clock + member.delay, member, wave });
    }
  }

  processSpawns() {
    if (!this.pendingSpawns.length) return;
    for (let i = this.pendingSpawns.length - 1; i >= 0; i -= 1) {
      const pending = this.pendingSpawns[i];
      if (this.clock < pending.at) continue;
      if (this.enemies.length >= CONFIG.enemy.maxAlive) continue;
      this.spawnMember(pending.member, pending.wave);
      this.pendingSpawns.splice(i, 1);
    }
  }

  spawnMember(member, wave) {
    const pool = this.enemySpeciesPool.filter((s) => (member.tier === 'elite' ? s.tier === 'elite' : s.tier === 'common'));
    const species = pool.length ? pool[Math.floor(Math.random() * pool.length)] : this.enemySpeciesPool[0];
    const path = buildPath(member.pathKey, {
      dx: member.dx,
      playerX: this.player.x,
      playerY: this.player.y,
      hold: member.hold,
    });
    const enemy = createEnemy(species, wave, { path, hold: member.hold, delay: 0 });
    this.attachSprite(enemy, species.id, species.tier === 'elite' ? 'elite' : 'common');
    this.enemies.push(enemy);
  }

  spawnBoss(id) {
    this.pendingSpawns.length = 0;
    const species = getSpecies(id);
    this.boss = createBoss(species, this.waves.wave);
    this.attachSprite(this.boss, id, 'boss');
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

    this.scene.draw(ctx);
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

  drawPlayer(ctx) {
    const p = this.player;
    if (p.dead || !p.anim) return;
    const blink = p.invulnUntil > this.clock * 1000 && Math.floor(this.clock * 20) % 2 === 0;
    const y = p.y + Math.sin(this.clock * 2.4) * 3;

    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#9be7ff';
    ctx.beginPath();
    ctx.ellipse(p.x, y + p.drawH * 0.34, p.drawW * 0.26, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, y);
    ctx.rotate(p.tilt);
    ctx.translate(-p.x, -y);
    drawAnimator(ctx, this.images, p.anim, p.x, y, p.scale, p.row, blink ? 0.35 : 1, false);
    ctx.restore();
  }

  drawEnemies(ctx) {
    for (const enemy of this.enemies) {
      if (!enemy.anim) continue;
      const flash = this.clock - enemy.hitAt < 0.09;
      const bob = Math.sin((this.clock + enemy.baseX) * 3) * 4;
      const y = enemy.y + bob;
      ctx.save();
      ctx.translate(enemy.x, y);
      const tilt = enemy.tilt || 0;
      ctx.rotate(tilt);
      ctx.translate(-enemy.x, -y);
      drawAnimator(ctx, this.images, enemy.anim, enemy.x, y, enemy.scale, enemy.row, 1, flash);
      ctx.restore();

    }
  }

  drawBoss(ctx) {
    const boss = this.boss;
    if (!boss || !boss.anim) return;
    const flash = this.clock - boss.hitAt < 0.1;
    const bob = Math.sin(this.clock * 1.6) * 6;
    const y = boss.y + bob;

    ctx.save();
    ctx.globalAlpha = 0.2 + Math.sin(this.clock * 3) * 0.05;
    ctx.fillStyle = boss.species.id === 144 ? '#8fe6ff' : boss.species.id === 145 ? '#ffe066' : '#ff9a4d';
    ctx.beginPath();
    ctx.arc(boss.x, y, boss.drawW * 0.58, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawAnimator(ctx, this.images, boss.anim, boss.x, y, boss.scale, boss.row, boss.dead ? Math.max(0, boss.dying / 1.4) : 1, flash);
  }

  drawBullets(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const bullet of this.playerBullets) {
      if (bullet.active) drawBullet(ctx, bullet);
    }
    ctx.restore();
    for (const bullet of this.enemyBullets) {
      if (bullet.active) drawBullet(ctx, bullet);
    }
  }

  drawDrops(ctx) {
    const d = CONFIG.drops;
    const blinkWindow = d.blinkMs / 1000;
    for (const drop of this.drops) {
      const blinking = drop.life < blinkWindow && Math.floor(drop.t * 8) % 2 === 0;
      const alpha = blinking ? 0.35 : 1;
      const size = d.iconSize;
      const bob = Math.sin(drop.t * 4) * 1.5;
      const img = this.images.get(`item:${drop.itemId}`);
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillStyle = 'rgba(140,220,255,0.35)';
      ctx.beginPath();
      ctx.arc(drop.x, drop.y + bob, size * 0.72, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha;
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, drop.x - size / 2, drop.y - size / 2 + bob, size, size);
      } else {
        ctx.fillStyle = '#9be7ff';
        ctx.beginPath();
        ctx.arc(drop.x, drop.y + bob, size * 0.3, 0, TAU);
        ctx.fill();
      }
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
    ctx.fillText(`HP ${Math.ceil(p.hp)}/${Math.ceil(p.maxHp)}`, 14, 36);

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
    const overload = skill.skillLevel >= 5 ? skill.overloadCount : 0;
    const skillLabel = `${skill.skillName} Lv.${skill.skillLevel}${overload ? `+${overload}` : ''}`;
    ctx.fillText(skillLabel, 14, 74);
    const dotsX = 14 + ctx.measureText(skillLabel).width + 8;
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < skill.skillLevel ? '#9be7ff' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(dotsX + i * 12, 66, 8, 8);
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
