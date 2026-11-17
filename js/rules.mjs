// 规则数据层：数值、文案、静态表与纯函数。
// 这里不依赖运行时状态，也不 import 逻辑层；调参优先改这个文件。

export const SAVE_VERSION = 3;

export const CONFIG = {
  secondsPerDay: 12,
  startGold: 1800,
  startCandies: 12,
  startPens: 3,
  maxPens: 8,
  maxLevel: 60,
  breedDays: 2.5,
  feedExp: 100,
  penExpPerSec: 26,
  idleExpPerSec: 7,
  candyBasePrice: 14,
  orderIntervalDays: 2.4,
  // 总裁办订单的出现概率：初始极低，每提升一级职级小幅增加
  boardOrderBase: 0.02,
  boardOrderPerRank: 0.012,
  orderDeadlineMin: 6,
  orderDeadlineMax: 14,
  // 部门需求金币倍率：普通部门大幅下调，总裁办上调
  orderRewardMultiplier: 0.4,
  boardOrderRewardMultiplier: 3.2,
  // 实验室处理费用：活体按剩余耐受度计价，遗体固定少量费用
  labProcessBase: 8,
  labProcessPerTolerance: 0.12,
  labCorpseProcessCost: 6,
  // 声望闲置流失：距上次完成订单超过阈值后，按天流失，速度随时间加快
  repDecayStart: 3,
  repDecayBase: 0.5,
  repDecayRamp: 0.1,
  maxEggsBase: 2,
  labSlotsBase: 2,
  labSlotsMax: 4,
  toleranceBase: 100,
  // 耐受度上限随等级增长：Lv.1 为 100，每级 +2
  tolerancePerLevel: 2,
  // 雄性个体更耐折腾：同物种、同等级的 1.25 倍
  maleToleranceFactor: 1.25,
  // 正常繁育：承担损耗的一方（母体；无雌性时是百变怪）每次产蛋消耗的耐受度
  breedToleranceCost: 32,
  // 个体出生时的稀有特质：闪光 1/4096，不孕/不育 2/4096（约为闪光两倍）
  shinyChance: 1 / 4096,
  sterileChance: 2 / 4096,
  // 围栏霸凌：同种同性达到 4 只后，最弱者每多 1 只每天额外损耗的耐受度
  bullyMinGroup: 4,
  bullyRatePerExtraDay: 3,
  idleCorpseProcessCost: 6,
  // 培育栏里死亡（争斗/力竭）会留下遗体并占住该位置，处理费固定 6 资金
  penCorpseProcessCost: 6,
  // 实验室挣扎：耐受度高于该值时缓慢下降
  labStruggleThreshold: 70,
  labStrugglePerDay: 2,
  // 高损耗实验会惊吓同实验室的其他个体
  threatLossRatio: 0.5,
  threatToleranceRatio: 0.06,
  threatMinToleranceRatio: 0.1,
  // 繁育失败时，留在栏位里的那只会掉这么多耐受度
  fightToleranceLoss: 28,
  // 花钱让蛋贩子再送一批蛋
  marketRefreshCost: 60,
  // 蛋贩子换货：每换一次更贵，但价格会随天数回落；每两周自动换货
  marketRefreshIntervalDays: 14,
  marketRefreshStep: 25,
  marketRefreshDecayPerDay: 8,
  marketRefreshMax: 300,
  // 实验行为的总体资金消耗倍率（在基础/档位原始价格上统一放大）
  experimentCostMultiplier: 1.5,
  // 实验室命中动效的损耗基准：损耗达到该值时动效最烈
  experimentHitLossCap: 150,
  saveKey: 'rocket-simulator-save-v3',
};

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 职级 ----------
// 声望达标后花金币解锁；职级越高，能解锁的设施等级越高
export const RANKS = [
  { id: 0, name: '见习研究员', rep: 0, cost: 0, desc: '刚被“请”进地下基地的新人，只能打下手。' },
  { id: 1, name: '助理研究员', rep: 18, cost: 1000, desc: '开始独立照看培育栏与孵化器。' },
  { id: 2, name: '研究员', rep: 36, cost: 2800, desc: '能申请到更多实验设备。' },
  { id: 3, name: '高级研究员', rep: 55, cost: 6500, desc: '基地中层，说话开始有人听。' },
  { id: 4, name: '首席研究员', rep: 75, cost: 14000, desc: '博士之下，众人之上。' },
  { id: 5, name: '干部', rep: 92, cost: 26000, desc: '火箭队的核心成员，基地由你说了算。' },
];

export const rankById = (id) => RANKS[clamp(Math.round(Number(id) || 0), 0, RANKS.length - 1)];

// ---------- 实验 ----------
// 基础三条：专属实验不足 5 条时，按强度从高到低补入（对战 > 采样 > 体测）
// atk / spa 属于内部数值，不展示给玩家；仅用于推导耐受度损耗
export const BASE_EXPERIMENTS = [
  { id: 'measure', name: '基础体测', atk: 10, spa: 10, progress: 2, cost: 10, cd: 5, desc: '量身高、称体重，记录最基础的数据。' },
  { id: 'sample', name: '组织采样', atk: 20, spa: 15, progress: 4, cost: 30, cd: 10, desc: '用钳子从活体上硬扯下一块皮肉或甲壳，伤口不缝合，观察它疼到抽搐。' },
  { id: 'battle', name: '对战测试', atk: 60, spa: 20, progress: 8, cost: 60, cd: 16, desc: '让训练机反复把它打倒，直到身体发抖、站不起来，记录还能爬起几次。' },
];

