// 纯逻辑层：不接触 DOM，可被 Node 直接测试
import { DEX, sp, bst, growthMultiplier, natureById, STONE_ITEMS, typeZh, ITEM_ZH } from './data.mjs';

export const CONFIG = {
  secondsPerDay: 12,
  startGold: 1800,
  startBerries: 12,
  startPens: 3,
  maxPens: 8,
  maxLevel: 60,
  breedDays: 2.5,
  feedExp: 100,
  penExpPerSec: 26,
  idleExpPerSec: 7,
  berryBasePrice: 14,
  orderIntervalDays: 2.4,
  orderDeadlineMin: 6,
  orderDeadlineMax: 14,
  maxEggsBase: 2,
  labSlotsBase: 2,
  labSlotsMax: 4,
  toleranceBase: 100,
  saveKey: 'rocket-simulator-save-v2',
};

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// ---------- 随机数（可存档的线性同余） ----------
function random(state) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
const randInt = (state, min, max) => min + Math.floor(random(state) * (max - min + 1));
const pickOne = (state, arr) => arr[Math.floor(random(state) * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = (state) => `u${state.nextId++}`;

// ---------- 基础查询 ----------
export const monByUid = (state, u) => state.mons.find((m) => m.uid === u) || null;
export const penIndex = (state, u) => state.pens.findIndex((p) => p.a === u || p.b === u);
export const eggSlots = (state) => CONFIG.maxEggsBase + state.upgrades.incubator;
export const orderSlots = (state) => 2 + state.upgrades.advertising;

// ---------- 实验室：研究进度与耐受度 ----------
// atk / spa 属于内部数值，不展示给玩家；仅用于推导耐受度损耗
export const EXPERIMENTS = [
  { id: 'measure', name: '基础体测', atk: 10, spa: 10, progress: 4, cost: 0, desc: '量身高、称体重，记录最基础的数据。' },
  { id: 'sample', name: '组织采样', atk: 20, spa: 15, progress: 7, cost: 30, desc: '取一点鳞片或毛发作为样本。' },
  { id: 'battle', name: '对战测试', atk: 60, spa: 20, progress: 14, cost: 60, desc: '与训练机对战，观察出招与体力分配。' },
  { id: 'energy', name: '能量共鸣', atk: 20, spa: 65, progress: 15, cost: 90, desc: '用仪器激发特殊能量，记录波动。' },
  { id: 'stress', name: '极限实验', atk: 90, spa: 90, progress: 32, cost: 150, desc: '把各项指标同时推到极限。' },
];

export const RESEARCH_BASE = 40;
export const RESEARCH_RARITY = 1.4;

// 稀有度决定研究要求：越稀有越难解锁
export function researchRequirement(dexId) {
  const s = sp(dexId);
  const capture = s?.captureRate ?? 255;
  return Math.round(RESEARCH_BASE + (255 - capture) * RESEARCH_RARITY);
}

export const researchProgress = (state, dexId) => state.research?.[dexId] || 0;

export function researchPercent(state, dexId) {
  const req = researchRequirement(dexId);
  return req <= 0 ? 100 : Math.min(100, Math.round((researchProgress(state, dexId) / req) * 100));
}

export const isResearched = (state, dexId) => researchProgress(state, dexId) >= researchRequirement(dexId);

export function addResearch(state, dexId, amount) {
  const id = Number(dexId);
  if (!state.research) state.research = {};
  const before = isResearched(state, id);
  state.research[id] = Math.max(0, (state.research[id] || 0) + amount);
  const after = isResearched(state, id);
  if (!before && after && !state.dex.includes(id)) state.dex.push(id);
  return { unlocked: !before && after, percent: researchPercent(state, id) };
}

// 耐受度损耗：物理项吃防御、特殊项吃特防；结果对外隐藏
export function toleranceLoss(mon, experiment) {
  const s = sp(mon.dexId);
  const def = s?.stats?.def ?? 50;
  const spd = s?.stats?.spd ?? 50;
  const phys = (experiment.atk * 120) / (120 + def);
  const spec = (experiment.spa * 120) / (120 + spd);
  return Math.max(1, Math.ceil((phys + spec) / 12));
}

export const labIndex = (state, u) => state.lab.findIndex((slot) => slot.uid === u);
export const labContains = (state, u) => labIndex(state, u) !== -1;
export const labSlots = (state) => state.lab.length;

export function expNeeded(level, growth) {
  return Math.round((30 + level * 10) * growthMultiplier(growth));
}

function valueOf(dexId) {
  const s = sp(dexId);
  if (!s) return 0;
  return Math.round(200 + bst(dexId) * 0.9 + (255 - s.captureRate) * 1.2);
}
export const monValue = (mon) => Math.round(valueOf(mon.dexId) * (0.85 + mon.level * 0.015));
export const sellPrice = (mon) => Math.round(monValue(mon) * 0.45);

export function genderFromRate(state, rate) {
  if (rate === -1) return 'x';
  if (rate === 0) return 'm';
  if (rate === 8) return 'f';
  return random(state) < rate / 8 ? 'f' : 'm';
}

export const genderZh = (g) => ({ m: '♂', f: '♀', x: '—' }[g] || '—');

// ---------- 宝可梦生成 ----------
export function createMon(state, dexId, level = 1, opts = {}) {
  const s = sp(dexId);
  const ivs = {};
  for (const k of STAT_KEYS) ivs[k] = opts.ivs?.[k] ?? randInt(state, 0, 31);
  return {
    uid: uid(state),
    dexId: Number(dexId),
    level,
    exp: 0,
    nature: opts.nature ?? pickOne(state, DEX.natures).id,
    gender: opts.gender ?? genderFromRate(state, s.genderRate),
    ability: opts.ability ?? pickOne(state, s.abilities),
    ivs,
    tolerance: CONFIG.toleranceBase,
    origin: opts.origin ?? 'egg',
    born: Math.floor(state.day),
  };
}

export function newGame(seed = (Date.now() % 2147483647) || 7) {
  const state = {
    v: 2,
    seed,
    day: 1,
    gold: CONFIG.startGold,
    berries: CONFIG.startBerries,
    rep: 0,
    berryPrice: CONFIG.berryBasePrice,
    mons: [],
    pens: Array.from({ length: CONFIG.startPens }, () => ({ a: null, b: null, breed: 0 })),
    lab: Array.from({ length: CONFIG.labSlotsBase }, () => ({ uid: null })),
    eggs: [],
    orders: [],
    market: [],
    inventory: { 'fire-stone': 0, 'water-stone': 0, 'thunder-stone': 0, 'leaf-stone': 0, 'moon-stone': 0 },
    upgrades: { pens: CONFIG.startPens, lab: CONFIG.labSlotsBase, incubator: 0, feeder: 0, advertising: 0, training: 0 },
    research: {},
    dex: [],
    stats: { earned: 0, spent: 0, delivered: 0, expired: 0, bred: 0, hatched: 0, experiments: 0, released: 0 },
    nextId: 1,
    log: [],
    feederTimer: 0,
    won: false,
    wonDay: null,
  };

  const male = createMon(state, 16, 5, { gender: 'm', origin: 'starter' });
  const female = createMon(state, 21, 5, { gender: 'f', origin: 'starter' });
  state.mons.push(male, female);
  state.pens[0].a = male.uid;
  state.pens[0].b = female.uid;
  refreshMarket(state);
  while (state.orders.length < orderSlots(state)) state.orders.push(makeOrder(state));
  return state;
}

// ---------- 经验与进化 ----------
function gainExp(state, mon, amount, events) {
  if (!amount || mon.level >= CONFIG.maxLevel) return;
  mon.exp += amount;
  let guard = 0;
  while (guard++ < 80) {
    const s = sp(mon.dexId);
    const need = expNeeded(mon.level, s.growthRate);
    if (mon.exp < need || mon.level >= CONFIG.maxLevel) break;
    mon.exp -= need;
    mon.level += 1;
    events.push({ type: 'level', msg: `${s.zh} 升到了 Lv.${mon.level}` });
    const evo = evoPlanFor(state, mon).find((p) => p.kind === 'level' && p.ready && p.minLevel);
    if (evo) doEvolve(state, mon, evo, events);
  }
}

function pickDetail(details) {
  const stoneRank = (item) => {
    const order = ['fire-stone', 'water-stone', 'thunder-stone', 'leaf-stone', 'moon-stone', 'sun-stone', 'ice-stone'];
    const i = order.indexOf(item);
    return i === -1 ? 99 : i;
  };
  const levelUp = details.filter((d) => d.trigger === 'level-up' && d.minLevel);
  if (levelUp.length) return levelUp.sort((a, b) => a.minLevel - b.minLevel)[0];
  const stones = details.filter((d) => d.trigger === 'use-item' && STONE_ITEMS.includes(d.item));
  if (stones.length) return stones.sort((a, b) => stoneRank(a.item) - stoneRank(b.item))[0];
  const trade = details.find((d) => d.trigger === 'trade');
  if (trade) return trade;
  return null;
}

export function evoPlanFor(state, mon) {
  const s = sp(mon.dexId);
  if (!s) return [];
  const plans = [];
  for (const e of s.evolvesTo) {
    if (!sp(e.id)) continue;
    const det = pickDetail(e.details);
    if (!det) continue;
    const kind = det.trigger === 'level-up' ? 'level' : det.trigger === 'use-item' ? 'item' : det.trigger === 'trade' ? 'trade' : null;
    if (!kind) continue;
    const ready =
      kind === 'level'
        ? mon.level >= (det.minLevel || 1)
        : kind === 'item'
        ? (state.inventory[det.item] || 0) > 0
        : (state.inventory['trade-cable'] || 0) > 0;
    plans.push({ toId: e.id, kind, item: det.item || null, minLevel: det.minLevel || null, ready });
  }
  return plans;
}

function doEvolve(state, mon, plan, events) {
  const from = sp(mon.dexId);
  const to = sp(plan.toId);
  if (!to) return;
  mon.dexId = plan.toId;
  if (!to.abilities.includes(mon.ability)) mon.ability = to.abilities[0];
  events.push({ type: 'evolve', msg: `${from.zh} 进化成了 ${to.zh}！` });
}

export function evolveWithItem(state, mon, plan) {
  const events = [];
  if (!plan || !plan.ready) return { ok: false, msg: '条件不足' };
  if (plan.kind === 'item') {
    if ((state.inventory[plan.item] || 0) <= 0) return { ok: false, msg: '没有对应的进化石' };
    state.inventory[plan.item] -= 1;
  } else if (plan.kind === 'trade') {
    if ((state.inventory['trade-cable'] || 0) <= 0) return { ok: false, msg: '没有通信电缆' };
    state.inventory['trade-cable'] -= 1;
  } else {
    return { ok: false, msg: '该进化不需要道具' };
  }
  doEvolve(state, mon, plan, events);
  const win = checkVictory(state);
  if (win) events.push(win);
  return { ok: true, msg: events[0]?.msg || '进化成功', events };
}

// 胜利条件：集齐第一世代 151 只图鉴
export function checkVictory(state) {
  if (state.won) return null;
  if (state.dex.length < DEX.count) return null;
  state.won = true;
  state.wonDay = Math.floor(state.day);
  return { type: 'win', msg: '图鉴完成！151 只宝可梦已全部记录在案。' };
}

// ---------- 配种 ----------
const isDitto = (mon) => mon.dexId === 132;

export function compatibility(state, a, b) {
  if (!a || !b) return { ok: false, reason: '需要两只宝可梦' };
  if (a.uid === b.uid) return { ok: false, reason: '不能和自己配种' };
  const sa = sp(a.dexId);
  const sb = sp(b.dexId);
  const da = isDitto(a);
  const db = isDitto(b);
  if (da && db) return { ok: false, reason: '百变怪之间无法配种' };
  const groupsA = sa.eggGroups || [];
  const groupsB = sb.eggGroups || [];
  if (!da && groupsA.includes('no-eggs')) return { ok: false, reason: `${sa.zh} 属于未发现蛋组` };
  if (!db && groupsB.includes('no-eggs')) return { ok: false, reason: `${sb.zh} 属于未发现蛋组` };
  if (!da && !db) {
    if (a.gender === 'x' || b.gender === 'x') return { ok: false, reason: '无性别的宝可梦无法配种' };
    if (a.gender === b.gender) return { ok: false, reason: '需要一雄一雌' };
    if (!groupsA.some((g) => groupsB.includes(g))) return { ok: false, reason: '蛋组不匹配' };
  }
  return { ok: true, reason: '可以配种' };
}

// 蛋永远孵出最初形态：沿 evolvesFrom 链回溯到根
export function baseDexId(dexId) {
  let id = Number(dexId);
  const s0 = sp(id);
  if (!s0) return id;
  const seen = new Set([id]);
  let s = s0;
  while (s?.evolvesFrom?.id) {
    const parentId = Number(s.evolvesFrom.id);
    if (seen.has(parentId) || !sp(parentId)) break;
    seen.add(parentId);
    id = parentId;
    s = sp(id);
  }
  return id;
}

function childSpecies(a, b) {
  const da = isDitto(a);
  const db = isDitto(b);
  if (da && db) return null;
  const parent = da ? b : db ? a : a.gender === 'f' ? a : b;
  return baseDexId(parent.dexId);
}

export function hatchDays(state, dexId) {
  const s = sp(dexId);
  const base = clamp((s?.hatchCounter ?? 20) / 6, 2, 10);
  return Math.max(1, +(base * (1 - 0.1 * state.upgrades.incubator)).toFixed(2));
}

function createEgg(state, dexId, parents) {
  const s = sp(dexId);
  const ivs = {};
  for (const k of STAT_KEYS) {
    const base = parents ? (parents[0].ivs[k] + parents[1].ivs[k]) / 2 : 15;
    ivs[k] = clamp(Math.round(base + (random(state) * 10 - 5)), 0, 31);
  }
  const nature = parents ? pickOne(state, [parents[0].nature, parents[1].nature]) : pickOne(state, DEX.natures).id;
  const total = hatchDays(state, dexId);
  const egg = {
    uid: uid(state),
    dexId,
    daysLeft: total,
    total,
    ivs,
    nature,
    gender: genderFromRate(state, s.genderRate),
    ability: pickOne(state, s.abilities),
  };
  state.eggs.push(egg);
  return egg;
}

function hatch(state, egg, events) {
  const dexId = egg.dexId;
  const s = sp(dexId);
  const mon = createMon(state, dexId, 1, {
    ivs: egg.ivs,
    nature: egg.nature,
    gender: egg.gender,
    ability: egg.ability,
    origin: 'egg',
  });
  mon.uid = egg.uid;
  state.mons.push(mon);
  if (!labContains(state, mon.uid)) {
    const freePen = state.pens.find((p) => !p.a || !p.b);
    if (freePen) {
      if (!freePen.a) freePen.a = mon.uid;
      else freePen.b = mon.uid;
    }
  }
  state.stats.hatched += 1;
  state.eggs = state.eggs.filter((e) => e.uid !== egg.uid);
  events.push({ type: 'egg', msg: `蛋孵化了：${s.zh}！` });
  return mon;
}

// ---------- 市场 ----------
function weightedSpecies(state, { exclude = [], baseOnly = false } = {}) {
  const pool = Object.values(DEX.species).filter(
    (s) =>
      !s.legendary &&
      !s.mythical &&
      !s.eggGroups.includes('no-eggs') &&
      !exclude.includes(s.id) &&
      (!baseOnly || !s.evolvesFrom)
  );
  let total = 0;
  const weights = pool.map((s) => {
    const w = 1 / (1 + bst(s.id) / 220);
    total += w;
    return w;
  });
  let r = random(state) * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i].id;
  }
  return pool[0].id;
}

