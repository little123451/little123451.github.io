// 纯逻辑层：不接触 DOM，可被 Node 直接测试。
// 规则数据（数值 / 静态表）在 rules.mjs；本文件只负责状态推进与行为。
import { DEX, sp, bst, growthMultiplier, natureById, STONE_ITEMS, typeZh, ITEM_ZH, eggZh, customExperiments, experimentById, experimentResultsFor } from './data.mjs';
import {
  SAVE_VERSION,
  CONFIG,
  STAT_KEYS,
  RANKS,
  clamp,
  rankById,
  BASE_EXPERIMENTS,
  BASE_FILL_ORDER,
  EXPERIMENT_TIERS,
  RESEARCH_BASE,
  RESEARCH_RARITY,
  toleranceCap,
  maxTolerance,
  EGG_SOURCES,
  BRED_SOURCE,
  ITEM_PRICES,
  DEPARTMENTS,
  BOARD_DEPT,
  UPGRADE_INFO,
} from './rules.mjs';


// ---------- 随机数（可存档的线性同余） ----------
function random(state) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
const randInt = (state, min, max) => min + Math.floor(random(state) * (max - min + 1));
const pickOne = (state, arr) => arr[Math.floor(random(state) * arr.length)];
const uid = (state) => `u${state.nextId++}`;

// ---------- 基础查询 ----------
export const monByUid = (state, u) => state.mons.find((m) => m.uid === u) || null;
export const penIndex = (state, u) => state.pens.findIndex((p) => p.a === u || p.b === u);
export const eggSlots = (state) => CONFIG.maxEggsBase + state.upgrades.incubator;
export const orderSlots = (state) => 2 + state.upgrades.advertising;

// ---------- 派生查询（引擎与 UI 共用同一口径） ----------
function activeUids(state) {
  const set = new Set();
  for (const slot of state.lab) if (slot.uid) set.add(slot.uid);
  for (const pen of state.pens) {
    if (pen.a) set.add(pen.a);
    if (pen.b) set.add(pen.b);
  }
  return set;
}

// 围栏里的闲置个体：不在实验室、也不在培育栏
export function idleMons(state) {
  const active = activeUids(state);
  return state.mons.filter((m) => !active.has(m.uid));
}

// 培育栏里的个体（按栏位顺序平铺）
export function penMons(state) {
  const out = [];
  for (const pen of state.pens) {
    const a = monByUid(state, pen.a);
    const b = monByUid(state, pen.b);
    if (a) out.push(a);
    if (b) out.push(b);
  }
  return out;
}

// ---------- 职级 ----------
export const currentRank = (state) => rankById(state.rank ?? 0);
export const nextRank = (state) => RANKS[(state.rank ?? 0) + 1] || null;

export function promote(state) {
  const next = nextRank(state);
  if (!next) return { ok: false, msg: '已经是最高职级了' };
  if (state.rep < next.rep) return { ok: false, msg: `声望不足：需要 ${next.rep}（当前 ${Math.round(state.rep)}）` };
  if (state.gold < next.cost) return { ok: false, msg: '资金不足' };
  state.gold -= next.cost;
  state.stats.spent += next.cost;
  state.rank = next.id;
  state.stats.promotions = (state.stats.promotions || 0) + 1;
  return { ok: true, msg: `晋升为 ${next.name}`, rank: next };
}

// ---------- 实验室：研究进度与耐受度 ----------
// 稀有度决定研究要求：越稀有越难解锁
export function researchRequirement(dexId) {
  const s = sp(dexId);
  const capture = s?.captureRate ?? 255;
  return Math.round(RESEARCH_BASE + (255 - capture) * RESEARCH_RARITY);
}

export const researchProgress = (state, dexId) => state.research?.[dexId] || 0;

// 该物种在实验室里被实验损耗掉的个体数（用于图鉴记录）
export const researchLostCount = (state, dexId) => state.researchLoss?.[dexId] || 0;

function bumpResearchLoss(state, dexId) {
  if (!state.researchLoss) state.researchLoss = {};
  state.researchLoss[dexId] = (state.researchLoss[dexId] || 0) + 1;
}

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
  if (!before && after) {
    if (!state.dex.includes(id)) state.dex.push(id);
    // 研究完成即视为把该物种的蛋组信息补全（即使此前没通过繁育确认）
    if (!state.eggKnown) state.eggKnown = {};
    state.eggKnown[id] = [...(sp(id)?.eggGroups || [])];
  }
  return { unlocked: !before && after, percent: researchPercent(state, id) };
}

// 耐受度损耗：物理项吃防御、特殊项吃特防；结果对外隐藏
// 除数 12 → 4 → 2 → 1.5 → 1：同样一次实验，损耗已经是最初的十二倍
export function toleranceLoss(mon, experiment) {
  const s = sp(mon.dexId);
  const def = s?.stats?.def ?? 50;
  const spd = s?.stats?.spd ?? 50;
  const phys = (experiment.atk * 120) / (120 + def);
  const spec = (experiment.spa * 120) / (120 + spd);
  return Math.max(2, Math.ceil(phys + spec));
}

// 实验冷却（真实秒）；按“个体 + 实验”记录，个体之间互不影响
export const experimentCdKey = (uid, expId) => `${uid}:${expId}`;

export function experimentCooldown(state, uid, expId) {
  const left = state.expCd?.[experimentCdKey(uid, expId)] || 0;
  return left > 0 ? Math.round(left * 10) / 10 : 0;
}

// 物种研究 100% 之后，实验不再有冷却
export function experimentCooldownFor(state, mon, expId) {
  if (mon && isResearched(state, mon.dexId)) return 0;
  return experimentCooldown(state, mon?.uid, expId);
}

// 专属实验 + 不足 5 条时按强度补入基础三条；统一按强度升序
const byStrength = (a, b) => a.progress - b.progress || a.atk + a.spa - (b.atk + b.spa) || a.id.localeCompare(b.id);
const withCost = (e) => ({ ...e, cost: Math.round(e.cost * CONFIG.experimentCostMultiplier) });

