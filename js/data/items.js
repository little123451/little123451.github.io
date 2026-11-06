import { CONFIG } from '../config.js';

export const ITEMS = {
  skill_up: {
    id: 'skill_up',
    name: '技能强化',
    desc: '技能等级 +1；满级后交替强化伤害与攻速',
    icon: 'assets/items/skill_up.png',
    scoreValue: 300,
    maxLevel: 5,
    apply(player) {
      if (player.skillLevel < this.maxLevel) {
        player.skillLevel += 1;
        return true;
      }
      if (player.overloadCount >= CONFIG.drops.overloadMax) return false;
      if (player.overloadCount % 2 === 0) player.buffs.skillDamage += 0.08;
      else player.buffs.skillInterval *= 0.97;
      player.overloadCount += 1;
      return true;
    },
  },
  heal: {
    id: 'heal',
    name: '回血果',
    desc: '恢复 25% 最大生命',
    icon: 'assets/items/heal.png',
    scoreValue: 150,
    apply(player) {
      if (player.hp >= player.maxHp - 0.5) return false;
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.25);
      return true;
    },
  },
  stat_boost: {
    id: 'stat_boost',
    name: '营养剂',
    desc: '永久 +4% 伤害、+2% 攻速（最多 8 层）',
    icon: 'assets/items/stat_boost.png',
    scoreValue: 300,
    apply(player) {
      if (player.statBoostCount >= CONFIG.drops.statBoostMax) return false;
      player.buffs.damage *= 1.04;
      player.buffs.fireRate *= 0.98;
      player.statBoostCount += 1;
      return true;
    },
  },
};