export function refreshMarket(state) {
  const offers = [];
  const wanted = state.orders.filter((o) => o.kind === 'species' && o.dexId).map((o) => baseDexId(o.dexId));
  if (wanted.length) offers.push(makeOffer(state, pickOne(state, wanted)));
  while (offers.length < 3) offers.push(makeOffer(state, weightedSpecies(state, { baseOnly: true })));
  state.market = offers;
  state.berryPrice = clamp(+(state.berryPrice * (0.92 + random(state) * 0.16)).toFixed(1), 8, 30);
}

function makeOffer(state, dexId) {
  return { dexId, price: Math.round(valueOf(dexId) * (0.95 + random(state) * 0.2)) };
}

export function buyEggOffer(state, idx) {
  const offer = state.market[idx];
  if (!offer) return { ok: false, msg: '该商品已售出' };
  if (state.eggs.length >= eggSlots(state)) return { ok: false, msg: '孵化器已满' };
  if (state.gold < offer.price) return { ok: false, msg: '资金不足' };
  state.gold -= offer.price;
  state.stats.spent += offer.price;
  createEgg(state, offer.dexId, null);
  state.market.splice(idx, 1);
  return { ok: true, msg: `购买了一枚 ${sp(offer.dexId).zh} 的蛋` };
}

export function buyBerries(state, qty) {
  const cost = Math.round(qty * state.berryPrice);
  if (state.gold < cost) return { ok: false, msg: '资金不足' };
  state.gold -= cost;
  state.stats.spent += cost;
  state.berries += qty;
  return { ok: true, msg: `购买了 ${qty} 个树果（-${cost} 资金）` };
}

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