export function experimentsFor(dexId) {
  const custom = customExperiments(dexId);
  if (!custom || !custom.length) return BASE_EXPERIMENTS.map(withCost);
  const list = custom
    .map((e) => {
      const tier = EXPERIMENT_TIERS[e.tier];
      return tier ? { id: e.id, name: e.name, desc: e.desc, tier: e.tier, ...tier } : null;
    })
    .filter(Boolean)
    .map(withCost);
  if (list.length >= 5) return list.sort(byStrength);
  const fill = BASE_FILL_ORDER.slice(0, 5 - list.length)
    .map((id) => BASE_EXPERIMENTS.find((e) => e.id === id))
    .filter(Boolean)
    .map(withCost);
  return [...list, ...fill].sort(byStrength);
}

// 物种研究完成后：只剩“最伤身”的那种研究行为还能用
export function lockedExperimentId(state, mon) {
  if (!mon || !isResearched(state, mon.dexId)) return null;
  let best = null;
  let bestLoss = -1;
  for (const e of experimentsFor(mon.dexId)) {
    const loss = toleranceLoss(mon, e);
    if (loss > bestLoss) {
      bestLoss = loss;
      best = e;
    }
  }
  return best?.id || null;
}

export function experimentOptions(state, mon) {
  const locked = lockedExperimentId(state, mon);
  return experimentsFor(mon.dexId).map((e) => ({
    ...e,
    allowed: !locked || locked === e.id,
    locked: !!locked && locked !== e.id,
  }));
}

export const labIndex = (state, u) => state.lab.findIndex((slot) => slot.uid === u);
export const labContains = (state, u) => labIndex(state, u) !== -1;
export const labSlots = (state) => state.lab.length;
export const labSlotBusy = (slot) => !!(slot?.uid || slot?.corpse);
export const labOccupied = (state) => state.lab.filter(labSlotBusy).length;

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
export const sterilityLabel = (mon) => (mon?.sterile ? (mon.gender === 'f' ? '不孕' : '不育') : '');

// ---------- 宝可梦生成 ----------
// 每只个体出厂即带满耐受度；但只有进了实验室才会在界面上看到它
export function createMon(state, dexId, level = 1, opts = {}) {
  const s = sp(dexId);
  const ivs = {};
  for (const k of STAT_KEYS) ivs[k] = opts.ivs?.[k] ?? randInt(state, 0, 31);
  const nature = opts.nature ?? pickOne(state, DEX.natures).id;
  const gender = opts.gender ?? genderFromRate(state, s.genderRate);
  const ability = opts.ability ?? pickOne(state, s.abilities);
  const shiny = opts.shiny ?? random(state) < CONFIG.shinyChance;
  const sterile = opts.sterile ?? (gender !== 'x' && random(state) < CONFIG.sterileChance);
  const no = state.nextMonNo ?? 1;
  state.nextMonNo = no + 1;
  return {
    uid: uid(state),
    no,
    dexId: Number(dexId),
    level,
    exp: 0,
    nature,
    gender,
    ability,
    shiny,
    sterile,
    ivs,
    // 出厂即满值；雄性上限是同物种、同等级雌性的 1.25 倍
    tolerance: toleranceCap(level, gender),
    // 来源：跟着个体一辈子（市场进货渠道 / 培育栏自产 / 野外捕获）
    source: opts.source ?? null,
    origin: opts.origin ?? 'egg',
    born: Math.floor(state.day),
  };
}

export function newGame(seed = (Date.now() % 2147483647) || 7) {
  const state = {
    v: SAVE_VERSION,
    seed,
    day: 1,
    gold: CONFIG.startGold,
    candies: CONFIG.startCandies,
    rep: 0,
    rank: 0,
    lastTaskDay: 0,
    candyPrice: CONFIG.candyBasePrice,
    mons: [],
    pens: Array.from({ length: CONFIG.startPens }, () => ({ a: null, b: null, breed: 0 })),
    lab: Array.from({ length: CONFIG.labSlotsBase }, () => ({ uid: null })),
    eggs: [],
    orders: [],
    market: [],
    marketDay: 1,
    marketRerollCost: CONFIG.marketRefreshCost,
    inventory: { 'fire-stone': 0, 'water-stone': 0, 'thunder-stone': 0, 'leaf-stone': 0, 'moon-stone': 0 },
    upgrades: { pens: CONFIG.startPens, lab: CONFIG.labSlotsBase, incubator: 0, feeder: 0, advertising: 0, training: 0 },
    research: {},
    // 每个物种在研究过程中被实验损耗掉的个体数
    researchLoss: {},
    // 最近的配对失败记录（只保留摘要，个体可能已被放生）
    breedFails: [],
    // 永久记住曾经失败过的物种组合（与展示用记录分开，避免被上限截断）
    failedPairs: [],
    dex: [],
    // 蛋组知识：{ 物种id: ['已确认的蛋组'] }
    eggKnown: {},
    // 已完成图鉴的研究记录：{ 物种id: { day, experiments } }
    dexRecords: {},
    // 各物种累计使用过的研究行为
    expLog: {},
    expJournal: [],
    // 实验行为冷却剩余秒数：{ 实验id: 秒 }
    expCd: {},
    stats: { earned: 0, spent: 0, delivered: 0, expired: 0, bred: 0, hatched: 0, experiments: 0, released: 0, fights: 0 },
    nextId: 1,
    nextMonNo: 1,
    log: [],
    feederTimer: 0,
    won: false,
    wonDay: null,
    quit: false,
    quitDay: null,
  };

  const male = createMon(state, 16, 5, { gender: 'm', origin: 'starter', source: '野外捕获' });
  const female = createMon(state, 21, 5, { gender: 'f', origin: 'starter', source: '野外捕获' });
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
    const prevMax = maxTolerance(mon);
    mon.level += 1;
    // 升级同时提高耐受度上限，并补上这一级的差值（雄性每级涨得更多）
    const nextMax = maxTolerance(mon);
    mon.tolerance = Math.min(nextMax, mon.tolerance + Math.max(0, nextMax - prevMax));
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
  const allSpecies = state.dex.length >= DEX.count;
  const topRank = (state.rank ?? 0) >= RANKS.length - 1;
  const legend = topRank && state.dex.some((id) => sp(id)?.legendary);
  if (!allSpecies && !legend) return null;
  state.won = true;
  state.wonDay = Math.floor(state.day);
  state.winKind = allSpecies ? 'dex' : 'legendary';
  return {
    type: 'win',
    msg: allSpecies
      ? '图鉴完成！151 只宝可梦已全部记录在案。'
      : `你以${RANKS[RANKS.length - 1].name}的身份完成了传说宝可梦的研究，火箭队的野心再无人能挡。`,
  };
}

