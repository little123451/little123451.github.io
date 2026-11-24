// 纯逻辑层：不接触 DOM，可被 Node 直接测试。
// 规则数据（数值 / 静态表）在 rules.mjs；本文件只负责状态推进与行为。
import { DEX, sp, bst, growthMultiplier, natureById, STONE_ITEMS, typeZh, ITEM_ZH, eggZh, customExperiments, experimentById } from './data.mjs';
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

// 某物种所在进化链的全部物种 id（含自身）
export function evolutionChainIds(dexId) {
  const root = baseDexId(dexId);
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const id = Number(stack.pop());
    if (seen.has(id) || !sp(id)) continue;
    seen.add(id);
    for (const e of sp(id).evolvesTo || []) stack.push(Number(e.id));
  }
  return [...seen];
}

// 围栏分组：
//   A 培育相关 = 培育栏里出现的物种，以及它们进化链上的所有物种
//   B 其它     = 不在 A 范围内的闲置个体
export function idleSections(state) {
  const relatedIds = new Set();
  for (const m of penMons(state)) {
    for (const id of evolutionChainIds(m.dexId)) relatedIds.add(id);
  }
  const all = idleMons(state);
  // 畸形体单独一段，不进「培育相关 / 其它」
  const mutants = all.filter((m) => m.mutant);
  const normal = all.filter((m) => !m.mutant);
  return {
    relatedIds,
    mutants,
    related: normal.filter((m) => relatedIds.has(m.dexId)),
    others: normal.filter((m) => !relatedIds.has(m.dexId)),
  };
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

// 把某个 uid 从它所在的栏位里摘掉（出售 / 交付 / 死亡 / 转入实验室共用）。
// 只重置真正装着它的那一格：繁育条清零、提示作废，其它栏位不受影响。
function detachFromPens(state, uidMon) {
  for (const pen of state.pens) {
    if (pen.a !== uidMon && pen.b !== uidMon) continue;
    if (pen.a === uidMon) pen.a = null;
    if (pen.b === uidMon) pen.b = null;
    pen.breed = 0;
    pen.notice = null;
  }
}

// 按物种累计研究支出：实验行为 / 处理（活体与遗体）
function addSpeciesSpend(state, dexId, kind, amount) {
  if (!amount) return;
  if (!state.speciesSpend) state.speciesSpend = {};
  if (!state.speciesSpend[dexId]) state.speciesSpend[dexId] = { exp: 0, corpse: 0 };
  state.speciesSpend[dexId][kind] += amount;
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
  const win = checkVictory(state);
  return { ok: true, msg: `晋升为 ${next.name}`, rank: next, win };
}

// ---------- 实验室：研究进度与耐受度 ----------
// 稀有度决定研究要求：越稀有越难解锁
export function researchRequirement(dexId) {
  const s = sp(dexId);
  const capture = s?.captureRate ?? 255;
  return Math.round(RESEARCH_BASE + (255 - capture) * RESEARCH_RARITY);
}

export const researchProgress = (state, dexId) => state.research?.[dexId] || 0;

// 该物种在实验室里被实验损耗掉的个体数（用于研究笔记记录）
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

// 研究完成：冷却全解、写入图鉴记录、播报一条
function completeResearch(state, mon, events) {
  state.expCd = {};
  if (!state.dexRecords) state.dexRecords = {};
  state.dexRecords[mon.dexId] = {
    day: Math.floor(state.day),
    experiments: { ...(state.expLog[mon.dexId] || {}) },
    // 这一路研究损耗掉的个体数
    lost: researchLostCount(state, mon.dexId),
  };
  events.push({ type: 'research', msg: `${sp(mon.dexId).zh} 的研究完成，研究笔记已记录。` });
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
export const sellPrice = (mon) =>
  Math.round(monValue(mon) * 0.45 * (mon.mutant ? CONFIG.mutantSellFactor : 1));

export function genderFromRate(state, rate) {
  if (rate === -1) return 'x';
  if (rate === 0) return 'm';
  if (rate === 8) return 'f';
  return random(state) < rate / 8 ? 'f' : 'm';
}

export const genderZh = (g) => ({ m: '♂', f: '♀', x: '—' }[g] || '—');
export const sterilityLabel = (mon) => {
  if (!mon) return '';
  if (mon.sterile) return mon.gender === 'f' ? '不孕' : '不育';
  return '';
};

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
  // 体质系数：外血 / 正常 = 1；近亲后代按档位乘数，下限 0.5
  const vigor = opts.vigor ?? 1;
  const mon = {
    uid: opts.uid ?? uid(state),
    no: null,
    dexId: Number(dexId),
    level,
    exp: 0,
    nature,
    gender,
    ability,
    shiny,
    sterile,
    ivs,
    // 体质系数：乘在耐受上限上，不单独显示
    vigor,
    // 近亲后代标记（出生时写入）
    inbred: !!opts.inbred,
    // 父方 / 母方：亲属称呼判定父系母系用；百变怪 / 无性别一侧为 null
    fatherUid: opts.fatherUid ?? null,
    motherUid: opts.motherUid ?? null,
    // 出厂即满值；雄性上限是同物种、同等级雌性的 1.25 倍
    tolerance: Math.max(1, Math.round(toleranceCap(level, gender) * vigor)),
    // 血统：祖先 uid → 距离我的代数（市场买来的蛋 / 初始个体都为空）
    ancestors: opts.ancestors ? { ...opts.ancestors } : {},
    gen: opts.gen ?? 0,
    // 畸形体：跨蛋组硬凑出来的东西——不育、体质触底、无图鉴、不推进研究
    mutant: !!opts.mutant,
    // 畸形体的父母物种（渲染用；父母可能已经不在了）
    mix: opts.mix ? [...opts.mix] : null,
    // 来源：跟着个体一辈子（市场进货渠道 / 培育栏自产 / 野外捕获）
    source: opts.source ?? null,
    origin: opts.origin ?? 'egg',
    // 预留：出生日，目前没有读取方（可为将来的年龄 / 世代展示提供依据）
    born: Math.floor(state.day),
  };
  rememberLineage(state, mon);
  return mon;
}

// 血统登记：uid → { 父, 母 }。个体被卖掉 / 死亡后仍然保留，亲属称呼靠它判父系母系。
function rememberLineage(state, mon) {
  if (!mon || (!mon.fatherUid && !mon.motherUid)) return;
  if (!state.lineage) state.lineage = {};
  state.lineage[mon.uid] = { f: mon.fatherUid ?? null, m: mon.motherUid ?? null };
}

function allocateMonNo(state, mon) {
  if (!mon || mon.no) return mon?.no ?? null;
  const no = state.nextMonNo ?? 1;
  mon.no = no;
  state.nextMonNo = no + 1;
  return no;
}

export function newGame(seed = (Date.now() % 2147483647) || 7) {  const state = {
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
    lab: Array.from({ length: CONFIG.labSlotsBase }, () => ({ uid: null, assistant: false, auto: false, spend: 0 })),
    eggs: [],
    // 样本：物种绑定的一次性产物（[物种id]: 份数），终末榨取的产出
    samples: {},
    orders: [],
    market: [],
    marketDay: 1,
    marketRerollCost: CONFIG.marketRefreshCost,
    inventory: { 'fire-stone': 0, 'water-stone': 0, 'thunder-stone': 0, 'leaf-stone': 0, 'moon-stone': 0 },
    upgrades: { pens: CONFIG.startPens, lab: CONFIG.labSlotsBase, incubator: 0, advertising: 0, training: 0 },
    // upgrades.pens / upgrades.lab 是预留字段：真实等级取自 state.pens.length / state.lab.length
    research: {},
    // 每个物种在研究过程中被实验损耗掉的个体数
    researchLoss: {},
    dex: [],
    // 蛋组知识：{ 物种id: ['已确认的蛋组'] }
    eggKnown: {},
    // 血统登记：{ uid: { f: 父方uid, m: 母方uid } }，个体离队后仍保留
    lineage: {},
    // 曾经孵出过的物种（孵化反馈分级用）：{ 物种id: 次数 }
    everHatched: {},
    // 已完成研究笔记的研究记录：{ 物种id: { day, experiments } }
    dexRecords: {},
    // 各物种累计使用过的研究行为
    expLog: {},
    expJournal: [],
    idleCorpses: [],
    // 实验行为冷却剩余秒数：{ 实验id: 秒 }
    expCd: {},
    stats: {
      earned: 0,
      spent: 0,
      delivered: 0,
      expired: 0,
      bred: 0,
      hatched: 0,
      experiments: 0,
      experimentSpent: 0,
      corpseSpent: 0,
      released: 0,
    },
    nextId: 1,
    nextMonNo: 1,
    // 按物种累计的研究支出：{ 物种id: { exp: 实验花费, corpse: 处理花费 } }
    speciesSpend: {},
    log: [],
    won: false,
    wonDay: null,
    quit: false,
    quitDay: null,
  };

  // 开局三只：一只波波（父本）+ 两只烈雀（母体，彼此无亲缘）。
  // 两只母体必须同物种——异种双雌不会降低断线风险。
  const male = createMon(state, 16, 5, { gender: 'm', origin: 'starter', source: '野外捕获' });
  const femaleA = createMon(state, 21, 5, { gender: 'f', origin: 'starter', source: '野外捕获' });
  const femaleB = createMon(state, 21, 5, { gender: 'f', origin: 'starter', source: '野外捕获' });
  state.mons.push(male, femaleA, femaleB);
  state.pens[0].a = male.uid;
  state.pens[0].b = femaleA.uid;
  // 第三只在围栏里待命，进栏位时才分配编号
  allocateMonNo(state, male);
  allocateMonNo(state, femaleA);
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

// “到这里就可以结束”：最高职级，或完成全部 151 份研究笔记。
// 这不是战胜谁，只是玩家把某一条路走到了自己认可的终点。
export function checkVictory(state) {
  if (state.won) return null;
  const allSpecies = state.dex.length >= DEX.count;
  const topRank = (state.rank ?? 0) >= RANKS.length - 1;
  if (!allSpecies && !topRank) return null;
  state.won = true;
  state.wonDay = Math.floor(state.day);
  state.winKind = topRank ? 'rank' : 'dex';
  return {
    type: 'win',
    msg: topRank
      ? `你走到了${RANKS[RANKS.length - 1].name}的位置。这条路到这里就可以结束了。`
      : '151 份研究笔记已经补完。这条路到这里就可以结束了。',
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
export const isDitto = (mon) => mon.dexId === 132;

// 内部判定：真正的“可繁育”条件（不再展示给玩家，博士只能靠试）
export function compatibility(a, b) {
  if (!a || !b) return { ok: false, reason: '需要两只宝可梦' };
  if (a.uid === b.uid) return { ok: false, reason: '不能和自己配种' };
  const sa = sp(a.dexId);
  const sb = sp(b.dexId);
  const da = isDitto(a);
  const db = isDitto(b);
  // 两只百变怪：凑不出后代，静默处理
  if (da && db) return { ok: false, quiet: true, code: 'ditto-pair', reason: '两只百变怪凑不出什么来' };
  const groupsA = sa.eggGroups || [];
  const groupsB = sb.eggGroups || [];
  // 未发现蛋组（传说 / 幻兽）：静默处理
  if (!da && groupsA.includes('no-eggs')) return { ok: false, quiet: true, code: 'no-eggs', reason: `${sa.zh} 属于未发现蛋组` };
  if (!db && groupsB.includes('no-eggs')) return { ok: false, quiet: true, code: 'no-eggs', reason: `${sb.zh} 属于未发现蛋组` };
  const sterile = a.sterile ? a : b.sterile ? b : null;
  if (sterile) return { ok: false, sterile: true, reason: `${sp(sterile.dexId).zh} ${sterilityLabel(sterile)}，无法配种` };
  if (!da && !db) {
    // 无性别：放进栏位什么也不会发生
    if (a.gender === 'x' || b.gender === 'x') {
      const bothX = a.gender === 'x' && b.gender === 'x';
      const odd = a.gender === 'x' ? a : b;
      return {
        ok: false,
        quiet: true,
        code: 'no-gender',
        reason: bothX ? '两只都没有性别，凑在一起什么也没发生' : `${sp(odd.dexId).zh} 没有性别，配不了`,
      };
    }
    if (a.gender === b.gender) return { ok: false, quiet: true, code: 'same-sex', reason: '同性配不了' };
    const mismatch = !groupsA.some((g) => groupsB.includes(g));
    return { ok: true, mismatch };
  }
  return { ok: true, mismatch: false };
}

// ---------- 蛋组知识 ----------
// 博士一开始完全不知道蛋组；只有该物种研究到 100% 才揭示。
export function knownEggGroups(state, dexId) {
  return state.eggKnown?.[dexId] || [];
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

// 界面用：两个物种是否存在“已识别”的共同蛋组。
// 只读 state.eggKnown，绝不揭示未知蛋组——它是记忆辅助，不是剧透。
export function sharesKnownEggGroup(state, aDexId, bDexId) {
  const A = knownEggGroups(state, aDexId);
  const B = knownEggGroups(state, bDexId);
  if (!A.length || !B.length) return false;
  return A.some((g) => B.includes(g));
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

// 比较「谁更弱」：先看等级，再看种族值，
// 最后按 uid 的数值编号兜底（不能按字符串比，u10 会排在 u9 前面）
const uidNo = (u) => Number(String(u).replace(/\D/g, '')) || 0;

export function weakerOf(a, b) {
  const rank = (m) => [m.level, bst(m.dexId), uidNo(m.uid)];
  const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  return cmp(rank(a), rank(b)) <= 0 ? [a, b] : [b, a];
}

export function hatchDays(state, dexId) {
  const s = sp(dexId);
  const base = clamp((s?.hatchCounter ?? 20) / 6, 2, 10);
  return Math.max(1, +(base * (1 - 0.1 * state.upgrades.incubator)).toFixed(2));
}

// 死胎概率：跟着体质系数走。体质 ≥0.85 时完全不会发生——启动期天然免疫。
function stillbirthChance(vigor) {
  if (vigor >= 0.85) return 0;
  if (vigor >= 0.72) return 0.02;
  if (vigor >= 0.61) return 0.04;
  return 0.06;
}

// 血统：祖先 uid → 最近代数（父 = 1，祖父 = 2…）。不做截断，否则连亲子都判不出来。
function lineageOf(parents) {
  if (!parents?.length) return { ancestors: {}, gen: 0 };
  const map = {};
  let gen = 0;
  for (const p of parents) {
    if (!p) continue;
    map[p.uid] = 1;
    for (const [u, d] of Object.entries(p.ancestors || {})) {
      const nd = d + 1;
      if (map[u] == null || map[u] > nd) map[u] = nd;
    }
    gen = Math.max(gen, p.gen ?? 0);
  }
  return { ancestors: map, gen: gen + 1 };
}

// 近亲判定：直系优先（任意深度都是最重档），旁系按共同祖先的深度分档。
// 返回 multiplier 为 null 表示不在惩罚范围内。
export function kinTier(a, b) {
  if (!a || !b) return { multiplier: null, direct: false, depth: Infinity };
  const A = a.ancestors || {};
  const B = b.ancestors || {};
  // 直系：一方出现在另一方的祖先表里
  if (A[b.uid] != null || B[a.uid] != null) {
    return { multiplier: CONFIG.kinTierDirect, direct: true, depth: 1 };
  }
  let depth = Infinity;
  for (const u of Object.keys(A)) {
    const e = B[u];
    if (e == null) continue;
    const d = Math.max(A[u], e);
    if (d < depth) depth = d;
  }
  if (depth === 1) return { multiplier: CONFIG.kinTier1, direct: false, depth };
  if (depth === 2) return { multiplier: CONFIG.kinTier2, direct: false, depth };
  if (depth === 3) return { multiplier: CONFIG.kinTier3, direct: false, depth };
  return { multiplier: null, direct: false, depth };
}

export const isKin = (a, b) => kinTier(a, b).multiplier != null;

// ---------- 亲属称呼 ----------
// 只在配对选择器里展示，不给档位与乘数（spec §16）。需要 state.lineage 判父系 / 母系。
const uidNum = (u) => Number(String(u ?? '').replace(/\D/g, '')) || 0;
const byGender = (g, male, female, neutral) => (g === 'm' ? male : g === 'f' ? female : neutral);

function ancestorLabel(depth, gender) {
  if (depth <= 1) return byGender(gender, '父亲', '母亲', '亲代');
  if (depth === 2) return byGender(gender, '祖父', '祖母', '祖辈');
  if (depth === 3) return byGender(gender, '曾祖父', '曾祖母', '曾祖辈');
  return '先祖';
}

function descendantLabel(depth, gender) {
  if (depth <= 1) return byGender(gender, '儿子', '女儿', '子代');
  if (depth === 2) return byGender(gender, '孙子', '孙女', '孙辈');
  if (depth === 3) return byGender(gender, '曾孙', '曾孙女', '曾孙辈');
  return '后代';
}

// 这一位的父 / 母里，谁是 grandUid 的孩子；用来判父系 / 母系
function parentSide(state, mon, grandUid) {
  const link = state?.lineage?.[mon?.uid];
  if (!link) return null;
  if (link.f && state.lineage[link.f] && (state.lineage[link.f].f === grandUid || state.lineage[link.f].m === grandUid)) {
    return 'father';
  }
  if (link.m && state.lineage[link.m] && (state.lineage[link.m].f === grandUid || state.lineage[link.m].m === grandUid)) {
    return 'mother';
  }
  return null;
}

// a 是栏位里那只，b 是候选。返回称呼，null = 三代以外 / 没有关系。
export function kinLabel(state, a, b) {
  if (!a || !b || a.uid === b.uid) return null;
  const A = a.ancestors || {};
  const B = b.ancestors || {};
  if (A[b.uid] != null) return ancestorLabel(A[b.uid], b.gender);
  if (B[a.uid] != null) return descendantLabel(B[a.uid], b.gender);

  let best = null;
  for (const u of Object.keys(A)) {
    if (B[u] == null) continue;
    const da = A[u];
    const db = B[u];
    const d = Math.max(da, db);
    if (!best || d < best.d || (d === best.d && da + db < best.sum)) {
      best = { grand: u, da, db, d, sum: da + db };
    }
  }
  if (!best || best.d >= 4) return null;

  const { grand, da, db, d } = best;
  const senior = uidNum(b.uid) < uidNum(a.uid);

  if (d === 1) {
    const sharedParents = Object.keys(A).filter((u) => A[u] === 1 && B[u] === 1).length;
    if (sharedParents < 2) {
      return byGender(b.gender, senior ? '半兄' : '半弟', senior ? '半姐' : '半妹', '半同胞');
    }
    return byGender(b.gender, senior ? '哥哥' : '弟弟', senior ? '姐姐' : '妹妹', '同胞');
  }

  if (d === 2 && da !== db) {
    if (db === 1) {
      // 候选是 a 的父辈旁系
      const side = parentSide(state, a, grand);
      if (side === 'father') {
        const fatherUid = state?.lineage?.[a.uid]?.f;
        const elder = fatherUid != null && uidNum(b.uid) < uidNum(fatherUid);
        return byGender(b.gender, elder ? '伯伯' : '叔叔', '姑姑', '长辈');
      }
      if (side === 'mother') return byGender(b.gender, '舅舅', '阿姨', '长辈');
      return byGender(b.gender, '叔叔', '阿姨', '长辈');
    }
    // 候选是 a 的子辈旁系：b 的父 / 母是 a 的兄弟姐妹
    const side = parentSide(state, b, grand);
    if (side === 'mother') return byGender(b.gender, '外甥', '外甥女', '晚辈');
    return byGender(b.gender, '侄子', '侄女', '晚辈');
  }

  if (d === 2) {
    const aSide = parentSide(state, a, grand);
    const bSide = parentSide(state, b, grand);
    if (aSide === 'father' && bSide === 'father') {
      return byGender(b.gender, senior ? '堂兄' : '堂弟', senior ? '堂姐' : '堂妹', '堂亲');
    }
    return byGender(b.gender, senior ? '表哥' : '表弟', senior ? '表姐' : '表妹', '表亲');
  }

  return '远房表亲';
}

// 子代体质：近亲 = min(双亲) × 档位乘数（下限 0.5）；非近亲 = 均值 + 0.2 杂种优势（封顶 1）
export function childVigor(a, b, multiplier) {
  const va = a?.vigor ?? 1;
  const vb = b?.vigor ?? 1;
  const raw = multiplier == null
    ? (va + vb) / 2 + CONFIG.hybridVigorBonus
    : Math.min(va, vb) * multiplier;
  const floor = CONFIG.vigorFloor;
  return Math.round(Math.min(1, Math.max(floor, raw)) * 1000) / 1000;
}

function createEgg(state, dexId, parents, source = BRED_SOURCE, mutant = false) {
  if (state.eggs.length >= eggSlots(state)) return null;
  const s = sp(dexId);
  const tier = parents ? kinTier(parents[0], parents[1]) : { multiplier: null };
  const vigor = mutant
    ? CONFIG.mutantVigor
    : parents
      ? childVigor(parents[0], parents[1], tier.multiplier)
      : 1;
  const ivs = {};
  for (const k of STAT_KEYS) {
    const base = parents ? (parents[0].ivs[k] + parents[1].ivs[k]) / 2 : 15;
    ivs[k] = clamp(Math.round(base + (random(state) * 10 - 5)), 0, 31);
  }
  const nature = parents ? pickOne(state, [parents[0].nature, parents[1].nature]) : pickOne(state, DEX.natures).id;
  const total = hatchDays(state, dexId);
  const father = parents?.find((p) => p?.gender === 'm') ?? null;
  const mother = parents?.find((p) => p?.gender === 'f') ?? null;
  const egg = {
    uid: uid(state),
    dexId,
    daysLeft: total,
    total,
    ivs,
    nature,
    gender: genderFromRate(state, s.genderRate),
    ability: pickOne(state, s.abilities),
    // 血统跟着蛋 → 个体走完整个生命周期
    ...lineageOf(parents),
    // 父方 / 母方：亲属称呼判定父系母系用；百变怪 / 无性别一侧为 null
    fatherUid: father?.uid ?? null,
    motherUid: mother?.uid ?? null,
    // 体质系数与“近亲后代”标记，同样跟着蛋 → 个体
    vigor,
    inbred: !mutant && tier.multiplier != null,
    // 畸形体：不育、体质触底，父母物种记在 mix 上
    mutant: !!mutant,
    mix: mutant && parents ? [parents[0].dexId, parents[1].dexId] : null,
    ...(mutant ? { sterile: true } : {}),
    // 来源跟着蛋进来，孵出后继续跟着个体
    source: source || BRED_SOURCE,
  };
  rememberLineage(state, egg);
  state.eggs.push(egg);
  return egg;
}

function hatch(state, egg, events) {
  const dexId = egg.dexId;
  const s = sp(dexId);
  const mon = createMon(state, dexId, 1, {
    uid: egg.uid,
    ivs: egg.ivs,
    nature: egg.nature,
    gender: egg.gender,
    ability: egg.ability,
    ancestors: egg.ancestors,
    gen: egg.gen,
    vigor: egg.vigor ?? 1,
    inbred: !!egg.inbred,
    mutant: !!egg.mutant,
    mix: egg.mix || null,
    sterile: egg.mutant ? true : undefined,
    fatherUid: egg.fatherUid ?? null,
    motherUid: egg.motherUid ?? null,
    origin: 'egg',
    source: egg.source,
  });
  state.mons.push(mon);
  // 孵出后默认留在围栏（闲置区），不自动塞进培育栏
  state.stats.hatched += 1;
  state.eggs = state.eggs.filter((e) => e.uid !== egg.uid);

  // 普通孵化只进日志；首次孵出该物种 / 虚弱 / 不孕 / 闪光才值得弹一次
  if (!state.everHatched) state.everHatched = {};
  const first = !state.everHatched[dexId];
  state.everHatched[dexId] = (state.everHatched[dexId] || 0) + 1;
  const weak = (mon.vigor ?? 1) < 0.85;
  const special = first || weak || !!mon.sterile || !!mon.shiny;
  const msg = weak
    ? `蛋孵化了：${s.zh}。它比同窝的弱得多。（已在围栏）`
    : `蛋孵化了：${s.zh}！（已在围栏）`;
  events.push({ type: 'egg', special, msg });
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
  const egg = createEgg(state, offer.dexId, null, offer.source || EGG_SOURCES[0]);
  if (!egg) return { ok: false, msg: '孵化器已满' };
  state.gold -= offer.price;
  state.stats.spent += offer.price;
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
    .filter((m) => !m.mutant && !labContains(state, m.uid) && penIndex(state, m.uid) === -1 && orderMatches(order, m))
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
  detachFromPens(state, uidMon);
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
  detachFromPens(state, uidMon);
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
  // 该位置还躺着遗体：先处理掉才能放新的
  if (pen[`${key}Corpse`]) return { ok: false, msg: '这个位置还留着一具遗体，先处理掉' };
  // 畸形体不育，放进培育栏只会白占位置
  if (mon.mutant) return { ok: false, msg: '畸形体不育，不能放进培育栏' };
  // 未发现蛋组的物种（传说 / 幻兽）永远配不了，别让它们进去白送一条命
  const groups = sp(mon.dexId)?.eggGroups || [];
  if (!isDitto(mon) && groups.includes('no-eggs')) {
    return { ok: false, msg: `${sp(mon.dexId).zh} 属于未发现蛋组，配不了` };
  }
  const other = monByUid(state, key === 'a' ? pen.b : pen.a);
  // 两只百变怪凑不出什么来，也不该为此打起来
  if (other && isDitto(other) && isDitto(mon)) {
    return { ok: false, msg: '两只百变怪凑不出什么来，分开放吧' };
  }
  const occupant = pen[key];
  if (occupant && occupant !== uidMon) {
    const free = !pen.a ? 'a' : !pen.b ? 'b' : null;
    if (!free) return { ok: false, msg: '该栏位已满' };
    pen[free] = occupant;
  }
  pen[key] = uidMon;
  pen.breed = 0;
  pen.notice = null;
  allocateMonNo(state, mon);
  return { ok: true, msg: `${sp(mon.dexId).zh} 进入栏位 ${penIdx + 1}` };
}

export function removeFromPen(state, uidMon) {
  const idx = penIndex(state, uidMon);
  if (idx === -1) return { ok: false, msg: '它不在栏位里' };
  const pen = state.pens[idx];
  if (pen.a === uidMon) pen.a = null;
  if (pen.b === uidMon) pen.b = null;
  pen.breed = 0;
  pen.notice = null;
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
  slot.corpse = { dexId: mon.dexId, no: mon.no, level: mon.level, gender: mon.gender, day: Math.floor(state.day), cause };
  state.mons = state.mons.filter((m) => m.uid !== mon.uid);
  detachFromPens(state, mon.uid);
  state.stats.released = (state.stats.released || 0) + 1;
  return { ok: true, name, corpse: true, slot: idx };
}

// 实验台彻底空出：遗体处理掉之后调用，助手也随之释放
function clearLabSlot(slot) {
  slot.uid = null;
  slot.corpse = null;
  slot.assistant = false;
  slot.auto = false;
  slot.spend = 0;
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

function leaveIdleCorpse(state, mon) {
  if (!state.idleCorpses) state.idleCorpses = [];
  state.idleCorpses.unshift({
    dexId: mon.dexId,
    no: mon.no,
    level: mon.level,
    gender: mon.gender,
    day: Math.floor(state.day),
    cause: 'bully',
  });
  if (state.idleCorpses.length > 50) state.idleCorpses.length = 50;
  state.mons = state.mons.filter((m) => m.uid !== mon.uid);
  detachFromPens(state, mon.uid);
  state.stats.released = (state.stats.released || 0) + 1;
}


export function processIdleCorpse(state, index) {
  const corpse = state.idleCorpses?.[index];
  if (!corpse) return { ok: false, msg: '这具遗体已经不在了' };
  const cost = CONFIG.idleCorpseProcessCost;
  if (state.gold < cost) return { ok: false, msg: `处理需要 ${cost} 资金` };
  state.gold -= cost;
  state.stats.spent = (state.stats.spent || 0) + cost;
  state.stats.corpseSpent = (state.stats.corpseSpent || 0) + cost;
  addSpeciesSpend(state, corpse.dexId, 'corpse', cost);
  state.idleCorpses.splice(index, 1);
  return { ok: true, msg: `已处理 ${sp(corpse.dexId).zh} 的遗体`, cost };
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
  const corpse = !!slot.corpse;
  const dexId = corpse ? slot.corpse.dexId : mon.dexId;
  state.gold -= cost;
  state.stats.spent = (state.stats.spent || 0) + cost;
  if (corpse) state.stats.corpseSpent = (state.stats.corpseSpent || 0) + cost;
  addSpeciesSpend(state, dexId, 'corpse', cost);
  const no = corpse ? slot.corpse.no : mon.no;
  const level = corpse ? slot.corpse.level : mon.level;
  const tracked = !isResearched(state, dexId);
  let msg;
  if (corpse) {
    msg = `已处理 ${sp(dexId).zh} 的遗体，实验台空出`;
  } else {
    const name = sp(mon.dexId).zh;
    state.mons = state.mons.filter((m) => m.uid !== mon.uid);
    detachFromPens(state, mon.uid);
    state.stats.released = (state.stats.released || 0) + 1;
    if (tracked) bumpResearchLoss(state, mon.dexId);
    msg = `已处理 ${name}，实验台空出`;
  }
  if (!corpse && tracked) logLabProcess(state, dexId, no, level);
  clearLabSlot(slot);
  return { ok: true, msg, cost, logged: !corpse && tracked };
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
  slot.assistant = false;
  slot.auto = false;
  slot.spend = 0;
  if (mon.tolerance == null) mon.tolerance = maxTolerance(mon);
  allocateMonNo(state, mon);
  return { ok: true, msg: `${sp(mon.dexId).zh} 被送进了实验室（只能实验或处理）` };
}

// 培育栏详情页的「放入实验室」：先把它从栏位里摘出来，再按正常流程送进实验台。
// assignLab 本身仍然只接受不在培育栏里的个体。
export function sendPenToLab(state, uidMon, slotIdx) {
  if (penIndex(state, uidMon) === -1) return { ok: false, msg: '它不在培育栏里' };
  const slot = state.lab[slotIdx];
  if (!slot) return { ok: false, msg: '实验室没有这个位置' };
  if (slot.uid || slot.corpse) return { ok: false, msg: '该实验台已被占用（含死亡个体）' };
  removeFromPen(state, uidMon);
  return assignLab(state, slotIdx, uidMon);
}

// ---------- 样本 / 终末榨取 / 实验室助手 ----------

export const samplesOf = (state, dexId) => state.samples?.[dexId] || 0;

function addSamples(state, dexId, n) {
  if (!state.samples) state.samples = {};
  state.samples[dexId] = (state.samples[dexId] || 0) + n;
  return state.samples[dexId];
}

// 该物种的每条实验是否都亲手做过——助手接手的前提
export function speciesHandled(state, dexId) {
  const list = experimentsFor(dexId);
  const log = state.expLog?.[dexId] || {};
  return list.length > 0 && list.every((e) => (log[e.id] || 0) > 0);
}

// 助手数量：职级 3 / 4 / 5 各给 1 个，最多 3 个
export const assistantSlots = (state) => clamp((state.rank ?? 0) - 2, 0, 3);
export const busyAssistants = (state) => state.lab.filter((s) => s.assistant).length;
export const freeAssistants = (state) => Math.max(0, assistantSlots(state) - busyAssistants(state));

// 正态取样：两次均匀数做 Box–Muller，仍然走种子化 LCG，可复现
function gauss(state) {
  const u1 = Math.max(1e-9, random(state));
  const u2 = random(state);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function canFinalExtraction(state, slotIdx) {
  const slot = state.lab[slotIdx];
  if (slot?.corpse) return { ok: false, msg: '实验台上只剩遗体' };
  const mon = slot?.uid ? monByUid(state, slot.uid) : null;
  if (!mon) return { ok: false, msg: '实验台是空的' };
  // 畸形体没有物种研究可言，随时可以榨
  if (!mon.mutant && !isResearched(state, mon.dexId)) return { ok: false, msg: '这个物种还没研究完' };
  if (state.gold < CONFIG.finalExtractionCost) return { ok: false, msg: '耗材不足' };
  return { ok: true, mon, slot };
}

// 终末榨取：一次必死，产出样本（数量随当前耐受，正态分布）
export function finalExtraction(state, slotIdx) {
  const chk = canFinalExtraction(state, slotIdx);
  if (!chk.ok) return chk;
  const mon = chk.mon;
  const dexId = mon.dexId;
  const name = sp(dexId).zh;
  const mu = Math.max(1, Math.max(0, mon.tolerance) / CONFIG.sampleMuDivisor);
  const sd = Math.max(0.6, mu * CONFIG.sampleSigmaRatio);
  const cap = Math.max(1, Math.ceil(mu * 2));
  const amount = mon.mutant
    ? CONFIG.mutantSamples
    : clamp(Math.round(mu + sd * gauss(state)), 1, cap);

  state.gold -= CONFIG.finalExtractionCost;
  state.stats.spent = (state.stats.spent || 0) + CONFIG.finalExtractionCost;
  state.stats.experimentSpent = (state.stats.experimentSpent || 0) + CONFIG.finalExtractionCost;
  addSpeciesSpend(state, dexId, 'exp', CONFIG.finalExtractionCost);
  addSamples(state, dexId, amount);

  const r = leaveLabCorpse(state, mon, 'extracted');
  return { ok: true, amount, dexId, name, corpseSlot: r.slot, msg: `处置完成 · 样本已耗尽` };
}

// 助手一旦接手，就一直占用这台实验台，直到台子清空（遗体处理掉）
export function canAssignAssistant(state, slotIdx) {
  const slot = state.lab[slotIdx];
  const mon = slot?.uid ? monByUid(state, slot.uid) : null;
  if (!mon) return { ok: false, msg: '实验台是空的' };
  if (isResearched(state, mon.dexId)) return { ok: false, msg: '这个物种已经研究完成' };
  if (slot.assistant) return { ok: false, msg: '已经安排了助手' };
  if (!speciesHandled(state, mon.dexId)) return { ok: false, msg: '这个物种还有实验没亲手做过' };
  if (freeAssistants(state) <= 0) return { ok: false, msg: '没有空闲的助手' };
  return { ok: true, mon, slot };
}

export function assignAssistant(state, slotIdx) {
  const chk = canAssignAssistant(state, slotIdx);
  if (!chk.ok) return chk;
  chk.slot.assistant = true;
  chk.slot.auto = true;
  chk.slot.spend = 0;
  logAssistant(state, chk.mon, 'assistant-start');
  return { ok: true, msg: '助手接手了这台实验台' };
}

export function interruptAssistant(state, slotIdx) {
  const slot = state.lab[slotIdx];
  if (!slot?.assistant) return { ok: false, msg: '这台实验台没有助手' };
  if (!slot.auto) return { ok: false, msg: '助手已经停下了' };
  slot.auto = false;
  const mon = slot.uid ? monByUid(state, slot.uid) : null;
  if (mon) logAssistant(state, mon, 'assistant-takeover');
  return { ok: true, msg: '你接过了这台实验台' };
}

export function resumeAssistant(state, slotIdx) {
  const slot = state.lab[slotIdx];
  if (!slot?.assistant) return { ok: false, msg: '这台实验台没有助手' };
  const mon = slot.uid ? monByUid(state, slot.uid) : null;
  if (!mon) return { ok: false, msg: '实验台是空的' };
  if (isResearched(state, mon.dexId)) return { ok: false, msg: '这个物种已经研究完成' };
  slot.auto = true;
  return { ok: true, msg: '助手重新接手' };
}

export const RELEASE_TEXT = {
  exhausted: '耗尽了耐受度，倒下了',
  overload: '没能承受住实验，死在了实验台上',
  threat: '被实验的动静吓得耗尽耐受度，瘫倒在地',
  manual: '被放生了',
};

export function releaseMon(state, uidMon, reason = 'manual') {
  const mon = monByUid(state, uidMon);
  if (!mon) return { ok: false, msg: '找不到宝可梦' };
  const name = sp(mon.dexId).zh;
  state.mons = state.mons.filter((m) => m.uid !== uidMon);
  for (const slot of state.lab) if (slot.uid === uidMon) clearLabSlot(slot);
  detachFromPens(state, uidMon);
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

function logExperimentRun(state, mon, exp, survived, cause = null, completed = false) {
  if (!state.expJournal) state.expJournal = [];
  state.expJournal.unshift({
    day: Math.floor(state.day),
    no: mon.no,
    dexId: mon.dexId,
    level: mon.level,
    expId: exp.id,
    expName: exp.name,
    survived,
    cause,
    completed: !!completed,
  });
  if (state.expJournal.length > 500) state.expJournal.length = 500;
}

function logLabProcess(state, dexId, no, level) {
  if (isResearched(state, dexId)) return false;
  if (!state.expJournal) state.expJournal = [];
  state.expJournal.unshift({
    day: Math.floor(state.day),
    no,
    dexId,
    level,
    expId: 'process',
    expName: '处理',
    survived: false,
    cause: 'processed',
    result: '它被从实验台上拖走，按流程处理掉了；编号被划掉，实验台重新空了出来。',
  });
  if (state.expJournal.length > 500) state.expJournal.length = 500;
  return true;
}

// 助手节点：只记「安排助手」与「你决定亲自动手」两个瞬间，不逐条记进度
function logAssistant(state, mon, kind) {
  if (!state.expJournal) state.expJournal = [];
  state.expJournal.unshift({
    day: Math.floor(state.day),
    no: mon.no,
    dexId: mon.dexId,
    level: mon.level,
    expId: kind,
    expName: kind === 'assistant-start' ? '安排助手对其进行实验' : '你决定亲自动手',
    survived: true,
  });
  if (state.expJournal.length > 500) state.expJournal.length = 500;
}

function logLabDeath(state, mon, cause) {
  // 畸形体没有物种研究，不写进任何研究笔记
  if (mon.mutant) return;
  // 该物种研究已满：不再往研究笔记里写任何实验日志
  if (isResearched(state, mon.dexId)) return;
  if (!state.expJournal) state.expJournal = [];
  state.expJournal.unshift({
    day: Math.floor(state.day),
    no: mon.no,
    dexId: mon.dexId,
    level: mon.level,
    expId: 'lab-death',
    expName: '实验室事故',
    survived: false,
    cause,
    result:
      cause === 'threat'
        ? '它被旁边实验的动静吓得拼命挣扎，最后瘫倒在实验台上，没能再起来。'
        : '它在实验台上挣扎了很久，耐受度一点点耗尽，最后倒了下去。',
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

  // 畸形体没有研究价值：不推进任何物种，只能处理或终末榨取
  if (mon.mutant) return { ok: false, msg: '它提供不了有用的数据' };

  // 该物种研究已满：实验结束，只剩终末榨取
  if (isResearched(state, mon.dexId)) {
    return { ok: false, msg: '这个物种已经研究完成，只剩终末榨取' };
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
    // 研究已满的物种不再写实验日志（noCd 此时就是"已完成研究"）
    if (!noCd) logExperimentRun(state, mon, exp, false, 'overload');
    const r = leaveLabCorpse(state, mon, 'overload');
    return {
      ok: true,
      released: true,
      corpse: true,
      corpseSlot: r.slot,
      result: { survived: false },
      msg: `实验超出了 ${r.name} 的耐受极限，${r.name} 在实验台上断了气，数据没能留下`,
    };
  }

  state.gold -= exp.cost;
  state.stats.spent += exp.cost;
  state.stats.experimentSpent = (state.stats.experimentSpent || 0) + exp.cost;
  addSpeciesSpend(state, mon.dexId, 'exp', exp.cost);
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
  const researchCompleted = !!res.unlocked;
  const name = sp(mon.dexId).zh;
  const events = [];
  if (res.unlocked) completeResearch(state, mon, events);
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
        logLabDeath(state, target, 'threat');
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
    if (!noCd) logExperimentRun(state, mon, exp, false, 'exhausted', researchCompleted);
    const r = leaveLabCorpse(state, mon, 'exhausted');
    events.push({ type: 'warn', msg: `${name} 的耐受度耗尽，倒在了实验台上` });
    return {
      ok: true,
      released: true,
      corpse: true,
      corpseSlot: r.slot,
      events,
      result: { survived: false },
      msg: `实验完成，${name} 没能走下实验台`,
      loss,
      intensity,
    };
  }

  if (!noCd) logExperimentRun(state, mon, exp, true, null, researchCompleted);
  return { ok: true, events, msg: `实验完成（${exp.name}）`, loss, intensity, result: { survived: true } };
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
//   · 蛋组不匹配：同样产蛋，但先过一次死胎，活下来的是畸形体，父母双方都要掉耐受度
//   · 注定配不成（不孕 / 无性别 / 双百变怪 / 未发现蛋组）：条不再空转，只提示一次
function penSlotOf(pen, uidMon) {
  if (pen.a === uidMon) return 'a';
  if (pen.b === uidMon) return 'b';
  return null;
}

// 繁育里的一方力竭：留下遗体并报警。返回 true 表示它死了。
function exhaustIfNeeded(state, mon, pen, penIdx, events) {
  if (!mon || mon.tolerance > 0 || !monByUid(state, mon.uid)) return false;
  const name = leavePenCorpse(state, mon, 'exhausted', pen, penSlotOf(pen, mon.uid));
  events.push({ type: 'warn', pen: penIdx, exhausted: true, msg: `${name} 在繁育中耗尽了耐受度，力竭而死` });
  return true;
}

// 培育栏里的死亡会留下遗体，占住那个位置，直到花钱处理
function leavePenCorpse(state, mon, cause, pen, slot) {
  const name = sp(mon.dexId).zh;
  state.mons = state.mons.filter((m) => m.uid !== mon.uid);
  if (pen && slot) {
    pen[slot] = null;
    pen[`${slot}Corpse`] = {
      dexId: mon.dexId,
      no: mon.no,
      level: mon.level,
      gender: mon.gender,
      day: Math.floor(state.day),
      cause,
    };
  }
  state.stats.released = (state.stats.released || 0) + 1;
  return name;
}

export function penCorpseCost(state, penIdx, slot) {
  const pen = state.pens[penIdx];
  const key = slot === 'b' ? 'b' : 'a';
  return pen?.[`${key}Corpse`] ? CONFIG.penCorpseProcessCost : 0;
}

export function processPenCorpse(state, penIdx, slot) {
  const pen = state.pens[penIdx];
  const key = slot === 'b' ? 'b' : 'a';
  if (!pen?.[`${key}Corpse`]) return { ok: false, msg: '这里没有遗体' };
  const cost = CONFIG.penCorpseProcessCost;
  if (state.gold < cost) return { ok: false, msg: `资金不足（处理遗体要 ${cost} 资金）` };
  state.gold -= cost;
  state.stats.spent += cost;
  state.stats.corpseSpent = (state.stats.corpseSpent || 0) + cost;
  pen[`${key}Corpse`] = null;
  return { ok: true, msg: `处理掉了一具遗体（${cost} 资金）` };
}

// 培育栏状态：UI 与 tick 共用同一口径。
// 注意：不在状态里泄露蛋组是否匹配——博士只能靠试。
export function penStatus(state, pen) {
  const a = monByUid(state, pen?.a);
  const b = monByUid(state, pen?.b);
  if (!a || !b) return { kind: 'idle' };
  const comp = compatibility(a, b);
  if (comp.ok) {
    if (state.eggs.length >= eggSlots(state)) return { kind: 'waiting-egg', a, b };
    return { kind: 'breeding', a, b };
  }
  if (comp.sterile) return { kind: 'sterile', a, b, reason: comp.reason };
  if (comp.quiet) return { kind: 'quiet', a, b, reason: comp.reason };
  return { kind: 'breeding', a, b };
}

function resolvePen(state, pen, events, penIdx = null) {
  const a = monByUid(state, pen.a);
  const b = monByUid(state, pen.b);
  if (!a || !b) {
    pen.breed = 0;
    return { kind: 'none' };
  }
  if (pen.breed < CONFIG.breedDays) return { kind: 'waiting' };

  const comp = compatibility(a, b);
  if (comp.ok) {
    if (state.eggs.length >= eggSlots(state)) {
      // 孵化器满了，先憋着，不惩罚
      pen.breed = CONFIG.breedDays;
      return { kind: 'egg-full' };
    }
    const mother = breedCostBearer(a, b);
    const father = mother === a ? b : a;
    const mismatch = !!comp.mismatch;
    const motherCost = mismatch ? CONFIG.crossGroupMotherCost : CONFIG.breedToleranceCost;
    const fatherCost = mismatch ? CONFIG.crossGroupFatherCost : 0;

    // 死胎：跨蛋组先过一次 30%，再按母方体质过一次——两个独立判定
    const crossStill = mismatch && random(state) < CONFIG.crossGroupStillbirth;
    const weakStill = random(state) < stillbirthChance(mother.vigor ?? 1);
    const stillborn = crossStill || weakStill;

    // 死胎也照常付这一胎的代价，只是没有产出
    mother.tolerance -= motherCost;
    if (fatherCost) father.tolerance -= fatherCost;
    pen.breed = 0;
    if (stillborn) {
      events.push({ type: 'warn', pen: penIdx, stillbirth: true, msg: '这一胎没有成型。母体照样耗掉了这一次。' });
    } else {
      const dexId = childSpecies(a, b);
      const egg = dexId ? createEgg(state, dexId, [a, b], BRED_SOURCE, mismatch) : null;
      if (egg) {
        state.stats.bred += 1;
        events.push(
          mismatch
            ? { type: 'egg', pen: penIdx, mutant: true, msg: `配种成功：孵化器中多了一枚 ${sp(dexId).zh} 的蛋，但它看起来不对劲` }
            : { type: 'egg', pen: penIdx, msg: `配种成功：孵化器中多了一枚 ${sp(dexId).zh} 的蛋` }
        );
      }
    }

    // 先产出（或先记录死胎），再判力竭——母体的最后一胎不会被吞掉
    const motherDied = exhaustIfNeeded(state, mother, pen, penIdx, events);
    if (!motherDied) exhaustIfNeeded(state, father, pen, penIdx, events);
    if (stillborn) return { kind: motherDied ? 'exhausted' : 'stillbirth' };
    return { kind: 'egg' };
  }

  // 不孕 / 不育：不会产蛋
  if (comp.sterile) {
    pen.breed = 0;
    events.push({ type: 'warn', pen: penIdx, sterile: true, msg: `${comp.reason}，本次无法繁育` });
    return { kind: 'sterile' };
  }

  // 注定配不成（双百变怪 / 未发现蛋组 / 无性别 / 同性）
  pen.breed = 0;
  events.push({ type: 'info', pen: penIdx, quiet: true, msg: comp.reason });
  return { kind: 'quiet' };
}

// ---------- 围栏霸凌 ----------
// 不在培育栏、也不在实验室的个体才算“围栏里的”；同物种同性别会互相霸凌
function idleGroups(state) {
  const groups = new Map();
  for (const mon of idleMons(state)) {
    // 百变怪不参与围栏霸凌，也不会形成霸凌群体
    if (isDitto(mon)) continue;
    const key = `${mon.dexId}:${mon.gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mon);
  }
  return groups;
}

// 给界面用：哪些群体正在围栏里被霸凌
export function idleConflicts(state) {
  const out = [];
  for (const [key, list] of idleGroups(state)) {
    if (list.length < CONFIG.bullyMinGroup) continue;
    const [dexId, gender] = key.split(':');
    const weakest = list.reduce((w, m) => weakerOf(w, m)[0], list[0]);
    out.push({ dexId: Number(dexId), gender, count: list.length, weakestUid: weakest.uid });
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

  // 实验室助手：连续 tick 推进（不模拟离散实验，不跑冷却）
  if (realSeconds > 0) {
    for (const slot of state.lab) {
      if (!slot.auto || !slot.uid) continue;
      const mon = monByUid(state, slot.uid);
      if (!mon) {
        slot.auto = false;
        continue;
      }
      if (isResearched(state, mon.dexId) || mon.mutant) {
        slot.auto = false;
        continue;
      }

      // 耗材：零头累加，攒够整数再扣；钱不够就这一 tick 不推进（助手仍占用）
      slot.spend = (slot.spend || 0) + CONFIG.assistantGoldPerSec * realSeconds;
      const whole = Math.floor(slot.spend);
      if (whole > 0) {
        if (state.gold < whole) {
          slot.paused = 'gold';
          continue;
        }
        state.gold -= whole;
        state.stats.spent = (state.stats.spent || 0) + whole;
        state.stats.experimentSpent = (state.stats.experimentSpent || 0) + whole;
        addSpeciesSpend(state, mon.dexId, 'exp', whole);
        slot.spend -= whole;
      }
      slot.paused = null;

      const res = addResearch(state, mon.dexId, CONFIG.assistantProgressPerSec * realSeconds);
      mon.tolerance = Math.max(0, mon.tolerance - CONFIG.assistantTolerancePerSec * realSeconds);

      if (res.unlocked) {
        completeResearch(state, mon, events);
        slot.auto = false;
        continue;
      }
      if (mon.tolerance <= 0) {
        bumpResearchLoss(state, mon.dexId);
        logLabDeath(state, mon, 'exhausted');
        leaveLabCorpse(state, mon, 'exhausted');
        slot.auto = false;
        events.push({ type: 'warn', msg: `${sp(mon.dexId).zh} 在实验台上耗尽了耐受度，倒了下去` });
      }
    }
  }

  // 配种
  for (let i = 0; i < state.pens.length; i++) {
    const pen = state.pens[i];
    const st = penStatus(state, pen);
    if (st.kind === 'idle') {
      pen.breed = 0;
      pen.notice = null;
      continue;
    }
    // 注定配不成的组合：条不再空转，每个组合只提示一次
    if (st.kind === 'locked' || st.kind === 'sterile' || st.kind === 'quiet') {
      pen.breed = 0;
      if (pen.notice !== st.kind) {
        pen.notice = st.kind;
        const quiet = st.kind === 'quiet';
        events.push({
          type: quiet ? 'info' : 'warn',
          pen: i,
          ...(st.kind === 'sterile' ? { sterile: true } : {}),
          ...(quiet ? { quiet: true } : {}),
          msg: quiet ? st.reason : `${st.reason}，本次无法繁育`,
        });
      }
      continue;
    }
    pen.notice = null;
    pen.breed += dtDays;
    resolvePen(state, pen, events, i);
  }

  // 孵化
  for (const egg of [...state.eggs]) {
    egg.daysLeft -= dtDays;
    if (egg.daysLeft <= 0) hatch(state, egg, events);
  }

  // 围栏霸凌：同种同性达到 4 只后，从第四个起最弱的那只被持续霸凌（百变怪不参与）
  const bullyDeaths = new Set();
  for (const list of idleGroups(state).values()) {
    const n = list.length;
    if (n < CONFIG.bullyMinGroup) continue;
    const weakest = list.reduce((w, m) => weakerOf(w, m)[0], list[0]);
    const loss = CONFIG.bullyRatePerExtraDay * (n - (CONFIG.bullyMinGroup - 1)) * dtDays;
    if (loss <= 0) continue;
    weakest.tolerance -= loss;
    if (weakest.tolerance <= 0) bullyDeaths.add(weakest.uid);
  }

  // 耐受度见底：实验室留下遗体占位，霸凌致死留围栏遗体，培育栏也留遗体，其他位置离队
  for (const mon of [...state.mons]) {
    if (mon.tolerance <= 0) {
      const name = sp(mon.dexId).zh;
      if (bullyDeaths.has(mon.uid)) {
        leaveIdleCorpse(state, mon);
        events.push({ type: 'warn', msg: `${name} 在围栏里被同类霸凌致死，遗体留在了围栏` });
        continue;
      }
      const inLab = labContains(state, mon.uid);
      const penIdx = penIndex(state, mon.uid);
      const inPen = penIdx !== -1;
      if (inLab) {
        logLabDeath(state, mon, 'struggle');
        leaveLabCorpse(state, mon, 'struggle');
      } else if (inPen) {
        const pen = state.pens[penIdx];
        leavePenCorpse(state, mon, 'exhausted', pen, penSlotOf(pen, mon.uid));
      } else {
        releaseMon(state, mon.uid, 'exhausted');
      }
      const msg = inLab
        ? `${name} 在实验台上挣扎到最后一刻，倒了下去`
        : inPen
          ? `${name} 在培育栏里耗尽了耐受度，倒下了`
          : `${name} 在围栏里耗尽了耐受度，没能撑过去`;
      events.push({ type: 'warn', ...(inPen ? { pen: penIdx } : {}), msg });
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

// 研究笔记里某个已完成物种的研究记录
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