export function buyItem(state, item) {
  const price = ITEM_PRICES[item];
  if (!price) return { ok: false, msg: '该道具不出售' };
  if (state.gold < price) return { ok: false, msg: '资金不足' };
  state.gold -= price;
  state.stats.spent += price;
  state.inventory[item] = (state.inventory[item] || 0) + 1;
  return { ok: true, msg: `购买了 1 个${ITEM_ZH[item] ?? item}`, item };
}

// ---------- 订单 ----------
// 订单来自火箭队各部门，语气与需求方不同
export const DEPARTMENTS = [
  { id: 'logistics', name: '后勤部', note: '给基地补货，什么能用就收' },
  { id: 'research', name: '研究部', note: '博士的实验样品' },
  { id: 'security', name: '警卫队', note: '看门护院要能打的' },
  { id: 'comms', name: '通讯部', note: '电系宝可梦能干扰信号' },
  { id: 'smuggle', name: '走私组', note: '稀有货越好出手' },
  { id: 'field', name: '外勤组', note: '野外行动需要可靠伙伴' },
];

export function makeOrder(state) {
  const roll = random(state);
  const kind = roll < 0.45 ? 'any' : roll < 0.8 ? 'type' : 'species';
  let dexId = null;
  let type = null;
  if (kind === 'species') dexId = weightedSpecies(state);
  if (kind === 'type') {
    const s = sp(weightedSpecies(state));
    type = pickOne(state, s.types);
  }
  const rare = dexId ? sp(dexId).captureRate < 90 : kind === 'type' && random(state) < 0.3;
  const lowBias = Math.pow(random(state), 1.6);
  const minLevel = clamp(6 + Math.round(lowBias * (rare ? 30 : 22)), 1, CONFIG.maxLevel - 5);
  const needNature = random(state) < 0.16 ? pickOne(state, DEX.natures).id : 0;

  const levelPart = 150 + minLevel * 50;
  const rarity = dexId ? (255 - sp(dexId).captureRate) * 1.0 : 0;
  const kindFactor = kind === 'any' ? 1 : kind === 'type' ? 1.2 : 1.45;
  let reward = (levelPart + rarity) * kindFactor * (1 + state.rep * 0.01) * (1 + 0.12 * state.upgrades.advertising);
  if (needNature) reward *= 1.15;

  const deadlineDays = 5 + minLevel * 0.35 + random(state) * 4;
  return {
    id: `o${state.nextId++}`,
    dept: pickOne(state, DEPARTMENTS).id,
    kind,
    dexId,
    type,
    minLevel,
    needNature,
    reward: Math.round(reward),
    deadline: +(state.day + deadlineDays).toFixed(1),
    created: state.day,
  };
}