// 认输：离开火箭队，本局结束（不能再推进时间）
export function quitGame(state) {
  if (state.quit) return { ok: false, msg: '你已经离开火箭队了' };
  state.quit = true;
  state.quitDay = Math.floor(state.day);
  return { ok: true, msg: '你离开了火箭队，这次卧底到此为止' };
}

// ---------- 配种 ----------
const isDitto = (mon) => mon.dexId === 132;

// 内部判定：真正的“可繁育”条件（不再展示给玩家，博士只能靠试）
// 曾经配对失败的物种组合：同栏时对方物种不可再用于配对
export function failedPartners(state, dexId) {
  const out = new Set();
  for (const key of state.failedPairs || []) {
    const [a, b] = String(key).split('-').map(Number);
    if (a === dexId) out.add(b);
    else if (b === dexId) out.add(a);
  }
  for (const f of state.breedFails || []) {
    const a = f.a?.dexId;
    const b = f.b?.dexId;
    if (a === dexId && b != null && b !== dexId) out.add(b);
    else if (b === dexId && a != null && a !== dexId) out.add(a);
  }
  return out;
}

export const failedPair = (state, aDexId, bDexId) =>
  aDexId !== bDexId && failedPartners(state, aDexId).has(bDexId);

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
  const sterile = a.sterile ? a : b.sterile ? b : null;
  if (sterile) return { ok: false, sterile: true, reason: `${sp(sterile.dexId).zh} ${sterilityLabel(sterile)}，无法配种` };
  if (!da && !db) {
    if (a.gender === 'x' || b.gender === 'x') return { ok: false, reason: '无性别的宝可梦无法配种' };
    if (a.gender === b.gender) return { ok: false, reason: '需要一雄一雌' };
    if (!groupsA.some((g) => groupsB.includes(g))) return { ok: false, reason: '蛋组不匹配' };
  }
  return { ok: true, reason: '可以配种' };
}

// ---------- 蛋组知识 ----------
// 博士一开始完全不知道蛋组；只有亲手繁育出蛋，才确认参与交汇的那个蛋组
export function knownEggGroups(state, dexId) {
  return state.eggKnown?.[dexId] || [];
}

export function revealEggGroups(state, a, b) {
  if (!state.eggKnown) state.eggKnown = {};
  const sa = sp(a.dexId);
  const sb = sp(b.dexId);
  if (!sa || !sb) return [];
  const shared = (sa.eggGroups || []).filter((g) => (sb.eggGroups || []).includes(g));
  const add = (dexId, groups) => {
    if (!groups.length) return;
    if (!state.eggKnown[dexId]) state.eggKnown[dexId] = [];
    for (const g of groups) if (!state.eggKnown[dexId].includes(g)) state.eggKnown[dexId].push(g);
  };
  add(a.dexId, shared);
  add(b.dexId, shared);
  // 百变怪没有交汇的蛋组，单独记一笔
  if (isDitto(a)) add(a.dexId, ['ditto']);
  if (isDitto(b)) add(b.dexId, ['ditto']);
  return shared;
}

// 展示用：未确认的蛋组一律显示为 ？？？
export function eggGroupsDisplay(state, dexId) {
  const s = sp(dexId);
  if (!s) return '—';
  const groups = s.eggGroups || [];
  if (!groups.length) return '—';
  const known = knownEggGroups(state, dexId);
  return groups.map((g) => (known.includes(g) ? eggZh(g) : '？？？')).join(' / ');
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

// 承担繁育损耗的一方：有雌性就由雌性（母体）承担；
// 没有雌性时（百变怪 + 雄性 / 无性别），由百变怪承担，不让雄性背锅
function breedCostBearer(a, b) {
  if (a.gender === 'f') return a;
  if (b.gender === 'f') return b;
  if (isDitto(a)) return a;
  if (isDitto(b)) return b;
  return a;
}

// 争斗时比较“谁更弱”：先看等级，再看种族值
export function weakerOf(a, b) {
  const rank = (m) => [m.level, bst(m.dexId), String(m.uid)];
  const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  return cmp(rank(a), rank(b)) <= 0 ? [a, b] : [b, a];
}

export function hatchDays(state, dexId) {
  const s = sp(dexId);
  const base = clamp((s?.hatchCounter ?? 20) / 6, 2, 10);
  return Math.max(1, +(base * (1 - 0.1 * state.upgrades.incubator)).toFixed(2));
}

function createEgg(state, dexId, parents, source = BRED_SOURCE) {
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
    // 来源跟着蛋进来，孵出后继续跟着个体
    source: source || BRED_SOURCE,
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
    source: egg.source,
  });
  mon.uid = egg.uid;
  state.mons.push(mon);
  // 孵出后默认留在围栏（闲置区），不自动塞进培育栏
  state.stats.hatched += 1;
  state.eggs = state.eggs.filter((e) => e.uid !== egg.uid);
  events.push({ type: 'egg', msg: `蛋孵化了：${s.zh}！（已在围栏）` });
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
}

// 花钱让蛋贩子再送一批货；每次更贵，但会随时间回落
export function marketRerollCost(state) {
  const base = CONFIG.marketRefreshCost;
  return Math.round(clamp(state.marketRerollCost ?? base, base, CONFIG.marketRefreshMax));
}