export const BASE_FILL_ORDER = ['battle', 'sample', 'measure'];

// 专属实验档位：内容只写名称/描述/档位，数值统一在这里
export const EXPERIMENT_TIERS = {
  gentle: { progress: 3, cost: 20, cd: 6, atk: 12, spa: 12 },
  standard: { progress: 7, cost: 55, cd: 14, atk: 45, spa: 40 },
  harsh: { progress: 14, cost: 120, cd: 28, atk: 85, spa: 85 },
};

export const RESEARCH_BASE = 40;
export const RESEARCH_RARITY = 1.4;

// ---------- 耐受度 ----------
// 上限：等级越高越多，雄性额外 ×1.25
export function toleranceCap(level = 1, gender = 'x') {
  const base = CONFIG.toleranceBase + Math.max(0, Math.round(level) - 1) * CONFIG.tolerancePerLevel;
  return Math.round(base * (gender === 'm' ? CONFIG.maleToleranceFactor : 1));
}

export function maxTolerance(mon) {
  return toleranceCap(mon?.level ?? 1, mon?.gender);
}

// ---------- 市场 ----------
// 蛋的“来源”：符合火箭队做派的进货渠道。来源会跟着这只个体一辈子。
// 30 个地点 × 10 种手段 = 300 条完整来源描述。
const EGG_SOURCE_PLACES = [
  '黑市中间人手里',
  '走私船的货舱里',
  '偷猎者的营地',
  '地下拍卖会',
  '研究所后门',
  '训练家后院',
  '火箭队仓库的积压货里',
  '赏金猎人手里',
  '废弃的培育屋',
  '边境集市',
  '地下诊所',
  '非法繁殖场',
  '海关扣押仓库',
  '走私列车车厢',
  '黑市诊所',
  '地下仓库',
  '拍卖行后巷',
  '走私飞机的行李舱',
  '荒野偷猎点',
  '火箭队运输车',
  '被查封的动物园',
  '地下斗兽场',
  '走私客的背包',
  '偷渡渔船的冷藏舱',
  '保护区外围',
  '训练家旅行箱',
  '非法研究所的冷库',
  '黑市摊位',
  '走私码头的集装箱',
  '雇佣兵的据点',
];
const EGG_SOURCE_ACTIONS = ['弄来', '收来', '带走', '运出', '截下', '买下', '换来', '抢来', '偷出', '扣下'];
export const EGG_SOURCES = EGG_SOURCE_PLACES.flatMap((place) =>
  EGG_SOURCE_ACTIONS.map((action) => `从${place}${action}`)
);
export const BRED_SOURCE = '培育栏自产';

export const ITEM_PRICES = {
  'fire-stone': 520,
  'water-stone': 520,
  'thunder-stone': 520,
  'leaf-stone': 620,
  'moon-stone': 620,
  'sun-stone': 620,
  'ice-stone': 620,
  'trade-cable': 900,
};

// ---------- 部门 ----------
// 订单来自火箭队各部门，语气与需求方不同
export const DEPARTMENTS = [
  { id: 'logistics', name: '后勤部', note: '给基地补货，什么能用就收' },
  { id: 'research', name: '研究部', note: '博士自己的实验样品' },
  { id: 'security', name: '警卫队', note: '看门护院要能打的' },
  { id: 'comms', name: '通讯部', note: '电系宝可梦能干扰信号' },
  { id: 'smuggle', name: '走私组', note: '稀有货越好出手' },
  { id: 'field', name: '外勤组', note: '野外行动需要可靠伙伴' },
  { id: 'board', name: '总裁办', note: '总裁亲自过问的事，办砸了没人担得起', board: true },
];

export const BOARD_DEPT = 'board';

// ---------- 设施 ----------
// costs[l] / rankReq[l]：从第 l 级升到第 l+1 级的花费与职级门槛（下标 = 当前等级）。
// 所以数组长度必须等于 max（0 级…max-1 级各一项）；起始等级以下的条目只是占位
// （pens 从 3 级起、lab 从 2 级起）。
// 不要往尾部塞多余条目——那条永远取不到；也不要在 0 起点的设施前面补 0——首次升级会变免费。
export const UPGRADE_INFO = {
  pens: { name: '培育栏', max: 8, costs: [0, 0, 0, 2500, 5000, 9000, 15000, 24000], rankReq: [0, 0, 0, 1, 2, 3, 4, 5], desc: '增加可同时培育的空间' },
  lab: { name: '实验台', max: 4, costs: [0, 0, 2000, 5000], rankReq: [0, 0, 1, 3], desc: '增加实验室可同时研究的宝可梦' },
  incubator: { name: '孵化器', max: 4, costs: [1200, 2600, 5000, 9000], rankReq: [0, 1, 2, 3], desc: '每个等级加快 10% 孵化，并 +1 蛋位' },
  feeder: { name: '自动喂食器', max: 3, costs: [1500, 3500, 7000], rankReq: [0, 1, 3], desc: '自动消耗经验糖果喂养栏位中的宝可梦' },
  advertising: { name: '广告牌', max: 3, costs: [2000, 4500, 8500], rankReq: [0, 1, 3], desc: '提升订单报酬，并 +1 订单位' },
  training: { name: '训练场', max: 3, costs: [1800, 4000, 8000], rankReq: [0, 1, 2], desc: '提升被动经验获取速度' },
};