export function deptName(id) {
  return DEPARTMENTS.find((d) => d.id === id)?.name || '火箭队';
}

export function orderMatches(order, mon) {
  if (!mon) return false;
  if (mon.level < order.minLevel) return false;
  if (order.kind === 'species' && mon.dexId !== order.dexId) return false;
  if (order.kind === 'type') {
    const s = sp(mon.dexId);
    if (!s?.types.includes(order.type)) return false;
  }
  if (order.needNature && mon.nature !== order.needNature) return false;
  return true;
}

export function deliverableMons(state, order) {
  return state.mons
    .filter((m) => !labContains(state, m.uid) && orderMatches(order, m))
    .sort((a, b) => b.level - a.level);
}

export function deliver(state, orderId, uidMon) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, msg: '需求不存在' };
  const mon = monByUid(state, uidMon);
  if (!mon || !orderMatches(order, mon)) return { ok: false, msg: '这只宝可梦不满足条件' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦无法交付' };
  state.mons = state.mons.filter((m) => m.uid !== uidMon);
  for (const p of state.pens) {
    if (p.a === uidMon) p.a = null;
    if (p.b === uidMon) p.b = null;
  }
  state.gold += order.reward;
  state.stats.earned += order.reward;
  state.stats.delivered += 1;
  state.rep = clamp(state.rep + 4, 0, 100);
  state.orders = state.orders.filter((o) => o.id !== orderId);
  return { ok: true, msg: `交付成功，获得 ${order.reward} 资金（声望 +4）` };
}