export function rerollMarket(state) {
  const cost = marketRerollCost(state);
  if (state.gold < cost) return { ok: false, msg: `资金不足（蛋贩子要 ${cost} 资金）` };
  state.gold -= cost;
  state.stats.spent += cost;
  state.marketRerollCost = Math.min(CONFIG.marketRefreshMax, cost + CONFIG.marketRefreshStep);
  state.marketDay = Math.floor(state.day);
  refreshMarket(state);
  return { ok: true, msg: `蛋贩子又拿来了一批蛋（下次换货 ${marketRerollCost(state)} 资金）` };
}

function makeOffer(state, dexId) {
  return { dexId, price: Math.round(valueOf(dexId) * (0.95 + random(state) * 0.2)), source: pickOne(state, EGG_SOURCES) };
}

export function buyEggOffer(state, idx) {
  const offer = state.market[idx];
  if (!offer) return { ok: false, msg: '该商品已售出' };
  if (state.eggs.length >= eggSlots(state)) return { ok: false, msg: '孵化器已满' };
  if (state.gold < offer.price) return { ok: false, msg: '资金不足' };
  state.gold -= offer.price;
  state.stats.spent += offer.price;
  createEgg(state, offer.dexId, null, offer.source || EGG_SOURCES[0]);
  state.market.splice(idx, 1);
  return { ok: true, msg: `购买了一枚 ${sp(offer.dexId).zh} 的蛋` };
}

export function buyCandies(state, qty) {
  const cost = Math.round(qty * state.candyPrice);
  if (state.gold < cost) return { ok: false, msg: '资金不足' };
  state.gold -= cost;
  state.stats.spent += cost;
  state.candies += qty;
  return { ok: true, msg: `购买了 ${qty} 个经验糖果（-${cost} 资金）` };
}

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
// 总裁办：初始几乎不出现，职级越高出现得越多，但始终稀少
// 声望闲置流失：距上次完成订单超过阈值后开始掉，且速度随闲置天数加快
export function repDecay(state) {
  const last = state.lastTaskDay ?? 0;
  const idleDays = Math.max(0, state.day - last);
  const overdue = idleDays - CONFIG.repDecayStart;
  if (overdue <= 0 || state.rep <= 0) return { active: false, idleDays, rate: 0 };
  return { active: true, idleDays, rate: CONFIG.repDecayBase + overdue * CONFIG.repDecayRamp };
}

export function boardOrderChance(state) {
  return clamp(CONFIG.boardOrderBase + CONFIG.boardOrderPerRank * (state.rank ?? 0), 0, 0.5);
}

function pickDepartment(state) {
  if (random(state) < boardOrderChance(state)) return BOARD_DEPT;
  return pickOne(state, DEPARTMENTS.filter((d) => d.id !== BOARD_DEPT)).id;
}

export function makeOrder(state) {
  const deptId = pickDepartment(state);
  const isBoard = deptId === BOARD_DEPT;

  const roll = random(state);
  // 总裁办更爱直接点名某个物种
  const kind = isBoard
    ? roll < 0.2
      ? 'any'
      : roll < 0.55
      ? 'type'
      : 'species'
    : roll < 0.45
    ? 'any'
    : roll < 0.8
    ? 'type'
    : 'species';
  let dexId = null;
  let type = null;
  if (kind === 'species') dexId = weightedSpecies(state);
  if (kind === 'type') {
    const s = sp(weightedSpecies(state));
    type = pickOne(state, s.types);
  }
  const rare = dexId ? sp(dexId).captureRate < 90 : kind === 'type' && random(state) < 0.3;
  const lowBias = Math.pow(random(state), 1.6);
  let minLevel = 6 + Math.round(lowBias * (rare ? 30 : 22));
  if (isBoard) minLevel += 12;
  minLevel = clamp(minLevel, 1, CONFIG.maxLevel - 5);
  const needNature = random(state) < (isBoard ? 0.4 : 0.16) ? pickOne(state, DEX.natures).id : 0;

  const levelPart = 150 + minLevel * 50;
  const rarity = dexId ? (255 - sp(dexId).captureRate) * 1.0 : 0;
  const kindFactor = kind === 'any' ? 1 : kind === 'type' ? 1.2 : 1.45;
  let reward = (levelPart + rarity) * kindFactor * (1 + state.rep * 0.01) * (1 + 0.12 * state.upgrades.advertising);
  if (needNature) reward *= 1.15;
  reward *= isBoard ? CONFIG.boardOrderRewardMultiplier : CONFIG.orderRewardMultiplier;

  let deadlineDays = 5 + minLevel * 0.35 + random(state) * 4;
  if (isBoard) deadlineDays *= 0.75;

  // 总裁办：给得更多；过期/放弃不再直接扣声望
  const rep = isBoard ? { gain: 13 } : { gain: 4 };

  return {
    id: `o${state.nextId++}`,
    dept: deptId,
    kind,
    dexId,
    type,
    minLevel,
    needNature,
    reward: Math.round(reward),
    repGain: rep.gain,
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
    .filter((m) => !labContains(state, m.uid) && penIndex(state, m.uid) === -1 && orderMatches(order, m))
    .sort((a, b) => b.level - a.level);
}

// 现在就能交付的订单（底栏红点、英雄区计数共用）
export function deliverableOrders(state) {
  return state.orders.filter((o) => deliverableMons(state, o).length > 0);
}

export function deliver(state, orderId, uidMon) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, msg: '需求不存在' };
  const mon = monByUid(state, uidMon);
  if (!mon || !orderMatches(order, mon)) return { ok: false, msg: '这只宝可梦不满足条件' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦无法交付' };
  if (penIndex(state, uidMon) !== -1) return { ok: false, msg: '请先把宝可梦移出培育栏再交付' };
  state.mons = state.mons.filter((m) => m.uid !== uidMon);
  for (const p of state.pens) {
    if (p.a === uidMon) p.a = null;
    if (p.b === uidMon) p.b = null;
  }
  state.gold += order.reward;
  state.stats.earned += order.reward;
  state.stats.delivered += 1;
  state.lastTaskDay = state.day;
  const gain = order.repGain ?? 4;
  state.rep = clamp(state.rep + gain, 0, 100);
  state.orders = state.orders.filter((o) => o.id !== orderId);
  return { ok: true, msg: `交付成功，获得 ${order.reward} 资金（声望 +${gain}）` };
}

