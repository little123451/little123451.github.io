// 数据层：加载 dex.json，提供中文词表与查表工具
export const DEX = { species: {}, natures: [], count: 0 };

// 自定义实验数据（data/experiments.json），与研究笔记数据分开维护
export const EXPERIMENTS_DATA = { species: {} };
let experimentIndex = new Map();

export function initExperiments(payload) {
  EXPERIMENTS_DATA.species = payload?.species || {};
  experimentIndex = new Map();
  for (const entry of Object.values(EXPERIMENTS_DATA.species)) {
    for (const e of entry.experiments || []) experimentIndex.set(e.id, e);
  }
}

export function customExperiments(dexId) {
  return EXPERIMENTS_DATA.species[String(dexId)]?.experiments || null;
}

export function experimentById(id) {
  return experimentIndex.get(id) || null;
}

export const TYPES_ZH = {
  normal: '一般', fire: '火', water: '水', electric: '电', grass: '草', ice: '冰',
  fighting: '格斗', poison: '毒', ground: '地面', flying: '飞行', psychic: '超能力',
  bug: '虫', rock: '岩石', ghost: '幽灵', dragon: '龙', dark: '恶', steel: '钢', fairy: '妖精',
};

export const TYPE_COLORS = {
  normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c', grass: '#7ac74c',
  ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1', ground: '#e2bf65', flying: '#a98ff3',
  psychic: '#f95587', bug: '#a6b91a', rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc',
  dark: '#705746', steel: '#b7b7ce', fairy: '#d685ad',
};

export const EGG_ZH = {
  monster: '怪兽', water1: '水中1', bug: '虫', flying: '飞行', ground: '陆上',
  fairy: '妖精', plant: '植物', humanshape: '人形', water3: '水中3', mineral: '矿物',
  indeterminate: '不定形', water2: '水中2', dragon: '龙', 'no-eggs': '未发现', ditto: '百变怪',
};

export const GROWTH_ZH = { fast: '快', medium: '中等', 'medium-slow': '较慢', slow: '慢' };

export const STAT_ZH = { hp: 'HP', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };

export const ITEM_ZH = {
  'fire-stone': '火之石', 'water-stone': '水之石', 'thunder-stone': '雷之石',
  'leaf-stone': '叶之石', 'moon-stone': '月之石', 'sun-stone': '日之石',
  'ice-stone': '冰之石', 'trade-cable': '通信电缆',
};

export const ITEM_DESC = {
  'fire-stone': '让特定宝可梦进化的神奇石头。',
  'water-stone': '让特定宝可梦进化的神奇石头。',
  'thunder-stone': '让特定宝可梦进化的神奇石头。',
  'leaf-stone': '让特定宝可梦进化的神奇石头。',
  'moon-stone': '让特定宝可梦进化的神奇石头。',
  'sun-stone': '让特定宝可梦进化的神奇石头。',
  'ice-stone': '让特定宝可梦进化的神奇石头。',
  'trade-cable': '模拟通信交换，触发通信进化。',
};

export const STONE_ITEMS = ['fire-stone', 'water-stone', 'thunder-stone', 'leaf-stone', 'moon-stone', 'sun-stone', 'ice-stone'];

// 道具图标：用游戏内道具像素图（tools/fetch-item-sprites.mjs 下载到 data/items/）
// 本站道具 id → PokeAPI sprites/items 里的文件名；本地缺图时回退 jsDelivr
export const ITEM_SPRITE_SLUG = {
  'fire-stone': 'fire-stone',
  'water-stone': 'water-stone',
  'thunder-stone': 'thunder-stone',
  'leaf-stone': 'leaf-stone',
  'moon-stone': 'moon-stone',
  'sun-stone': 'sun-stone',
  'ice-stone': 'ice-stone',
  // 第一世代没有通信电缆，借用第八世代“联系绳”的官方图标
  'trade-cable': 'linking-cord',
};