export function abandonOrder(state, orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, msg: '需求不存在' };
  state.orders = state.orders.filter((o) => o.id !== orderId);
  state.rep = clamp(state.rep - 2, 0, 100);
  return { ok: true, msg: '已回绝该需求（声望 -2）' };
}

// ---------- 操作 ----------
export function feed(state, uidMon) {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦无法喂食' };
  if (state.berries <= 0) return { ok: false, msg: '没有树果了' };
  state.berries -= 1;
  const events = [];
  gainExp(state, mon, CONFIG.feedExp, events);
  return { ok: true, msg: `${sp(mon.dexId).zh} 吃下了树果（经验 +${CONFIG.feedExp}）`, events };
}

export function sellMon(state, uidMon) {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦无法出售' };
  const price = sellPrice(mon);
  state.mons = state.mons.filter((m) => m.uid !== uidMon);
  for (const p of state.pens) {
    if (p.a === uidMon) p.a = null;
    if (p.b === uidMon) p.b = null;
  }
  state.gold += price;
  state.stats.earned += price;
  return { ok: true, msg: `卖出了 ${sp(mon.dexId).zh}，获得 ${price} 资金` };
}

export function assignPen(state, penIdx, slot, uidMon) {
  const pen = state.pens[penIdx];
  if (!pen) return { ok: false, msg: '栏位不存在' };
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦不能进培育栏' };
  const current = penIndex(state, uidMon);
  if (current !== -1) {
    const p = state.pens[current];
    if (p.a === uidMon) p.a = null;
    if (p.b === uidMon) p.b = null;
    p.breed = 0;
  }
  const key = slot === 'b' ? 'b' : 'a';
  const occupant = pen[key];
  if (occupant && occupant !== uidMon) {
    const free = !pen.a ? 'a' : !pen.b ? 'b' : null;
    if (!free) return { ok: false, msg: '该栏位已满' };
    pen[free] = occupant;
  }
  pen[key] = uidMon;
  pen.breed = 0;
  return { ok: true, msg: `${sp(mon.dexId).zh} 进入栏位 ${penIdx + 1}` };
}