export function abandonOrder(state, orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, msg: '需求不存在' };
  state.orders = state.orders.filter((o) => o.id !== orderId);
  return { ok: true, msg: '已回绝该需求（不再扣除声望）' };
}

// ---------- 操作 ----------
export function feed(state, uidMon) {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '实验室里的宝可梦无法喂食' };
  if (state.candies <= 0) return { ok: false, msg: '没有经验糖果了' };
  state.candies -= 1;
  const events = [];
  gainExp(state, mon, CONFIG.feedExp, events);
  return { ok: true, msg: `${sp(mon.dexId).zh} 吃下了经验糖果（经验 +${CONFIG.feedExp}）`, events };
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
  if (penIndex(state, uidMon) !== -1) return { ok: false, msg: '它已经在培育栏里了' };
  const key = slot === 'b' ? 'b' : 'a';
  const other = monByUid(state, key === 'a' ? pen.b : pen.a);
  if (other && other.dexId !== mon.dexId && failedPair(state, other.dexId, mon.dexId)) {
    return { ok: false, msg: `${sp(other.dexId).zh} 与 ${sp(mon.dexId).zh} 曾配对失败，不能再同栏` };
  }
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
// 实验室里的死亡不直接移除，而是留下遗体占着实验台，需付费处理
function leaveLabCorpse(state, mon, cause) {
  const idx = state.lab.findIndex((slot) => slot.uid === mon.uid);
  if (idx < 0) return releaseMon(state, mon.uid, cause === 'overload' ? 'overload' : 'exhausted');
  const slot = state.lab[idx];
  const name = sp(mon.dexId).zh;
  slot.uid = null;
  slot.corpse = { dexId: mon.dexId, level: mon.level, gender: mon.gender, day: Math.floor(state.day), cause };
  state.mons = state.mons.filter((m) => m.uid !== mon.uid);
  for (const p of state.pens) {
    if (p.a === mon.uid) p.a = null;
    if (p.b === mon.uid) p.b = null;
  }
  state.stats.released = (state.stats.released || 0) + 1;
  return { ok: true, name, corpse: true, slot: idx };
}

export function labProcessCost(state, slotIdx) {
  const slot = state.lab[slotIdx];
  if (!slot) return 0;
  if (slot.corpse) return CONFIG.labCorpseProcessCost;
  const mon = monByUid(state, slot.uid);
  if (!mon) return 0;
  const tolerance = Math.max(0, mon.tolerance || 0);
  return CONFIG.labProcessBase + Math.round(tolerance * CONFIG.labProcessPerTolerance);
}

export function processLabSlot(state, slotIdx) {
  const slot = state.lab[slotIdx];
  if (!slot || (!slot.uid && !slot.corpse)) return { ok: false, msg: '这个实验台是空的' };
  const mon = slot.uid ? monByUid(state, slot.uid) : null;
  if (slot.uid && !mon) {
    slot.uid = null;
    return { ok: false, msg: '实验台上的个体已不存在' };
  }
  const cost = labProcessCost(state, slotIdx);
  if (state.gold < cost) return { ok: false, msg: `处理需要 ${cost} 资金` };
  state.gold -= cost;
  state.stats.spent = (state.stats.spent || 0) + cost;
  let msg;
  if (slot.corpse) {
    msg = `已处理 ${sp(slot.corpse.dexId).zh} 的遗体，实验台空出`;
  } else {
    const name = sp(mon.dexId).zh;
    state.mons = state.mons.filter((m) => m.uid !== mon.uid);
    for (const p of state.pens) {
      if (p.a === mon.uid) p.a = null;
      if (p.b === mon.uid) p.b = null;
    }
    state.stats.released = (state.stats.released || 0) + 1;
    msg = `已处理 ${name}，实验台空出`;
  }
  slot.uid = null;
  slot.corpse = null;
  return { ok: true, msg, cost };
}

export function assignLab(state, slotIdx, uidMon) {
  const slot = state.lab[slotIdx];
  if (!slot) return { ok: false, msg: '实验室没有这个位置' };
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (labContains(state, uidMon)) return { ok: false, msg: '它已经在实验室里了' };
  if (penIndex(state, uidMon) !== -1) return { ok: false, msg: '请先从培育栏移出' };
  if (slot.uid || slot.corpse) return { ok: false, msg: '该实验台已被占用（含死亡个体）' };
  slot.uid = uidMon;
  if (mon.tolerance == null) mon.tolerance = maxTolerance(mon);
  return { ok: true, msg: `${sp(mon.dexId).zh} 被送进了实验室（只能实验或处理）` };
}

export const RELEASE_TEXT = {
  exhausted: '耗尽了耐受度，倒下了',
  overload: '没能承受住实验，死在了实验台上',
  fight: '在争斗中伤重不治',
  threat: '被实验的动静吓得耗尽耐受度，瘫倒在地',
  manual: '被放生了',
};

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
  const msg = `${name} ${RELEASE_TEXT[reason] || RELEASE_TEXT.manual}`;
  return { ok: true, msg, released: true, name };
}

// 记录某物种承受过的研究行为
function logExperiment(state, dexId, expId) {
  if (!state.expLog) state.expLog = {};
  if (!state.expLog[dexId]) state.expLog[dexId] = {};
  state.expLog[dexId][expId] = (state.expLog[dexId][expId] || 0) + 1;
}

function pickExperimentResult(state, exp, survived) {
  const pool = experimentResultsFor(exp.id);
  const arr = survived ? pool?.survive : pool?.death;
  if (Array.isArray(arr) && arr.length) return pickOne(state, arr);
  return survived ? '它活了下来，但伤得很重。' : '它没能撑过这次实验。';
}

function logExperimentRun(state, mon, exp, survived, result, cause = null) {
  if (!state.expJournal) state.expJournal = [];
  state.expJournal.unshift({
    day: Math.floor(state.day),
    no: mon.no,
    dexId: mon.dexId,
    level: mon.level,
    expId: exp.id,
    expName: exp.name,
    survived,
    result,
    cause,
  });
  if (state.expJournal.length > 500) state.expJournal.length = 500;
}