export const itemSprite = (item) => `data/items/${item}.png`;

export function remoteItemSprite(item) {
  const slug = ITEM_SPRITE_SLUG[item] || item;
  return `https://gcore.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/${slug}.png`;
}

export function itemIcon(item, size = 16) {
  // 石头是 30×30 像素画，用最近邻放大更清晰；通信电缆是 128×128 的绘制图，保持平滑
  const render = item === 'trade-cable' ? 'smooth' : 'pixel';
  return `<img class="item-ico ${render}" width="${size}" height="${size}" src="${itemSprite(item)}" alt="" onerror="this.onerror=null;this.src='${remoteItemSprite(item)}'" />`;
}

// 手工数据修正：PokeAPI 把尼多娜 / 尼多后标成「未发现蛋组」（第二世代起的设定），
// 结果是尼多兰 Lv.16 自动进化后永久失去繁育能力，放进培育栏还会打死配偶，
// 而雄性线（尼多朗→尼多力诺→尼多王）完全不受影响。
// 这里把雌性线拉回与雄性线一致的 monster / ground，保住玩家体验。
// dex.json 重新生成时由这里覆盖，不会被 fetch-data.mjs 冲掉。
export const EGG_GROUP_OVERRIDES = {
  30: ['monster', 'ground'], // 尼多娜
  31: ['monster', 'ground'], // 尼多后
};

export function initDex(json) {
  DEX.species = json.species;
  for (const [id, groups] of Object.entries(EGG_GROUP_OVERRIDES)) {
    const s = DEX.species[id];
    if (s) s.eggGroups = [...groups];
  }
  DEX.natures = json.natures;
  DEX.count = json.count;
  return DEX;
}

export const sp = (id) => DEX.species[id] || DEX.species[String(id)];
export const allSpecies = () => Object.values(DEX.species);
export const natureById = (id) => DEX.natures.find((n) => n.id === id) || DEX.natures[0];

export function bst(idOrMon) {
  const s = sp(idOrMon.dexId ?? idOrMon);
  if (!s) return 0;
  return Object.values(s.stats).reduce((a, b) => a + b, 0);
}

export function growthMultiplier(growth) {
  return { fast: 0.85, medium: 1, 'medium-slow': 1.15, slow: 1.3 }[growth] ?? 1;
}

export const typeZh = (t) => TYPES_ZH[t] || t;
export const typeColor = (t) => TYPE_COLORS[t] || '#888';
export const eggZh = (g) => EGG_ZH[g] || g;

export function sprite(id, shiny = false) {
  // 闪光个体使用本地闪光图，避免运行时依赖外部 CDN。
  return shiny ? `data/sprites/shiny/${id}.png` : `data/sprites/${id}.png`;
}

// 本地图缺失时的兜底：走 jsDelivr 镜像
export function remoteSprite(id, shiny = false) {
  const folder = shiny ? 'shiny/' : '';
  return `https://gcore.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${folder}${id}.png`;
}

export const art = (id, shiny = false) => sprite(id, shiny);
// 实际能力值（含个体值、性格修正）
export function calcStats(mon) {
  const s = sp(mon.dexId);
  if (!s) return {};
  const nat = natureById(mon.nature);
  const out = {};
  for (const key of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
    const base = s.stats[key] ?? 0;
    const iv = mon.ivs?.[key] ?? 0;
    let v = Math.floor(((2 * base + iv) * mon.level) / 100) + 5;
    if (key === 'hp') v += mon.level + 10;
    if (nat?.plus === mapStatName(key)) v = Math.floor(v * 1.1);
    if (nat?.minus === mapStatName(key)) v = Math.floor(v * 0.9);
    out[key] = v;
  }
  return out;
}

function mapStatName(key) {
  return { hp: 'hp', atk: 'attack', def: 'defense', spa: 'special-attack', spd: 'special-defense', spe: 'speed' }[key];
}