export function removeFromPen(state, uidMon) {
  const idx = penIndex(state, uidMon);
  if (idx === -1) return { ok: false, msg: '它不在栏位里' };
  const pen = state.pens[idx];
  if (pen.a === uidMon) pen.a = null;
  if (pen.b === uidMon) pen.b = null;
  pen.breed = 0;
  return { ok: true, msg: '已移出栏位' };
}

// ---------- 实验室操作 ----------
export function assignLab(state, slotIdx, uidMon) {
  const slot = state.lab[slotIdx];
  if (!slot) return { ok: false, msg: '实验室没有这个位置' };
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '它已经在实验室里了' };
  if (penIndex(state, uidMon) !== -1) return { ok: false, msg: '请先从培育栏移出' };
  if (slot.uid) return { ok: false, msg: '该实验台已被占用' };
  slot.uid = uidMon;
  if (mon.tolerance == null) mon.tolerance = CONFIG.toleranceBase;
  return { ok: true, msg: `${sp(mon.dexId).zh} 被送进了实验室（只能实验或放生）` };
}

export function releaseMon(state, uidMon, reason = 'manual') {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  const name = sp(mon.dexId).zh;
  state.mons = state.mons.filter((m) => m.uid !== uidMon);
  for (const slot of state.lab) if (slot.uid === uidMon) slot.uid = null;
  for (const p of state.pens) {
    if (p.a === uidMon) p.a = null;
    if (p.b === uidMon) p.b = null;
  }
  state.stats.released = (state.stats.released || 0) + 1;
  const msg =
    reason === 'exhausted'
      ? `${name} 的耐受度耗尽，被放生了`
      : reason === 'overload'
      ? `${name} 没能承受住实验，被放生了`
      : `${name} 被放生了`;
  return { ok: true, msg, released: true, name };
}