export function startExperiment(state, uidMon, experimentId) {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  if (!labContains(state, uidMon)) return { ok: false, msg: '它不在实验室里' };
  const expList = experimentsFor(mon.dexId);
  const exp = expList.find((e) => e.id === experimentId);
  if (!exp) return { ok: false, msg: '没有这个实验' };

  // 该物种研究已满：只允许继续做最伤身的那种实验
  const locked = lockedExperimentId(state, mon);
  if (locked && locked !== exp.id) {
    const only = expList.find((e) => e.id === locked);
    return { ok: false, msg: `该物种已研究完成，只有「${only.name}」还能记录到新数据` };
  }

  // 冷却中（按个体 + 实验记录，真实秒）；物种研究 100% 后不再受冷却限制
  const noCd = isResearched(state, mon.dexId);
  if (!noCd) {
    const cd = experimentCooldown(state, mon.uid, exp.id);
    if (cd > 0) return { ok: false, msg: `「${exp.name}」冷却中，还剩 ${Math.ceil(cd)} 秒`, cooldown: cd };
  }

  if (state.gold < exp.cost) return { ok: false, msg: '资金不足' };

  const loss = toleranceLoss(mon, exp);
  const intensity = Math.max(0.15, Math.min(1, loss / CONFIG.experimentHitLossCap));

  // 超出耐受：实验不生效（不扣资金、不给进度），宝可梦死亡并留下遗体
  if (loss > mon.tolerance) {
    bumpResearchLoss(state, mon.dexId);
    const resultText = pickExperimentResult(state, exp, false);
    logExperimentRun(state, mon, exp, false, resultText, 'overload');
    const r = leaveLabCorpse(state, mon, 'overload');
    return {
      ok: true,
      released: true,
      corpse: true,
      corpseSlot: r.slot,
      result: { text: resultText, survived: false },
      msg: `实验超出了 ${r.name} 的耐受极限，${r.name} 在实验台上断了气，数据没能留下`,
    };
  }

  state.gold -= exp.cost;
  state.stats.spent += exp.cost;
  state.stats.experiments = (state.stats.experiments || 0) + 1;
  if (!noCd) {
    if (!state.expCd) state.expCd = {};
    state.expCd[experimentCdKey(mon.uid, exp.id)] = exp.cd;
  }
  mon.tolerance -= loss;
  const willBeReleased = mon.tolerance <= 0;
  if (willBeReleased) bumpResearchLoss(state, mon.dexId);
  logExperiment(state, mon.dexId, exp.id);
  // 隐藏机制：每个实验行为各压 2% 进度，至少各做一次才允许到 100%
  const list = experimentsFor(mon.dexId);
  const log = state.expLog?.[mon.dexId] || {};
  const unperformed = list.filter((e) => !(log[e.id] > 0)).length;
  const capPoints = (researchRequirement(mon.dexId) * Math.max(0, 100 - unperformed * 2)) / 100;
  const gain = Math.max(0, Math.min(exp.progress, capPoints - researchProgress(state, mon.dexId)));
  const res = addResearch(state, mon.dexId, gain);
  const name = sp(mon.dexId).zh;
  const events = [];
  if (res.unlocked) {
    // 图鉴条目完成：冷却全部解除，之后不再有实验 CD
    state.expCd = {};
    if (!state.dexRecords) state.dexRecords = {};
    state.dexRecords[mon.dexId] = {
      day: Math.floor(state.day),
      experiments: { ...(state.expLog[mon.dexId] || {}) },
      // 这一路研究损耗掉的个体数
      lost: researchLostCount(state, mon.dexId),
    };
    events.push({ type: 'research', msg: `${name} 的图鉴条目研究完成！` });
  }
  // 高损耗实验：harsh 档，或损耗超过自身耐受上限一定比例，会吓到同实验室的其他个体
  const maxTol = Math.max(1, maxTolerance(mon));
  if (exp.tier === 'harsh' || loss / maxTol >= CONFIG.threatLossRatio) {
    let scared = 0;
    for (const slot of [...state.lab]) {
      const target = monByUid(state, slot.uid);
      if (!target || target.uid === mon.uid) continue;
      const tMax = Math.max(1, maxTolerance(target));
      // 耐受度已经低于上限 10%：已经麻木，不再被实验动静惊吓
      if (target.tolerance < tMax * CONFIG.threatMinToleranceRatio) continue;
      target.tolerance -= Math.max(1, Math.round(tMax * CONFIG.threatToleranceRatio));
      scared++;
      if (target.tolerance <= 0) {
        bumpResearchLoss(state, target.dexId);
        const tname = sp(target.dexId).zh;
        leaveLabCorpse(state, target, 'threat');
        events.push({ type: 'warn', msg: `${tname} 被实验的动静吓得拼命挣扎，瘫倒在实验台上` });
      }
    }
    if (scared) events.push({ type: 'warn', msg: `${name} 的实验动静太大，实验室里的其他宝可梦吓得一阵挣扎` });
  }

  const win = checkVictory(state);
  if (win) events.push(win);

  if (willBeReleased) {
    const resultText = pickExperimentResult(state, exp, false);
    logExperimentRun(state, mon, exp, false, resultText, 'exhausted');
    const r = leaveLabCorpse(state, mon, 'exhausted');
    events.push({ type: 'warn', msg: `${name} 的耐受度耗尽，倒在了实验台上` });
    return {
      ok: true,
      released: true,
      corpse: true,
      corpseSlot: r.slot,
      events,
      result: { text: resultText, survived: false },
      msg: `实验完成，${name} 没能走下实验台`,
      loss,
      intensity,
    };
  }

  const resultText = pickExperimentResult(state, exp, true);
  logExperimentRun(state, mon, exp, true, resultText, null);
  return { ok: true, events, msg: `实验完成（${exp.name}）`, loss, intensity, result: { text: resultText, survived: true } };
}

// ---------- 设施 ----------
function upgradeLevel(state, key) {
  if (key === 'pens') return state.pens.length;
  if (key === 'lab') return state.lab.length;
  return state.upgrades[key];
}