export function startExperiment(state, uidMon, experimentId) {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (!labContains(state, uidMon)) return { ok: false, msg: '它不在实验室里' };
  const exp = EXPERIMENTS.find((e) => e.id === experimentId);
  if (!exp) return { ok: false, msg: '没有这个实验' };
  if (state.gold < exp.cost) return { ok: false, msg: '资金不足' };

  const loss = toleranceLoss(mon, exp);

  // 超出耐受：实验不生效（不扣资金、不给进度），宝可梦放生
  if (loss > mon.tolerance) {
    const r = releaseMon(state, uidMon, 'overload');
    return {
      ok: true,
      released: true,
      msg: `实验超出了 ${r.name} 的耐受极限，数据没来得及记录，宝可梦被放生`,
    };
  }

  state.gold -= exp.cost;
  state.stats.spent += exp.cost;
  state.stats.experiments = (state.stats.experiments || 0) + 1;
  mon.tolerance -= loss;
  const res = addResearch(state, mon.dexId, exp.progress);
  const name = sp(mon.dexId).zh;
  const events = [];
  if (res.unlocked) events.push({ type: 'research', msg: `${name} 的图鉴条目研究完成！` });
  const win = checkVictory(state);
  if (win) events.push(win);

  if (mon.tolerance <= 0) {
    releaseMon(state, uidMon, 'exhausted');
    events.push({ type: 'warn', msg: `${name} 的耐受度耗尽，已放生` });
    return { ok: true, released: true, events, msg: `实验完成，${name} 的耐受度耗尽，被放生了` };
  }

  return { ok: true, events, msg: `实验完成（${exp.name}）` };
}

// ---------- 设施 ----------
export const UPGRADE_INFO = {
  pens: { name: '培育栏', max: 8, costs: [0, 0, 0, 2500, 5000, 9000, 15000, 24000], desc: '增加可同时培育的空间' },
  lab: { name: '实验台', max: 4, costs: [0, 0, 2000, 5000, 10000], desc: '增加实验室可同时研究的宝可梦' },
  incubator: { name: '孵化器', max: 4, costs: [0, 1200, 2600, 5000, 9000], desc: '每个等级加快 10% 孵化，并 +1 蛋位' },
  feeder: { name: '自动喂食器', max: 3, costs: [0, 1500, 3500, 7000], desc: '自动消耗树果喂养栏位中的宝可梦' },
  advertising: { name: '广告牌', max: 3, costs: [0, 2000, 4500, 8500], desc: '提升订单报酬，并 +1 订单位' },
  training: { name: '训练场', max: 3, costs: [0, 1800, 4000, 8000], desc: '提升被动经验获取速度' },
};

export function upgradeCost(state, key) {
  const info = UPGRADE_INFO[key];
  const lvl = key === 'pens' ? state.pens.length : key === 'lab' ? state.lab.length : state.upgrades[key];
  if (!info || lvl >= info.max) return null;
  return info.costs[lvl] ?? null;
}

export function buyUpgrade(state, key) {
  const cost = upgradeCost(state, key);
  if (cost == null) return { ok: false, msg: '已达最高等级' };
  if (state.gold < cost) return { ok: false, msg: '资金不足' };
  state.gold -= cost;
  state.stats.spent += cost;
  if (key === 'pens') {
    state.pens.push({ a: null, b: null, breed: 0 });
  } else if (key === 'lab') {
    state.lab.push({ uid: null });
  } else {
    state.upgrades[key] += 1;
  }
  return { ok: true, msg: `升级成功：${UPGRADE_INFO[key].name}`, cost };
}