export function upgradeCost(state, key) {
  const info = UPGRADE_INFO[key];
  const lvl = upgradeLevel(state, key);
  if (!info || lvl >= info.max) return null;
  return info.costs[lvl] ?? null;
}

export function upgradeRankReq(state, key) {
  const info = UPGRADE_INFO[key];
  if (!info) return 0;
  const lvl = upgradeLevel(state, key);
  return info.rankReq?.[lvl] ?? 0;
}

export function buyUpgrade(state, key) {
  const cost = upgradeCost(state, key);
  if (cost == null) return { ok: false, msg: '已达最高等级' };
  const needRank = upgradeRankReq(state, key);
  if ((state.rank ?? 0) < needRank) {
    return { ok: false, msg: `需要职级「${rankById(needRank).name}」才能解锁该等级`, rankLocked: needRank };
  }
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
// 培育栏：两只放进去就会开始积累繁育条；满了以后——
//   · 条件正常：产蛋，承担损耗的一方（雌性；无雌性时是百变怪）掉耐受度
//   · 条件不正常：两只打架，弱的那只死亡，另一只掉耐受度
function logBreedFail(state, a, b, loser, kind) {
  if (!state.breedFails) state.breedFails = [];
  const snap = (m) => ({ dexId: m.dexId, level: m.level });
  state.breedFails.unshift({ day: Math.floor(state.day), a: snap(a), b: snap(b), loser: snap(loser), kind });
  if (state.breedFails.length > 50) state.breedFails.length = 50;
  if (a.dexId !== b.dexId) {
    if (!state.failedPairs) state.failedPairs = [];
    const key = [a.dexId, b.dexId].sort((x, y) => x - y).join('-');
    if (!state.failedPairs.includes(key)) state.failedPairs.push(key);
  }
}

function resolvePen(state, pen, events, penIndex = null) {
  const a = monByUid(state, pen.a);
  const b = monByUid(state, pen.b);
  if (!a || !b) {
    pen.breed = 0;
    return;
  }
  if (pen.breed < CONFIG.breedDays) return;

  if (a.dexId !== b.dexId && failedPair(state, a.dexId, b.dexId)) {
    pen.breed = 0;
    events.push({
      type: 'warn',
      pen: penIndex,
      failedPair: true,
      msg: `${sp(a.dexId).zh} 与 ${sp(b.dexId).zh} 曾配对失败，不能继续同栏繁育`,
    });
    return;
  }

  const comp = compatibility(state, a, b);
  if (comp.ok) {
    if (state.eggs.length >= eggSlots(state)) {
      // 孵化器满了，先憋着，不惩罚
      pen.breed = CONFIG.breedDays;
      return;
    }
    const bearer = breedCostBearer(a, b);
    if (bearer.tolerance - CONFIG.breedToleranceCost <= 0) {
      // 承担损耗的一方撑不住这次繁育：本次失败，不产蛋，随后死亡
      const name = sp(bearer.dexId).zh;
      logBreedFail(state, a, b, bearer, 'exhausted');
      releaseMon(state, bearer.uid, 'exhausted');
      pen.breed = 0;
      events.push({ type: 'warn', msg: `${name} 在繁育中耗尽了耐受度，力竭而死` });
      return;
    }
    bearer.tolerance -= CONFIG.breedToleranceCost;
    revealEggGroups(state, a, b);
    const dexId = childSpecies(a, b);
    if (dexId) {
      createEgg(state, dexId, [a, b]);
      state.stats.bred += 1;
      events.push({ type: 'egg', pen: penIndex, msg: `配种成功：孵化器中多了一枚 ${sp(dexId).zh} 的蛋` });
    }
    pen.breed = 0;
    return;
  }

  // 不孕 / 不育：不会产蛋，但也不会因此争斗
  if (comp.sterile) {
    pen.breed = 0;
    events.push({ type: 'warn', pen: penIndex, sterile: true, msg: `${comp.reason}，本次无法繁育` });
    return;
  }

  // 没能配成：争斗
  const [weak, strong] = weakerOf(a, b);
  const weakName = sp(weak.dexId).zh;
  const strongName = sp(strong.dexId).zh;
  logBreedFail(state, a, b, weak, 'fight');
  releaseMon(state, weak.uid, 'fight');
  state.stats.fights = (state.stats.fights || 0) + 1;
  pen.breed = 0;
  events.push({ type: 'warn', pen: penIndex, fight: true, msg: `${weakName} 与 ${strongName} 没能配成，争斗中 ${weakName} 伤重不治` });
  const survivor = monByUid(state, strong.uid);
  if (survivor) {
    survivor.tolerance -= CONFIG.fightToleranceLoss;
    if (survivor.tolerance <= 0) {
      releaseMon(state, survivor.uid, 'exhausted');
      events.push({ type: 'warn', msg: `${strongName} 也在争斗中耗尽了耐受度，伤重不治` });
    } else {
      events.push({ type: 'warn', msg: `${strongName} 在争斗中受了伤` });
    }
  }
}

// ---------- 围栏争斗 ----------
// 不在培育栏、也不在实验室的个体才算“围栏里的”；同物种同性别会互相争斗
function idleGroups(state) {
  const groups = new Map();
  for (const mon of idleMons(state)) {
    const key = `${mon.dexId}:${mon.gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mon);
  }
  return groups;
}

// 给界面用：哪些群体正在围栏里争斗
export function idleConflicts(state) {
  const out = [];
  for (const [key, list] of idleGroups(state)) {
    if (list.length < 2) continue;
    const [dexId, gender] = key.split(':');
    out.push({ dexId: Number(dexId), gender, count: list.length });
  }
  return out.sort((a, b) => b.count - a.count || a.dexId - b.dexId);
}

export function tick(state, dtDays, realSeconds = dtDays * CONFIG.secondsPerDay) {
  if (!(dtDays > 0)) return [];
  if (state.quit) return [];
  const events = [];
  const startDay = state.day;
  state.day += dtDays;

  // 声望闲置流失：完成订单会重置 lastTaskDay；过期不再额外扣声望
  const decay = repDecay(state);
  if (decay.active) state.rep = clamp(state.rep - decay.rate * dtDays, 0, 100);

  // 实验冷却按真实时间递减（不受游戏倍速影响）
  if (state.expCd && realSeconds > 0) {
    for (const id of Object.keys(state.expCd)) {
      const left = state.expCd[id] - realSeconds;
      if (left <= 0) delete state.expCd[id];
      else state.expCd[id] = left;
    }
  }
  const secs = dtDays * CONFIG.secondsPerDay;

  // 被动经验（培育栏里的宝可梦不会因为研究完成而被锁住成长）
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

  // 实验室挣扎：耐受度高于阈值的个体会缓慢消耗耐受度
  for (const slot of state.lab) {
    const mon = monByUid(state, slot.uid);
    if (mon && mon.tolerance > CONFIG.labStruggleThreshold) {
      mon.tolerance = Math.max(0, mon.tolerance - CONFIG.labStrugglePerDay * dtDays);
      if (mon.tolerance <= 0) bumpResearchLoss(state, mon.dexId);
    }
  }

  // 配种 / 争斗
  for (let i = 0; i < state.pens.length; i++) {
    const pen = state.pens[i];
    const a = monByUid(state, pen.a);
    const b = monByUid(state, pen.b);
    if (!a || !b) {
      pen.breed = 0;
      continue;
    }
    pen.breed += dtDays;
    resolvePen(state, pen, events, i);
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
      for (let i = 0; i < due && state.candies > 0 && penMons.length; i++) {
        const target = penMons[i % penMons.length];
        state.candies -= 1;
        target.exp += 40;
        gainExp(state, target, 0, events);
      }
    }
  }

  // 围栏争斗：同物种同性别扎堆，数量越多掉得越快（按“对数”叠加）
  const fightDeaths = new Set();
  for (const list of idleGroups(state).values()) {
    const n = list.length;
    if (n < 2) continue;
    const loss = CONFIG.idleFightRatePerPairDay * ((n * (n - 1)) / 2) * dtDays;
    if (loss <= 0) continue;
    for (const mon of list) {
      mon.tolerance -= loss;
      if (mon.tolerance <= 0) fightDeaths.add(mon.uid);
    }
  }

  // 耐受度见底：实验室留下遗体占位，其他位置离队
  for (const mon of [...state.mons]) {
    if (mon.tolerance <= 0) {
      const name = sp(mon.dexId).zh;
      const fromFight = fightDeaths.has(mon.uid);
      const inLab = labContains(state, mon.uid);
      const inPen = penIndex(state, mon.uid) !== -1;
      if (inLab) leaveLabCorpse(state, mon, 'struggle');
      else releaseMon(state, mon.uid, 'exhausted');
      const msg = fromFight
        ? `${name} 在围栏的争斗中伤重不治`
        : inLab
          ? `${name} 在实验台上挣扎到最后一刻，倒了下去`
          : inPen
            ? `${name} 在培育栏里耗尽了耐受度，倒下了`
            : `${name} 在围栏里耗尽了耐受度，没能撑过去`;
      events.push({ type: 'warn', msg });
    }
  }

  // 订单过期：只记录（stats / state.log），不在界面日志里播报
  const expired = state.orders.filter((o) => o.deadline <= state.day);
  if (expired.length) {
    state.orders = state.orders.filter((o) => o.deadline > state.day);
    state.stats.expired += expired.length;
    if (!state.log) state.log = [];
    for (const o of expired) {
      const msg = `需求过期：${orderRequirementText(o)}`;
      state.log.push({ day: Math.floor(state.day), type: 'expire', msg });
      events.push({ type: 'expire', msg });
    }
    if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  }

  // 跨天：经验糖果价格小幅波动；蛋贩子每两周自动换货，换货费用随时间回落
  const elapsedDays = state.day - startDay;
  if (elapsedDays > 0) {
    state.marketRerollCost = Math.max(
      CONFIG.marketRefreshCost,
      (state.marketRerollCost ?? CONFIG.marketRefreshCost) - CONFIG.marketRefreshDecayPerDay * elapsedDays
    );
  }
  const today = Math.floor(state.day);
  if (today - (state.marketDay ?? today) >= CONFIG.marketRefreshIntervalDays) {
    state.marketDay = today;
    refreshMarket(state);
  }
  if (today > Math.floor(startDay)) {
    state.candyPrice = clamp(+(state.candyPrice * (0.92 + random(state) * 0.16)).toFixed(1), 8, 30);
  }
  while (state.orders.length < orderSlots(state) && random(state) < Math.min(1, dtDays / CONFIG.orderIntervalDays)) {
    state.orders.push(makeOrder(state));
  }

  const win = checkVictory(state);
  if (win) events.push(win);

  return events;
}

// 存档的序列化、迁移与读写见 save.mjs（本文件不再关心持久化细节）。

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

// 能力值披露：按该物种种族值从高到低逐项公开
export function statRevealOrder(dexId) {
  const s = sp(dexId);
  if (!s) return [];
  return [...STAT_KEYS].sort((a, b) => (s.stats[b] ?? 0) - (s.stats[a] ?? 0) || STAT_KEYS.indexOf(a) - STAT_KEYS.indexOf(b));
}

export function revealedStats(state, dexId) {
  const order = statRevealOrder(dexId);
  const count = Math.floor((researchPercent(state, dexId) * order.length) / 100);
  return order.slice(0, clamp(count, 0, order.length));
}

// 图鉴里某个已完成物种的研究记录
export function dexRecord(state, dexId) {
  return state.dexRecords?.[dexId] || null;
}

// 把记录整理成「基础体测×3 · 组织采样×1」
function experimentName(id) {
  return BASE_EXPERIMENTS.find((e) => e.id === id)?.name || experimentById(id)?.name || null;
}

export function dexRecordText(record) {
  if (!record || !record.experiments) return '无记录';
  const parts = [];
  for (const [id, n] of Object.entries(record.experiments)) {
    if (n > 0) {
      const name = experimentName(id);
      if (name) parts.push(`${name}×${n}`);
    }
  }
  return parts.join(' · ') || '无记录';
}