// ---------- 时间推进 ----------
export function tick(state, dtDays) {
  if (!(dtDays > 0)) return [];
  const events = [];
  const startDay = state.day;
  state.day += dtDays;
  const secs = dtDays * CONFIG.secondsPerDay;

  // 被动经验
  const inPen = new Set();
  for (const p of state.pens) {
    if (p.a) inPen.add(p.a);
    if (p.b) inPen.add(p.b);
  }
  const boost = 1 + 0.5 * state.upgrades.training;
  const labUids = new Set(state.lab.map((slot) => slot.uid).filter(Boolean));
  for (const mon of state.mons) {
    if (labUids.has(mon.uid)) continue;
    const rate = (inPen.has(mon.uid) ? CONFIG.penExpPerSec : CONFIG.idleExpPerSec) * boost;
    gainExp(state, mon, rate * secs, events);
  }

  // 配种
  for (const pen of state.pens) {
    const a = monByUid(state, pen.a);
    const b = monByUid(state, pen.b);
    const compat = compatibility(state, a, b);
    if (!compat.ok) {
      pen.breed = 0;
      continue;
    }
    pen.breed += dtDays;
    if (pen.breed >= CONFIG.breedDays) {
      if (state.eggs.length < eggSlots(state)) {
        const dexId = childSpecies(a, b);
        if (dexId) {
          createEgg(state, dexId, [a, b]);
          state.stats.bred += 1;
          events.push({ type: 'egg', msg: `配种成功：孵化器中多了一枚 ${sp(dexId).zh} 的蛋` });
        }
        pen.breed = 0;
      } else {
        pen.breed = CONFIG.breedDays;
      }
    }
  }

  // 孵化
  for (const egg of [...state.eggs]) {
    egg.daysLeft -= dtDays;
    if (egg.daysLeft <= 0) hatch(state, egg, events);
  }

  // 自动喂食
  if (state.upgrades.feeder > 0) {
    const interval = [0, 14, 9, 6][state.upgrades.feeder];
    state.feederTimer += secs;
    const due = Math.floor(state.feederTimer / interval);
    if (due > 0) {
      state.feederTimer -= due * interval;
      const penMons = state.mons.filter((m) => inPen.has(m.uid));
      for (let i = 0; i < due && state.berries > 0 && penMons.length; i++) {
        const target = penMons[i % penMons.length];
        state.berries -= 1;
        target.exp += 40;
        gainExp(state, target, 0, events);
      }
    }
  }

  // 订单过期
  const expired = state.orders.filter((o) => o.deadline <= state.day);
  if (expired.length) {
    state.orders = state.orders.filter((o) => o.deadline > state.day);
    state.stats.expired += expired.length;
    state.rep = clamp(state.rep - 2 * expired.length, 0, 100);
    for (const o of expired) events.push({ type: 'warn', msg: `需求过期：${orderRequirementText(o)}（声望 -2）` });
  }

  // 跨天：刷新市场、补订单
  if (Math.floor(state.day) > Math.floor(startDay)) {
    refreshMarket(state);
  }
  while (state.orders.length < orderSlots(state) && random(state) < Math.min(1, dtDays / CONFIG.orderIntervalDays)) {
    state.orders.push(makeOrder(state));
  }

  const win = checkVictory(state);
  if (win) events.push(win);

  return events;
}

// ---------- 存档 ----------
export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(raw) {
  try {
    const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // 只接受当前版本存档，旧存档直接忽略（重开新档）
    if (!st || st.v !== 2 || !Array.isArray(st.mons)) return null;
    st.pens = st.pens || [];
    st.lab = st.lab || [];
    st.eggs = st.eggs || [];
    st.orders = st.orders || [];
    st.market = st.market || [];
    st.inventory = st.inventory || {};
    st.research = st.research || {};
    st.dex = st.dex || [];
    st.stats = st.stats || {};
    st.rep = st.rep ?? 0;
    st.berryPrice = st.berryPrice ?? CONFIG.berryBasePrice;
    st.feederTimer = st.feederTimer || 0;
    st.upgrades = {
      pens: st.pens.length,
      lab: st.lab.length,
      incubator: 0,
      feeder: 0,
      advertising: 0,
      training: 0,
      ...(st.upgrades || {}),
    };
    st.mons.forEach((m) => {
      if (m.tolerance == null) m.tolerance = CONFIG.toleranceBase;
    });
    st.won = !!st.won;
    st.wonDay = st.wonDay ?? null;
    return st;
  } catch {
    return null;
  }
}

// ---------- 展示辅助 ----------
export function orderRequirementText(order) {
  const head =
    order.kind === 'any' ? '任意宝可梦' : order.kind === 'type' ? `${typeZh(order.type)}属性宝可梦` : sp(order.dexId).zh;
  const parts = [head, `Lv.${order.minLevel}+`];
  if (order.needNature) parts.push(`${natureById(order.needNature).zh}性格`);
  return parts.join(' · ');
}

export function formatDays(d) {
  if (d <= 0) return '已到期';
  return `${d.toFixed(1)} 天`;
}
