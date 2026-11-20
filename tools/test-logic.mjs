// 逻辑层冒烟测试：模拟 300 天，检查不变量与经济
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as L from '../js/logic.mjs';
import { CONFIG, RANKS, BASE_EXPERIMENTS, EXPERIMENT_TIERS, DEPARTMENTS, BRED_SOURCE, EGG_SOURCES, UPGRADE_INFO, maxTolerance } from '../js/rules.mjs';
import { serialize, deserialize } from '../js/save.mjs';
import { initDex, initExperiments, sp, bst } from '../js/data.mjs';

const dex = JSON.parse(await readFile(fileURLToPath(new URL('../data/dex.json', import.meta.url)), 'utf8'));
initDex(dex);
const experimentData = JSON.parse(await readFile(fileURLToPath(new URL('../data/experiments.json', import.meta.url)), 'utf8'));
initExperiments(experimentData);

let failures = 0;
const check = (cond, label, extra = '') => {
  if (!cond) {
    failures++;
    console.log(`FAIL ${label} ${extra}`);
  } else {
    console.log(`ok   ${label} ${extra}`);
  }
};

const state = L.newGame(12345);
check(state.mons.length === 3, '初始 3 只宝可梦');
check(state.orders.length === 2, '初始订单');
check(state.market.length === 3, '初始蛋市场');
check(state.candies === CONFIG.startCandies, '初始经验糖果', `(${state.candies})`);
check(state.mons.every((m) => m.tolerance === maxTolerance(m)), '所有个体出厂即带满耐受度');

// 个体编号：出生不编号，首次进入培育栏/实验室才分配
const noState = L.newGame(9900);
const [starterA, starterB] = noState.mons;
check(starterA.no === 1 && starterB.no === 2, '初始培育栏个体已分配编号');
const unborn = L.createMon(noState, 16, 5, { gender: 'm' });
noState.mons.push(unborn);
check(unborn.no == null, '围栏中的新生个体没有编号');
check(noState.nextMonNo === 3, '未入栏个体不占用编号');
L.assignPen(noState, 1, 'a', unborn.uid);
check(unborn.no === 3, '进入培育栏后分配编号');
const unbornLab = L.createMon(noState, 16, 5, { gender: 'm' });
noState.mons.push(unbornLab);
L.assignLab(noState, 0, unbornLab.uid);
check(unbornLab.no === 4, '进入实验室后分配编号');
const stillIdle = L.createMon(noState, 16, 5, { gender: 'm' });
noState.mons.push(stillIdle);
check(deserialize(serialize(noState)).mons.find((m) => m.uid === stillIdle.uid)?.no == null, '存档保留围栏未编号状态');

// 基础兼容性
const [a, b] = state.mons;
check(!L.compatibility(a, a).ok, '不能和自己配种');
check(L.compatibility(a, b).ok, '波波 + 烈雀 可配种（同为飞行组）');

// 蛋组一开始未知
check(L.eggGroupsDisplay(state, 16) === '？？？', '未确认前蛋组显示为 ？？？', L.eggGroupsDisplay(state, 16));
check(L.knownEggGroups(state, 16).length === 0, '初始没有任何蛋组知识');

// 培育栏放入规则：已在其他栏位 / 实验室的个体都不能再放入
const penState = L.newGame(5700);
const [pA] = penState.mons;
check(L.assignPen(penState, 1, 'a', pA.uid).ok === false, '已在培育栏的个体不能再放入其他栏位');
check(L.penIndex(penState, pA.uid) === 0, '原栏位保持不变');
const penLabMon = L.createMon(penState, 19, 5, { gender: 'f' });
penState.mons.push(penLabMon);
L.assignLab(penState, 0, penLabMon.uid);
check(L.assignPen(penState, 1, 'a', penLabMon.uid).ok === false, '实验室里的个体不能放入培育栏');
const penIdleMon = L.createMon(penState, 16, 5, { gender: 'f' });
penState.mons.push(penIdleMon);
check(L.assignPen(penState, 1, 'a', penIdleMon.uid).ok, '空闲个体可以放入培育栏');
check(L.assignPen(penState, 2, 'a', penIdleMon.uid).ok === false, '已放入培育栏的个体不能再放到其他栏位');

// 喂食：只增加经验
const lv0 = a.level;
const exp0 = a.exp;
L.buyCandies(state, 5);
const candiesAfterBuy = state.candies;
L.feed(state, a.uid);
check(state.candies === candiesAfterBuy - 1, '喂食消耗经验糖果', `(${state.candies})`);
check(a.level > lv0 || a.exp > exp0, '喂食增加经验');
check(L.compatibility(a, b).ok, '无需亲密度即可配种');

// 模拟：每 0.25 天做一次决策
let totalEvents = [];
const dt = 0.25;
let delivered = 0;
for (let i = 0; i < 1200; i++) {
  const events = L.tick(state, dt);
  totalEvents.push(...events);

  // 有可交付订单就交付
  for (const order of [...state.orders]) {
    const cands = L.deliverableMons(state, order);
    if (cands.length) {
      const res = L.deliver(state, order.id, cands[0].uid);
      if (res.ok) delivered++;
    }
  }
  // 有空蛋位就买蛋
  if (state.eggs.length < L.eggSlots(state) && state.gold > 600) L.buyEggOffer(state, 0);
  // 缺糖果就补
  if (state.candies < 5 && state.gold > 200) L.buyCandies(state, 10);
  // 偶尔升级设施（先攒声望晋升，再升级）
  if (state.gold > 6000 && L.upgradeCost(state, 'incubator') != null && state.upgrades.incubator < 2) L.buyUpgrade(state, 'incubator');
  if (state.gold > 9000 && state.pens.length < 5) L.buyUpgrade(state, 'pens');
}

console.log(`\n--- 模拟 300 天后 ---`);
console.log(`天数=${state.day.toFixed(1)} 金币=${state.gold} 糖果=${state.candies} 声望=${state.rep} 职级=${L.currentRank(state).name}`);
console.log(`宝可梦=${state.mons.length} 蛋=${state.eggs.length} 订单=${state.orders.length} 已完成研究笔记=${state.dex.length}`);
console.log(`交付=${delivered} 孵化=${state.stats.hatched} 配种=${state.stats.bred} 争斗=${state.stats.fights} 过期=${state.stats.expired}`);
console.log(`事件=${totalEvents.length} 进化=${totalEvents.filter((e) => e.type === 'evolve').length} 升级=${totalEvents.filter((e) => e.type === 'level').length}`);

check(Number.isFinite(state.gold) && state.gold >= 0, '金币合法');
check(state.mons.every((m) => Number.isFinite(m.exp) && Number.isFinite(m.level) && m.level >= 1 && m.level <= CONFIG.maxLevel), '宝可梦数值合法');
check(new Set(state.mons.map((m) => m.uid)).size === state.mons.length, 'UID 唯一');
check(state.eggs.length <= L.eggSlots(state), '蛋位不超上限');
check(state.orders.length <= L.orderSlots(state), '订单不超上限');
check(state.dex.length === 0, '未做实验的物种不解锁研究笔记', `(${state.dex.length})`);
check(state.mons.every((m) => m.tolerance > 0), '耐受度见底的个体都会在推进中被放生');
check(totalEvents.some((e) => e.type === 'evolve'), '发生过进化');
check(delivered > 0, '完成过交付', `(${delivered})`);

// 存档往返
const raw = serialize(state);
const loaded = deserialize(raw);
check(!!loaded, '存档可反序列化');
check(loaded.gold === state.gold && loaded.mons.length === state.mons.length, '存档字段一致');
check(deserialize(JSON.stringify({ v: 1, mons: [] })) === null, '旧版本存档被忽略');

// ---------- 实验室 ----------
const reqPidgey = L.researchRequirement(16);
const reqMew = L.researchRequirement(151);
check(reqPidgey === 40, '波波研究要求 40', `(${reqPidgey})`);
check(reqMew === 334, '梦幻研究要求更高', `(${reqMew})`);

// ---------- 实验组成：专属 + 强度补足 ----------
const e16 = L.experimentsFor(16);
check(e16.length === 5, '2 条专属补足到 5 条', `(${e16.length})`);
check(['measure', 'sample', 'battle'].every((id) => e16.some((e) => e.id === id)), '2 条专属补齐基础三条');
check(e16.every((e, i, arr) => i === 0 || arr[i - 1].progress <= e.progress), '实验按强度升序排列', e16.map((e) => e.progress).join(','));

const e1 = L.experimentsFor(1);
check(e1.length === 5, '4 条专属补足到 5 条', `(${e1.length})`);
check(e1.some((e) => e.id === 'battle') && !e1.some((e) => e.id === 'sample'), '4 条专属只补对战测试');
check(e1[0].id === 'sp1-fasting' && e1[1].id === 'sp1-seed-weight', '专属条按强度排序');

const e3 = L.experimentsFor(3);
check(e3.length === 5, '5 条专属保持 5 条');
check(!e3.some((e) => ['measure', 'sample', 'battle'].includes(e.id)), '5 条专属不再补基础实验');

const e143 = L.experimentsFor(143);
check(e143.length === 5, '3 条专属补足到 5 条');
check(e143.some((e) => e.id === 'battle') && e143.some((e) => e.id === 'sample') && !e143.some((e) => e.id === 'measure'), '3 条专属补对战与采样');

const customState = L.newGame(8400);
const customMon = L.createMon(customState, 1, 10, { gender: 'm' });
customState.mons.push(customMon);
L.assignLab(customState, 0, customMon.uid);
const goldBeforeCustom = customState.gold;
const customRes = L.startExperiment(customState, customMon.uid, 'sp1-fasting');
check(customRes.ok, '专属实验可执行');
check(L.researchProgress(customState, 1) === 3, '专属实验给进度', `(${L.researchProgress(customState, 1)})`);
check(customState.gold === goldBeforeCustom - 30, '专属实验扣资金', `(${customState.gold})`);
check(L.experimentCooldown(customState, customMon.uid, 'sp1-fasting') > 0, '专属实验进入冷却');
const customOther = L.startExperiment(customState, customMon.uid, 'sp1-seed-weight');
check(customOther.ok, '专属实验冷却互相独立');
check(L.dexRecordText({ experiments: { 'sp1-fasting': 2, 'sp1-seed-cut': 1 } }) === '断食观察×2 · 切除背上的种子×1', '研究笔记记录能显示专属实验名');

const lab = L.newGame(2025);
const subject = L.createMon(lab, 16, CONFIG.maxLevel, { origin: 'test', gender: 'm' });
lab.mons.push(subject);

check(L.assignLab(lab, 0, subject.uid).ok, '可以放进实验室');
check(subject.tolerance === maxTolerance(subject), '进实验室耐受度满值', `(${subject.tolerance})`);
check(L.assignLab(lab, 1, subject.uid).ok === false, '同一只不能重复放入');
check(L.feed(lab, subject.uid).ok === false, '实验室里的不能喂食');
check(L.sellMon(lab, subject.uid).ok === false, '实验室里的不能出售');

const gold0 = lab.gold;
const exp1 = L.startExperiment(lab, subject.uid, 'measure');
check(exp1.ok && !exp1.released, '基础体测成功');
check(exp1.result?.survived === true, '实验返回生还状态');
check(!('text' in (exp1.result || {})), '实验返回值不再包含结果文案');
check(lab.expJournal?.[0]?.no === subject.no && lab.expJournal[0].expName === '基础体测', '实验写入个体日志');
check(!('result' in (lab.expJournal?.[0] || {})), '实验日志不再写入结果文案');
check(exp1.intensity > 0 && exp1.intensity <= 1, '实验返回动效烈度', `(${exp1.intensity})`);
check(subject.tolerance < maxTolerance(subject), '耐受度下降', `(${subject.tolerance})`);
check(L.researchProgress(lab, 16) === 2, '研究进度 +2（已下调）');
check(lab.gold === gold0 - 15, '基础体测不再免费', `(${lab.gold})`);
check(lab.stats.experimentSpent === 15, '记录实验行为消耗总额');
check(BASE_EXPERIMENTS.every((e) => e.cost > 0), '没有免费的实验行为');

const exp2 = L.startExperiment(lab, subject.uid, 'sample');
check(lab.gold === gold0 - 60, '实验扣除资金', `(${lab.gold})`);
check(lab.stats.experimentSpent === 60, '实验成本累加');
check(L.researchProgress(lab, 16) === 6, '进度累加');

// 继续实验直到解锁：每个实验行为都要至少做一次（隐藏的 2% 门槛）
let guard2 = 0;
const anySubject = () => lab.mons.find((m) => m.dexId === 16 && L.labContains(lab, m.uid)) || null;
const expIds16 = L.experimentsFor(16).map((e) => e.id);
while (!L.isResearched(lab, 16) && guard2 < 400) {
  let subj = anySubject();
  if (!subj) {
    subj = L.createMon(lab, 16, CONFIG.maxLevel, { origin: 'test', gender: 'm' });
    lab.mons.push(subj);
    const freeSlot = lab.lab.findIndex((slot) => !slot.uid);
    if (freeSlot === -1) break;
    L.assignLab(lab, freeSlot, subj.uid);
    subj = anySubject();
  }
  if (!subj) break;
  subj.tolerance = 2000; // 测试夹具：只看研究门槛，不让个体中途死亡
  const r = L.startExperiment(lab, subj.uid, expIds16[guard2 % expIds16.length]);
  if (!r.ok) L.tick(lab, 0.5);
  guard2++;
}
check(L.isResearched(lab, 16), '累计进度达到要求');
const completedLog = (lab.expJournal || []).find((e) => e.completed);
check(completedLog?.dexId === 16 && completedLog.completed === true, '完成研究的实验日志带完成标记');
check(!('result' in (completedLog || {})), '完成研究的日志不含结果文案');
check(Object.keys(lab.expCd).length === 0, '研究完成时清空所有实验冷却');
check(L.experimentCooldownFor(lab, subject, 'sp16-stress-threshold') === 0, '研究完成后不再有冷却');
check(lab.dex.includes(16), '研究完成后解锁研究笔记');
check(!!lab.dexRecords[16], '完成的研究笔记条目留下研究记录');
check((lab.dexRecords[16].experiments.measure || 0) > 0, '记录里包含基础体测');
check(L.dexRecordText(lab.dexRecords[16]).includes('基础体测'), '研究行为可读', L.dexRecordText(lab.dexRecords[16]));
check(L.knownEggGroups(lab, 16).length === sp(16).eggGroups.length, '研究完成补全蛋组信息');
check(!L.eggGroupsDisplay(lab, 16).includes('？？？'), '研究完成后蛋组不再隐藏');

// 隐藏的 2% 门槛：有实验行为没做过时，进度卡在 98%
const gate = L.newGame(5700);
const gateMon = L.createMon(gate, 16, 20, { gender: 'm' });
gate.mons.push(gateMon);
L.assignLab(gate, 0, gateMon.uid);
gateMon.tolerance = 2000;
const gateReq = L.researchRequirement(16);
gate.research[16] = gateReq - 1;
const gateIds = L.experimentsFor(16).map((e) => e.id);
const gateMissing = 'sp16-sand-throw';
gate.expLog = { 16: Object.fromEntries(gateIds.filter((id) => id !== gateMissing).map((id) => [id, 1])) };
const gateGold = gate.gold;
const gateRun = L.startExperiment(gate, gateMon.uid, 'measure'); // 已做过的实验，进度被卡住
check(gateRun.ok, '未集齐实验行为时仍可执行');
check(gate.gold === gateGold - 15, '进度卡住时金币照扣');
check(Math.abs(L.researchProgress(gate, 16) - gateReq * 0.98) < 1e-9, '进度卡在 98%');
check(!L.isResearched(gate, 16), '未集齐实验行为不会解锁');
const gateFinish = L.startExperiment(gate, gateMon.uid, gateMissing);
check(gateFinish.ok && L.isResearched(gate, 16), '补齐缺失实验后解锁');

// 研究完成后只允许“最伤身”的实验
const survivor = anySubject();
if (survivor) {
  const opts = L.experimentOptions(lab, survivor);
  const allowed = opts.filter((e) => e.allowed).map((e) => e.id);
  const hardest = L.experimentsFor(16).reduce((best, e) => (L.toleranceLoss(survivor, e) > L.toleranceLoss(survivor, best) ? e : best), L.experimentsFor(16)[0]);
  check(allowed.length === 1 && allowed[0] === hardest.id, '研究完成后只剩最伤身的实验可用', allowed.join(','));
  check(L.startExperiment(lab, survivor.uid, 'measure').ok === false, '其余实验被拒绝');
}

// 超出耐受：实验不生效、放生
const lab2 = L.newGame(2026);
const weak = L.createMon(lab2, 19, 5, { origin: 'test' });
lab2.mons.push(weak);
L.assignLab(lab2, 0, weak.uid);
weak.tolerance = 3;
const goldBefore = lab2.gold;
const overload = L.startExperiment(lab2, weak.uid, 'sp19-incisor-wear');
check(overload.ok && overload.released, '超出耐受会放生');
check(overload.result?.survived === false, '超载返回死亡状态');
check(!('text' in (overload.result || {})), '超载结果不包含文案');
check(lab2.expJournal?.[0]?.cause === 'overload' && !('result' in (lab2.expJournal?.[0] || {})), '死亡日志不写入结果文案');
check(Number.isInteger(overload.corpseSlot), '死亡结果带遗体槽位');
check(overload.msg.includes('断了气'), '超载实验使用死亡文案', overload.msg);
check(L.monByUid(lab2, weak.uid) === null, '放生后从名单移除');
check(lab2.gold === goldBefore, '实验不生效不扣资金');
check(L.researchProgress(lab2, 19) === 0, '实验不生效不给进度');
check(lab2.lab[0].uid === null, '实验室空出位置');

// 耐受恰好归零：给完进度后放生
const lab3 = L.newGame(2027);
const edge = L.createMon(lab3, 16, 5, { origin: 'test' });
lab3.mons.push(edge);
L.assignLab(lab3, 0, edge.uid);
lab3.expLog = { 16: Object.fromEntries(L.experimentsFor(16).map((e) => [e.id, 1])) };
edge.tolerance = L.toleranceLoss(edge, BASE_EXPERIMENTS[0]);
const exact = L.startExperiment(lab3, edge.uid, 'measure');
check(exact.released, '耐受归零时放生');
check(exact.result?.survived === false, '耐受归零返回死亡状态');
check(!('text' in (exact.result || {})), '耐受归零结果不包含文案');
check(exact.corpseSlot === 0 && lab3.expJournal?.[0]?.survived === false, '耐受归零记录遗体与死亡日志');
check(exact.msg.includes('没能走下实验台'), '耐受归零使用死亡文案', exact.msg);
check(L.researchProgress(lab3, 16) === 2, '归零前进度已结算');
check(L.monByUid(lab3, edge.uid) === null, '归零后移除');

// 手动放生
const lab4 = L.newGame(2028);
const spare = L.createMon(lab4, 16, 5, { origin: 'test' });
lab4.mons.push(spare);
L.assignLab(lab4, 0, spare.uid);
const manualRelease = L.releaseMon(lab4, spare.uid, 'manual');
check(manualRelease.ok, '可以手动放生');
check(manualRelease.msg.includes('放生'), '实验室手动离队文案为放生', manualRelease.msg);
check(lab4.stats.released >= 1, '放生统计 +1');

// 研究笔记进度按物种共享
const shared = L.newGame(2029);
const p1 = L.createMon(shared, 16, 5, {});
const p2 = L.createMon(shared, 16, 5, {});
shared.mons.push(p1, p2);
L.assignLab(shared, 0, p1.uid);
L.startExperiment(shared, p1.uid, 'measure');
check(L.researchProgress(shared, 16) === 2, '不同个体共享物种进度');
check(L.researchPercent(shared, 16) === 5, '进度百分比正确', `(${L.researchPercent(shared, 16)}%)`);

// ---------- 研究损耗计数 ----------
const lossState = L.newGame(8300);
const lossSubject = L.createMon(lossState, 16, CONFIG.maxLevel, { gender: 'm' });
lossState.mons.push(lossSubject);
L.assignLab(lossState, 0, lossSubject.uid);
lossSubject.tolerance = 1;
const lossRes = L.startExperiment(lossState, lossSubject.uid, 'measure');
check(lossRes.released, '超载实验会放生');
check(L.researchLostCount(lossState, 16) === 1, '研究损耗计数 +1', `(${L.researchLostCount(lossState, 16)})`);
check(L.researchProgress(lossState, 16) === 0, '超载不计进度');

const finishState = L.newGame(8301);
const finishMon = L.createMon(finishState, 16, CONFIG.maxLevel, { gender: 'm' });
finishState.mons.push(finishMon);
L.assignLab(finishState, 0, finishMon.uid);
finishState.research[16] = L.researchRequirement(16) - 2;
finishState.expLog = { 16: Object.fromEntries(L.experimentsFor(16).map((e) => [e.id, 1])) };
finishMon.tolerance = L.toleranceLoss(finishMon, BASE_EXPERIMENTS[0]);
const finishRes = L.startExperiment(finishState, finishMon.uid, 'measure');
check(finishRes.released && L.isResearched(finishState, 16), '完成研究的同时个体耗尽');
check(finishState.dexRecords[16]?.lost === 1, '完成记录写入损耗数', `(${finishState.dexRecords[16]?.lost})`);

// 繁育造成的损耗不计入研究损耗
const breedLoss = L.newGame(8302);
const blF = L.createMon(breedLoss, 21, CONFIG.maxLevel, { gender: 'f' });
const blM = L.createMon(breedLoss, 16, CONFIG.maxLevel, { gender: 'm' });
blF.tolerance = 1;
breedLoss.mons = [blM, blF];
breedLoss.pens = [{ a: blM.uid, b: blF.uid, breed: 0 }];
breedLoss.eggs = [];
L.tick(breedLoss, 3);
check(L.monByUid(breedLoss, blF.uid) === null, '繁育母体耗尽被放生');
check(L.researchLostCount(breedLoss, 21) === 0, '繁育损耗不计入研究损耗');

// ---------- 实验冷却 ----------
const tierList = Object.entries(EXPERIMENT_TIERS).map(([tier, t]) => ({ tier, ...t }));
const allExperiments = [...BASE_EXPERIMENTS, ...tierList];
const cds = allExperiments.map((e) => e.cd);
check(cds.every((c) => c > 0 && c <= 30), 'CD 均不超过 30 秒', cds.join(','));
const byProgress = [...allExperiments].sort((a, b) => a.progress - b.progress);
check(byProgress.every((e, i, arr) => i === 0 || arr[i - 1].cd <= e.cd), '进度越大 CD 越长', byProgress.map((e) => `${e.progress}:${e.cd}`).join(','));

const cdState = L.newGame(3001);
const cdMon = L.createMon(cdState, 16, 10, {});
cdState.mons.push(cdMon);
L.assignLab(cdState, 0, cdMon.uid);
check(L.startExperiment(cdState, cdMon.uid, 'measure').ok, '第一次基础体测可用');
const blocked = L.startExperiment(cdState, cdMon.uid, 'measure');
check(blocked.ok === false && /冷却/.test(blocked.msg), '同种实验进入冷却', blocked.msg);
check(L.experimentCooldown(cdState, cdMon.uid, 'measure') > 0, '冷却剩余时间大于 0');
L.tick(cdState, 0.5); // 0.5 天 = 6 秒（1× 基准），足够走完 5 秒 CD
check(L.experimentCooldown(cdState, cdMon.uid, 'measure') === 0, '冷却随时间结束');
check(L.startExperiment(cdState, cdMon.uid, 'measure').ok, '冷却结束后可再次实验');
// 冷却按个体划分：同一实验在另一只身上不共享 CD
const cdMon2 = L.createMon(cdState, 16, 10, {});
cdState.mons.push(cdMon2);
L.assignLab(cdState, 1, cdMon2.uid);
check(L.experimentCooldown(cdState, cdMon2.uid, 'measure') === 0, '另一只个体的同种实验没有冷却');
check(L.startExperiment(cdState, cdMon2.uid, 'measure').ok, '另一只个体可以做同种实验');
// 不同实验的冷却互相独立
check(L.startExperiment(cdState, cdMon.uid, 'sample').ok, '另一种实验不受前者冷却影响');

// ---------- 耐受度与等级、性别挂钩 ----------
const lvlState = L.newGame(3002);
const lowMon = L.createMon(lvlState, 16, 1, { gender: 'f' });
const highMon = L.createMon(lvlState, 16, 30, { gender: 'f' });
check(maxTolerance(lowMon) === 100 && lowMon.tolerance === 100, 'Lv.1 雌性耐受度 100');
check(maxTolerance(highMon) === 158 && highMon.tolerance === 158, 'Lv.30 雌性耐受度 158', `(${highMon.tolerance})`);
const maleProbe = L.createMon(lvlState, 16, 10, { gender: 'm' });
const femaleProbe = L.createMon(lvlState, 16, 10, { gender: 'f' });
check(maxTolerance(femaleProbe) === 118, 'Lv.10 雌性上限 118', `(${maxTolerance(femaleProbe)})`);
check(maxTolerance(maleProbe) === 148, 'Lv.10 雄性上限 148（1.25 倍）', `(${maxTolerance(maleProbe)})`);
check(maleProbe.tolerance === Math.round(maxTolerance(femaleProbe) * CONFIG.maleToleranceFactor), '雄性耐受度是同物种 1.25 倍', `${maleProbe.tolerance}/${femaleProbe.tolerance}`);
const genderless = L.createMon(lvlState, 81, 10, {});
check(genderless.gender === 'x' && maxTolerance(genderless) === 118, '无性别的按普通倍率', `(${maxTolerance(genderless)})`);
lvlState.mons.push(lowMon);
lvlState.candies = 10;
const tolBefore = lowMon.tolerance;
let lvGuard = 0;
while (lowMon.level === 1 && lvGuard++ < 5) L.feed(lvlState, lowMon.uid);
check(lowMon.level === 2, '升级成功', `(${lowMon.level})`);
check(lowMon.tolerance === tolBefore + CONFIG.tolerancePerLevel, '升级提高当前耐受度', `(${lowMon.tolerance})`);
check(maxTolerance(lowMon) === tolBefore + CONFIG.tolerancePerLevel, '升级提高耐受上限');

// 实验损耗：harsh 档明显更高
const dmgProbe = L.createMon(lvlState, 16, 10, {});
const harshExp = L.experimentsFor(1).find((e) => e.id === 'sp1-seed-cut');
check(L.toleranceLoss(dmgProbe, harshExp) >= 120, 'harsh 档损耗大幅提高', `(${L.toleranceLoss(dmgProbe, harshExp)})`);
check(harshExp.progress === EXPERIMENT_TIERS.harsh.progress, 'harsh 档进度按档位表');

// 研究进度 100% 后：实验关闭，只剩终末榨取
const noCdState = L.newGame(3100);
const noCdMon = L.createMon(noCdState, 16, CONFIG.maxLevel, { gender: 'm' });
noCdMon.tolerance = 600; // 测试夹具：只看冷却，不受损耗影响
noCdState.mons.push(noCdMon);
L.assignLab(noCdState, 0, noCdMon.uid);
noCdState.research[16] = L.researchRequirement(16);
if (!noCdState.dex.includes(16)) noCdState.dex.push(16);
const noCdHardest = L.experimentsFor(16).reduce((best, e) => (L.toleranceLoss(noCdMon, e) > L.toleranceLoss(noCdMon, best) ? e : best), L.experimentsFor(16)[0]);
noCdState.expCd[noCdHardest.id] = 30; // 遗留的冷却也应被无视
const nc1 = L.startExperiment(noCdState, noCdMon.uid, noCdHardest.id);
check(!nc1.ok && nc1.msg.includes('终末榨取'), '研究完成后不再能做实验', `(${nc1.msg})`);
check(L.experimentCooldownFor(noCdState, noCdMon, noCdHardest.id) === 0, '研究完成后不记录冷却');
// 研究已满的物种：实验被拒，自然也不会写日志
check((noCdState.expJournal || []).length === 0, '研究满后实验不再写入日志', `(${(noCdState.expJournal || []).length})`);

// ---------- 终末榨取 ----------
const fxState = L.newGame(3300);
const fxMon = L.createMon(fxState, 16, CONFIG.maxLevel, { gender: 'm' });
fxMon.tolerance = 218;
fxState.mons.push(fxMon);
L.assignLab(fxState, 0, fxMon.uid);
fxState.gold = 1000;
const fxEarly = L.finalExtraction(fxState, 0);
check(!fxEarly.ok, '研究未完成不能终末榨取', fxEarly.msg);
fxState.research[16] = L.researchRequirement(16);
if (!fxState.dex.includes(16)) fxState.dex.push(16);
const fxGoldBefore = fxState.gold;
const fxOk = L.finalExtraction(fxState, 0);
check(fxOk.ok, '研究完成后可以终末榨取', fxOk.msg);
check(fxOk.amount >= 1 && fxOk.amount <= Math.ceil((218 / 50) * 2), '样本数量落在 1..2μ', `(${fxOk.amount})`);
check(L.samplesOf(fxState, 16) === fxOk.amount, '样本按物种累计');
check(L.samplesOf(fxState, 21) === 0, '样本不串物种');
check(fxState.gold === fxGoldBefore - CONFIG.finalExtractionCost, '终末榨取扣耗材');
check(L.monByUid(fxState, fxMon.uid) === null, '终末榨取后个体死亡');
check(!!fxState.lab[0].corpse, '终末榨取后留下遗体占位');

// 产量随当前耐受上升（同一 seed，只改耐受）
const extractAt = (tol) => {
  const st = L.newGame(3301);
  const m = L.createMon(st, 16, CONFIG.maxLevel, { gender: 'm' });
  m.tolerance = tol;
  st.mons.push(m);
  L.assignLab(st, 0, m.uid);
  st.research[16] = L.researchRequirement(16);
  if (!st.dex.includes(16)) st.dex.push(16);
  st.gold = 5000;
  return L.finalExtraction(st, 0).amount;
};
check(extractAt(218) > extractAt(100), '耐受越高，样本越多', `(${extractAt(100)} → ${extractAt(218)})`);

// ---------- 实验室助手 ----------
const asstRankState = L.newGame(3405);
check(L.assistantSlots(asstRankState) === 0, '职级 0 没有助手');
asstRankState.rank = 3;
check(L.assistantSlots(asstRankState) === 1, '职级 3 给 1 个助手');
asstRankState.rank = 4;
check(L.assistantSlots(asstRankState) === 2, '职级 4 给 2 个助手');
asstRankState.rank = 5;
check(L.assistantSlots(asstRankState) === 3, '职级 5 给 3 个助手');

const makeAssistState = (seed) => {
  const st = L.newGame(seed);
  st.rank = 3;
  st.gold = 10000;
  const m = L.createMon(st, 16, CONFIG.maxLevel, { gender: 'm' });
  st.mons.push(m);
  L.assignLab(st, 0, m.uid);
  return { st, m };
};

const asstA = makeAssistState(3400);
check(!L.canAssignAssistant(asstA.st, 0).ok, '没亲手做完 5 条实验前不能安排助手');
for (const e of L.experimentsFor(16)) {
  asstA.st.expLog[16] = { ...(asstA.st.expLog[16] || {}), [e.id]: 1 };
}
check(L.canAssignAssistant(asstA.st, 0).ok, '5 条实验做完后可以安排助手');
const asgA = L.assignAssistant(asstA.st, 0);
check(asgA.ok && asstA.st.lab[0].assistant && asstA.st.lab[0].auto, '助手接手并开始自动研究');
check((asstA.st.expJournal || [])[0]?.expName === '安排助手对其进行实验', '写入「安排助手」日志');
const tolA = asstA.m.tolerance;
const resA = L.researchProgress(asstA.st, 16);
const goldA = asstA.st.gold;
L.tick(asstA.st, 0.1, 1);
check(L.researchProgress(asstA.st, 16) > resA, '助手推进研究进度');
check(asstA.m.tolerance < tolA, '助手消耗耐受度');
check(asstA.st.gold < goldA, '助手消耗耗材');

// 到 100% 自动停，但仍占用助手
asstA.st.research[16] = L.researchRequirement(16) - 0.1;
L.tick(asstA.st, 0.1, 1);
check(L.isResearched(asstA.st, 16), '助手能把研究推到 100%');
check(!asstA.st.lab[0].auto, '到 100% 自动停止');
check(asstA.st.lab[0].assistant, '到 100% 仍占用助手');

// 打断：停止自动、助手仍占用、可再手动做实验
const asstB = makeAssistState(3401);
for (const e of L.experimentsFor(16)) {
  asstB.st.expLog[16] = { ...(asstB.st.expLog[16] || {}), [e.id]: 1 };
}
L.assignAssistant(asstB.st, 0);
const itrB = L.interruptAssistant(asstB.st, 0);
check(itrB.ok, '可以打断助手');
check(!asstB.st.lab[0].auto && asstB.st.lab[0].assistant, '打断后停止推进但助手仍占用');
check((asstB.st.expJournal || [])[0]?.expName === '你决定亲自动手', '打断写入「亲自动手」日志');
const manualB = L.startExperiment(asstB.st, asstB.m.uid, L.experimentsFor(16)[0].id);
check(manualB.ok, '打断后可以自己动手做实验', manualB.msg);
check(L.resumeAssistant(asstB.st, 0).ok && asstB.st.lab[0].auto, '可以再交给助手');

// 助手把个体用死：死亡 + 留遗体 + 停止自动 + 助手仍占用
const asstC = makeAssistState(3402);
for (const e of L.experimentsFor(16)) {
  asstC.st.expLog[16] = { ...(asstC.st.expLog[16] || {}), [e.id]: 1 };
}
L.assignAssistant(asstC.st, 0);
asstC.m.tolerance = 2;
L.tick(asstC.st, 0.1, 1);
check(L.monByUid(asstC.st, asstC.m.uid) === null, '助手会把个体用死');
check(!!asstC.st.lab[0].corpse, '用死后留下遗体');
check(!asstC.st.lab[0].auto && asstC.st.lab[0].assistant, '用死后停止自动，助手仍占用');
asstC.st.gold = 1000;
const prC = L.processLabSlot(asstC.st, 0);
check(prC.ok && !asstC.st.lab[0].assistant, '处理遗体后助手释放');

// ---------- 蛋贩子：每两周换货 / 换货费递增并随时间回落 ----------
check(EGG_SOURCES.length === 300 && new Set(EGG_SOURCES).size === 300, '来源描述共 300 条且不重复');
const shopState = L.newGame(5200);
shopState.gold = 1000;
const shopGold = shopState.gold;
const firstCost = L.marketRerollCost(shopState);
const reroll = L.rerollMarket(shopState);
check(reroll.ok && shopState.gold === shopGold - firstCost, '花钱让蛋贩子换货', `(${shopState.gold})`);
check(shopState.market.length === 3, '换货后仍有 3 枚蛋');
check(shopState.market.every((o) => /^(从|在)/.test(o.source)), '蛋的来源描述更完整', shopState.market[0]?.source);
const nextCost = L.marketRerollCost(shopState);
check(nextCost > firstCost, '连续换货费用递增', `(${firstCost}→${nextCost})`);
const marketDayBefore = shopState.marketDay;
const afterReroll = JSON.stringify(shopState.market);
L.tick(shopState, 1.1);
check(shopState.marketDay === marketDayBefore && JSON.stringify(shopState.market) === afterReroll, '未到两周不自动换货');
const decayedCost = L.marketRerollCost(shopState);
check(decayedCost < nextCost, '换货费用随时间回落', `(${nextCost}→${decayedCost})`);
L.tick(shopState, 13);
check(shopState.marketDay > marketDayBefore && JSON.stringify(shopState.market) !== afterReroll, '满两周后蛋贩子自动换货');

shopState.gold = 10000;
const c1 = L.marketRerollCost(shopState);
L.rerollMarket(shopState);
const c2 = L.marketRerollCost(shopState);
L.rerollMarket(shopState);
const c3 = L.marketRerollCost(shopState);
check(c2 > c1 && c3 > c2, '连续换货费用逐次递增', `(${c1}→${c2}→${c3})`);
L.tick(shopState, 3);
check(L.marketRerollCost(shopState) < c3, '等待后换货费用降低', `(${c3}→${L.marketRerollCost(shopState)})`);
shopState.gold = 0;
check(L.rerollMarket(shopState).ok === false, '资金不足不能换货');

// ---------- 实验室挣扎 ----------
const struggle = L.newGame(5400);
const stMon = L.createMon(struggle, 16, 10, { gender: 'm' });
struggle.mons.push(stMon);
L.assignLab(struggle, 0, stMon.uid);
stMon.tolerance = 100;
L.tick(struggle, 1);
check(Math.abs(stMon.tolerance - (100 - CONFIG.labStrugglePerDay)) < 1e-9, '实验室高耐受度会缓慢挣扎', `(${stMon.tolerance})`);
stMon.tolerance = CONFIG.labStruggleThreshold;
L.tick(struggle, 1);
check(stMon.tolerance === CONFIG.labStruggleThreshold, '低于阈值停止挣扎');

const struggleDeath = L.newGame(5401);
const sdMon = L.createMon(struggleDeath, 16, 10, { gender: 'm' });
struggleDeath.mons.push(sdMon);
L.assignLab(struggleDeath, 0, sdMon.uid);
sdMon.tolerance = CONFIG.labStruggleThreshold + 1;
const sdEvents = L.tick(struggleDeath, 40);
check(L.monByUid(struggleDeath, sdMon.uid) === null, '实验室挣扎耗尽会放生');
check(!!struggleDeath.lab[0].corpse, '实验室挣扎死亡留下遗体占位');
check(struggleDeath.expJournal?.[0]?.cause === 'struggle', '实验室挣扎死亡写入日志');
check(L.researchLostCount(struggleDeath, 16) === 1, '实验室挣扎计入研究损耗');
check(sdEvents.some((e) => /实验台上挣扎/.test(e.msg)), '实验室挣扎死亡文案', sdEvents.map((e) => e.msg).join(' / '));

// ---------- 高损耗实验会惊吓同实验室的个体 ----------
const threatState = L.newGame(5500);
const actor = L.createMon(threatState, 1, 60, { gender: 'm' });
const victim = L.createMon(threatState, 16, 10, { gender: 'm' });
const weakVictim = L.createMon(threatState, 19, 10, { gender: 'm' });
threatState.mons.push(actor, victim, weakVictim);
threatState.lab.push({ uid: null });
L.assignLab(threatState, 0, actor.uid);
L.assignLab(threatState, 1, victim.uid);
L.assignLab(threatState, 2, weakVictim.uid);
victim.tolerance = 100;
weakVictim.tolerance = 10;
const victimMax = maxTolerance(victim);
const threatRes = L.startExperiment(threatState, actor.uid, 'sp1-seed-cut');
check(threatRes.ok && !threatRes.released, 'harsh 实验正常完成');
check(threatRes.intensity > exp1.intensity, '损耗越高的实验动效越烈', `(${exp1.intensity}→${threatRes.intensity})`);
check(
  victim.tolerance === 100 - Math.max(1, Math.round(victimMax * CONFIG.threatToleranceRatio)),
  '同实验室个体会被吓得掉耐受',
  `(${victim.tolerance})`
);
check(weakVictim.tolerance === 10, '耐受度低于 10% 的个体不受威胁');
check(actor.tolerance === maxTolerance(actor) - L.toleranceLoss(actor, L.experimentsFor(1).find((e) => e.id === 'sp1-seed-cut')), '实验者自身不受威胁');
check(threatRes.events.some((e) => /挣扎/.test(e.msg)), '实验室威胁有提示');

// ---------- 走到这里：最高职级本身即可收束，不再要求传说研究 ----------
const topRankState = L.newGame(5600);
topRankState.rank = RANKS.length - 1;
const topRankWin = L.checkVictory(topRankState);
check(topRankWin?.type === 'win' && topRankState.winKind === 'rank', '最高职级直接触发收束，不要求传说宝可梦');
check(/走到这里|可以结束/.test(topRankWin?.msg || '') || /这条路/.test(topRankWin?.msg || ''), '收束文案不是传统胜负');
const notTopState = L.newGame(5601);
notTopState.dex.push(144);
check(L.checkVictory(notTopState) === null, '非最高职级且研究笔记未完成时不触发');
const dexState = L.newGame(5602);
dexState.dex = Object.keys(dex.species).map(Number);
const dexWin = L.checkVictory(dexState);
check(dexWin?.type === 'win' && dexState.winKind === 'dex', '完成 151 份研究笔记仍可收束');
const promoteWinState = L.newGame(5603);
promoteWinState.rank = RANKS.length - 2;
promoteWinState.rep = 999;
promoteWinState.gold = 999999;
const promoteWin = L.promote(promoteWinState);
check(promoteWin.ok && promoteWin.win?.type === 'win' && promoteWinState.winKind === 'rank', '晋升到最高职级时由逻辑层触发收束');

// ---------- 订单过期：只记录、不播报 ----------
const expState = L.newGame(3004);
expState.orders = [
  { id: 'oexp', dept: 'logistics', kind: 'any', dexId: null, type: null, minLevel: 1, needNature: 0, reward: 100, deadline: expState.day + 0.1, created: expState.day },
];
expState.day += 0.2;
const expEvents = L.tick(expState, 0.01);
check(expState.stats.expired >= 1, '过期计入统计');
check(expState.log.some((l) => l.type === 'expire'), '过期写入内部记录');
check(expEvents.some((e) => e.type === 'expire'), '过期事件类型为 expire');
check(!expEvents.some((e) => e.type === 'warn' && e.msg.includes('过期')), '过期不再走 warn 通道');

// ---------- 能力值披露 ----------
const reveal = L.newGame(4001);
check(L.revealedStats(reveal, 16).length === 0, '未研究时能力值全部隐藏');
reveal.research[16] = 20; // 50%
check(L.revealedStats(reveal, 16).length === 3, '50% 进度披露 3 项', L.revealedStats(reveal, 16).join(','));
reveal.research[16] = 40; // 100%
const full = L.revealedStats(reveal, 16);
check(full.length === 6, '100% 披露全部 6 项');
const pidgeyStats = sp(16).stats;
const sorted = [...full].sort((x, y) => pidgeyStats[y] - pidgeyStats[x]);
check(JSON.stringify(full) === JSON.stringify(sorted), '披露顺序按种族值从高到低', full.join(','));
check(L.statRevealOrder(16)[0] === 'spe', '波波最快披露速度', L.statRevealOrder(16).join(','));

// ---------- 繁育规则 ----------
// 正常繁育：出蛋 + 母体掉耐受 + 蛋组确认
const br = L.newGame(4100);
const dad = L.createMon(br, 16, 10, { gender: 'm' });
const mom = L.createMon(br, 21, 10, { gender: 'f' });
br.mons = [dad, mom];
br.pens = [{ a: dad.uid, b: mom.uid, breed: 0 }];
br.eggs = [];
br.market = [];
let br1Egg = null;
let br1Events = [];
for (let i = 0; i < 14 && !br1Egg; i++) {
  br1Events.push(...L.tick(br, 0.25));
  if (br.eggs.length) br1Egg = { ...br.eggs[0] };
}
check(!!br1Egg, '正常繁育产蛋', br1Egg ? sp(br1Egg.dexId).zh : '无');
check(br1Egg?.dexId === 21, '蛋的物种是母方的最初形态', `(${br1Egg?.dexId})`);
check(mom.tolerance === maxTolerance(mom) - CONFIG.breedToleranceCost, '母体因繁育掉耐受度', `(${mom.tolerance})`);
check(dad.tolerance === maxTolerance(dad), '父方不掉耐受度');
check(L.knownEggGroups(br, 16).includes('flying') && L.knownEggGroups(br, 21).includes('flying'), '繁育成功后确认交汇蛋组');
check(L.eggGroupsDisplay(br, 16) === '飞行', '确认后蛋组显示中文', L.eggGroupsDisplay(br, 16));
check(br1Events.some((e) => e.type === 'egg'), '产蛋有日志');
check(br1Egg?.source === BRED_SOURCE, '繁育蛋的来源是培育栏自产', `(${br1Egg?.source})`);

// 双蛋组物种：只确认交汇的那个
const br2 = L.newGame(4101);
const farfetchd = L.createMon(br2, 83, 10, { gender: 'm' }); // 飞行 / 陆上
const doduo = L.createMon(br2, 84, 10, { gender: 'f' }); // 飞行
br2.mons = [farfetchd, doduo];
br2.pens = [{ a: farfetchd.uid, b: doduo.uid, breed: 0 }];
br2.eggs = [];
br2.market = [];
L.tick(br2, 3);
check(L.knownEggGroups(br2, 83).includes('flying'), '大葱鸭只确认了飞行组');
check(!L.knownEggGroups(br2, 83).includes('ground'), '陆上组仍未确认');
check(L.eggGroupsDisplay(br2, 83) === '飞行 / ？？？', '未知蛋组显示 ???', L.eggGroupsDisplay(br2, 83));

// 百变怪 + 雄性：损耗落在百变怪身上，雄性不掉耐受
const dtState = L.newGame(4107);
const ditto = L.createMon(dtState, 132, 10, {});
const dMale = L.createMon(dtState, 25, 10, { gender: 'm' });
dtState.mons = [ditto, dMale];
dtState.pens = [{ a: ditto.uid, b: dMale.uid, breed: 0 }];
dtState.eggs = [];
dtState.market = [];
let dittoEgg = null;
for (let i = 0; i < 14 && !dittoEgg; i++) {
  L.tick(dtState, 0.25);
  if (dtState.eggs.length) dittoEgg = { ...dtState.eggs[0] };
}
check(!!dittoEgg, '百变怪与雄性可以繁育');
check(dittoEgg?.dexId === 25, '蛋是雄性的最初形态', `(${dittoEgg ? sp(dittoEgg.dexId).zh : '无'})`);
check(ditto.tolerance === maxTolerance(ditto) - CONFIG.breedToleranceCost, '损耗落在百变怪身上', `(${ditto.tolerance})`);
check(dMale.tolerance === maxTolerance(dMale), '雄性不掉耐受度', `(${dMale.tolerance})`);
check(L.knownEggGroups(dtState, 132).includes('ditto'), '百变怪确认了自己的蛋组');
check(L.knownEggGroups(dtState, 25).length === 0, '对方的蛋组仍然未知');

// 百变怪 + 雌性：有母体时仍由雌性承担
const dt2State = L.newGame(4108);
const ditto2 = L.createMon(dt2State, 132, 10, {});
const dFemale = L.createMon(dt2State, 25, 10, { gender: 'f' });
dt2State.mons = [ditto2, dFemale];
dt2State.pens = [{ a: ditto2.uid, b: dFemale.uid, breed: 0 }];
dt2State.eggs = [];
dt2State.market = [];
let dFemaleEgg = null;
for (let i = 0; i < 14 && !dFemaleEgg; i++) {
  L.tick(dt2State, 0.25);
  if (dt2State.eggs.length) dFemaleEgg = { ...dt2State.eggs[0] };
}
check(!!dFemaleEgg, '百变怪与雌性也能繁育');
check(dFemale.tolerance === maxTolerance(dFemale) - CONFIG.breedToleranceCost, '有雌性时仍由雌性承担损耗', `(${dFemale.tolerance})`);
check(ditto2.tolerance === maxTolerance(ditto2), '这种组合下百变怪不掉耐受度');

// 性冷淡机制已移除：雄性不再有繁育次数上限或相关标记
const noLimitState = L.newGame(4107);
const noLimitMale = L.createMon(noLimitState, 16, CONFIG.maxLevel, { gender: 'm' });
const noLimitFemale = L.createMon(noLimitState, 16, CONFIG.maxLevel, { gender: 'f' });
check(!('bredEggs' in noLimitMale), '个体不再记录雄性繁育数');
check(L.sterilityLabel(noLimitMale) === '', '正常雄性没有性冷淡标记');
check(L.compatibility(noLimitMale, noLimitFemale).ok === true, '正常雄性可继续配种');
check(L.compatibility(noLimitMale, noLimitFemale).cold === undefined, '兼容性判定不再返回性冷淡状态');

// 条件不符：较弱的一只被放生，另一只掉耐受
const br3 = L.newGame(4102);
const strong = L.createMon(br3, 16, 30, { gender: 'm' }); // 波波 Lv30
const weakMon = L.createMon(br3, 74, 3, { gender: 'f' }); // 小拳石 Lv3，异性但蛋组不匹配
br3.mons = [strong, weakMon];
br3.pens = [{ a: strong.uid, b: weakMon.uid, breed: 0 }];
br3.eggs = [];
br3.market = [];
const fightEv = L.tick(br3, 3);
check(L.monByUid(br3, weakMon.uid) === null, '争斗中较弱的一只被放生');
check(strong.tolerance === maxTolerance(strong) - CONFIG.fightToleranceLoss, '另一只掉耐受度', `(${strong.tolerance})`);
check(br3.stats.bred === 0 && br3.eggs.length === 0, '争斗不产蛋');
check(fightEv.some((e) => e.type === 'warn'), '争斗有警告日志');
check(fightEv.some((e) => e.msg.includes('伤重不治')), '争斗文案使用死亡表述');
check(!('breedFails' in br3), '不再写入配对失败记录');
check(L.failedPair(br3, strong.dexId, 74) && L.failedPartners(br3, strong.dexId).has(74), '蛋组不匹配关系可查询');
check(br3.failedPairs?.includes([strong.dexId, 74].sort((x, y) => x - y).join('-')), '蛋组不匹配组合永久锁定');
const newGeodude = L.createMon(br3, 74, 5, { gender: 'm' });
br3.mons.push(newGeodude);
check(!L.assignPen(br3, 0, 'b', newGeodude.uid).ok, '曾配对失败的物种不能再次同栏');
br3.pens[0] = { a: strong.uid, b: newGeodude.uid, breed: 999 };
br3.eggs = [];
const blockedEvents = L.tick(br3, 0.1);
check(br3.eggs.length === 0 && br3.stats.fights === 1, '旧状态同栏也不会再繁育或争斗');
check(blockedEvents.some((e) => e.failedPair), '同栏旧状态给出失败提示');
const fightEvent = fightEv.find((e) => e.fight);
check(fightEvent?.pen === 0, '争斗事件带栏位索引，供 UI 播放撞击动效');
check(br3.stats.fights === 1, '争斗计数');

// 同性配对引发的争斗不计入配对失败记录
const sameSexState = L.newGame(4109);
const ssA = L.createMon(sameSexState, 16, 30, { gender: 'm' });
const ssB = L.createMon(sameSexState, 16, 3, { gender: 'm' });
sameSexState.mons = [ssA, ssB];
sameSexState.pens = [{ a: ssA.uid, b: ssB.uid, breed: 0 }];
sameSexState.eggs = [];
sameSexState.market = [];
L.tick(sameSexState, 3);
check(L.monByUid(sameSexState, ssB.uid) === null, '同性争斗仍会死亡');
check(!('breedFails' in sameSexState), '同性争斗不写入失败记录');
check((sameSexState.failedPairs || []).length === 0, '同性争斗不生成永久失败组合');

// 争斗后耐受见底：剩下那只也会被放生（用满级个体，避免升级回耐受干扰判定）
const br4 = L.newGame(4103);
const s4a = L.createMon(br4, 16, CONFIG.maxLevel, { gender: 'm' });
const s4b = L.createMon(br4, 74, 3, { gender: 'm' });
s4a.tolerance = 10;
br4.mons = [s4a, s4b];
br4.pens = [{ a: s4a.uid, b: s4b.uid, breed: 0 }];
br4.eggs = [];
L.tick(br4, 3);
check(L.monByUid(br4, s4a.uid) === null, '争斗后耐受见底也会被放生');

// 母体耐受不足：繁育失败、不产蛋、母体放生（满级个体，避免升级回耐受）
const br5 = L.newGame(4104);
const b5m = L.createMon(br5, 16, CONFIG.maxLevel, { gender: 'm' });
const b5f = L.createMon(br5, 21, CONFIG.maxLevel, { gender: 'f' });
b5f.tolerance = CONFIG.breedToleranceCost; // 恰好不够
br5.mons = [b5m, b5f];
br5.pens = [{ a: b5m.uid, b: b5f.uid, breed: 0 }];
br5.eggs = [];
const b5ev = L.tick(br5, 3);
check(br5.eggs.length === 0, '母体撑不住时不产蛋');
check(L.monByUid(br5, b5f.uid) === null, '母体被放生');
check(!('breedFails' in br5), '繁育力竭不再写入失败记录');
check((br5.failedPairs || []).length === 0 && !L.failedPair(br5, 16, 21), '力竭不永久锁定物种组合');
check(b5ev.some((e) => e.type === 'warn' && e.msg.includes('繁育')), '繁育失败有提示');

// 母体损耗节奏：约 3 只后代后被放生（满级个体不升级，只留一个栏位避免后代自己配对）
const br7 = L.newGame(4106);
const b7m = L.createMon(br7, 16, CONFIG.maxLevel, { gender: 'm' });
const b7f = L.createMon(br7, 21, CONFIG.maxLevel, { gender: 'f' });
b7f.tolerance = 100;
br7.mons = [b7m, b7f];
br7.pens = [{ a: b7m.uid, b: b7f.uid, breed: 0 }];
br7.eggs = [];
br7.market = [];
for (let i = 0; i < 60; i++) L.tick(br7, 0.25);
check(br7.stats.bred === 3, '母体约繁育 3 只后耗尽', `(${br7.stats.bred})`);
check(L.monByUid(br7, b7f.uid) === null, '损耗完的母体被放生');
check(b7m.tolerance === maxTolerance(b7m), '父方全程不掉耐受度');

// 孵化器满了不惩罚
const br6 = L.newGame(4105);
const b6m = L.createMon(br6, 16, 10, { gender: 'm' });
const b6f = L.createMon(br6, 21, 10, { gender: 'f' });
br6.mons = [b6m, b6f];
br6.pens = [{ a: b6m.uid, b: b6f.uid, breed: 0 }];
br6.eggs = Array.from({ length: L.eggSlots(br6) }, (_, i) => ({ uid: `e${i}`, dexId: 16, daysLeft: 99, total: 99 }));
L.tick(br6, 4);
check(br6.mons.length === 2 && b6f.tolerance === maxTolerance(b6f), '孵化器满时既不产蛋也不受伤');
check(br6.pens[0].breed >= CONFIG.breedDays, '繁育条停在满格等待');

// ---------- 配对失败：拒绝放入 / 静默 / 文案分级 / 锁定 ----------
// 双百变怪：放不进同一栏，也不会打架
const refuse = L.newGame(4200);
const dittoA = L.createMon(refuse, 132, 10, {});
const dittoB = L.createMon(refuse, 132, 10, {});
refuse.mons = [dittoA, dittoB];
refuse.pens = Array.from({ length: 3 }, () => ({ a: null, b: null, breed: 0 }));
check(L.assignPen(refuse, 0, 'a', dittoA.uid).ok, '百变怪可以放进空栏位');
const dittoPut = L.assignPen(refuse, 0, 'b', dittoB.uid);
check(dittoPut.ok === false, '两只百变怪不能放进同一栏位', dittoPut.msg);
check(dittoPut.msg.includes('百变怪'), '拒绝理由点明是百变怪', dittoPut.msg);

// 未发现蛋组（传说 / 幻兽）：放不进去
const mewtwo = L.createMon(refuse, 150, 10, {});
refuse.mons.push(mewtwo);
const noEggPut = L.assignPen(refuse, 1, 'a', mewtwo.uid);
check(noEggPut.ok === false, '未发现蛋组无法放进培育栏', noEggPut.msg);
check(noEggPut.msg.includes('未发现蛋组'), '拒绝理由点明未发现蛋组', noEggPut.msg);

// 尼多娜 / 尼多后 蛋组已修正，雌性线不再报废
const nido = L.newGame(4207);
const nidorina = L.createMon(nido, 30, 16, { gender: 'f' });
const nidoranM = L.createMon(nido, 32, 16, { gender: 'm' });
nido.mons = [nidorina, nidoranM];
check(sp(30).eggGroups.includes('monster') && sp(31).eggGroups.includes('ground'), '尼多娜/尼多后蛋组与雄性线一致', JSON.stringify(sp(30).eggGroups));
check(L.compatibility(nidorina, nidoranM).ok, '尼多娜可以与尼多朗繁育');
nido.pens = [{ a: nidoranM.uid, b: nidorina.uid, breed: 0 }];
nido.eggs = [];
L.tick(nido, 3);
check(nido.eggs.length === 1, '尼多娜能产蛋', `(${nido.eggs.length})`);
check(nido.eggs[0]?.dexId === 29, '蛋孵出尼多兰（最初形态）', `(${nido.eggs[0]?.dexId})`);

// 两个无性别：不争斗、不产蛋、不掉耐受，只提示一次
const quietState = L.newGame(4201);
const magnemite = L.createMon(quietState, 81, 10, {});
const voltorb = L.createMon(quietState, 100, 10, {});
quietState.mons = [magnemite, voltorb];
quietState.pens = [{ a: magnemite.uid, b: voltorb.uid, breed: 0 }];
quietState.eggs = [];
const quietEv = L.tick(quietState, 3);
check(quietState.eggs.length === 0 && (quietState.stats.fights || 0) === 0, '两个无性别不产蛋也不争斗');
check(!!L.monByUid(quietState, magnemite.uid) && !!L.monByUid(quietState, voltorb.uid), '两个无性别都还活着');
check(magnemite.tolerance === maxTolerance(magnemite) && voltorb.tolerance === maxTolerance(voltorb), '两个无性别不掉耐受度');
check(quietEv.some((e) => e.quiet), '两个无性别给出静默提示');
check(quietState.pens[0].breed === 0, '无性别配对不积累繁育条');

// 无性别 + 有性别：同样静默，不会打死对方
const mixedQuiet = L.newGame(4209);
const mxA = L.createMon(mixedQuiet, 81, 10, {});
const mxB = L.createMon(mixedQuiet, 16, 10, { gender: 'm' });
mixedQuiet.mons = [mxA, mxB];
mixedQuiet.pens = [{ a: mxA.uid, b: mxB.uid, breed: 0 }];
mixedQuiet.eggs = [];
const mxEv = L.tick(mixedQuiet, 3);
check(mixedQuiet.eggs.length === 0 && (mixedQuiet.stats.fights || 0) === 0, '无性别与有性别不产蛋也不争斗');
check(!!L.monByUid(mixedQuiet, mxA.uid) && !!L.monByUid(mixedQuiet, mxB.uid), '无性别与有性别都还活着');
check(mxEv.some((e) => e.quiet), '无性别与有性别给出静默提示');
check(!mxEv.some((e) => e.fight), '无性别与有性别不触发争斗事件');
check(mixedQuiet.pens[0].breed === 0, '无性别与有性别不积累繁育条');

// 同性争斗：文案点明性别，且不锁定组合
const sameSexMsg = L.newGame(4202);
const ssM1 = L.createMon(sameSexMsg, 16, 30, { gender: 'm' });
const ssM2 = L.createMon(sameSexMsg, 16, 3, { gender: 'm' });
sameSexMsg.mons = [ssM1, ssM2];
sameSexMsg.pens = [{ a: ssM1.uid, b: ssM2.uid, breed: 0 }];
sameSexMsg.eggs = [];
const ssEv = L.tick(sameSexMsg, 3);
const ssFight = ssEv.find((e) => e.fight);
check(!!ssFight && ssFight.code === 'same-sex', '同性争斗标记 same-sex', ssFight?.code);
check(!!ssFight && ssFight.msg.includes('两只都是雄性'), '同性争斗文案点明性别', ssFight?.msg);
check((sameSexMsg.failedPairs || []).length === 0, '同性争斗不锁定物种组合');

// 蛋组不匹配：文案单独说明，并写入锁定
const eggMsg = L.newGame(4203);
const birdA = L.createMon(eggMsg, 16, CONFIG.maxLevel, { gender: 'm' }); // 满级不会在 tick 里进化
const rockB = L.createMon(eggMsg, 74, 3, { gender: 'f' });
eggMsg.mons = [birdA, rockB];
eggMsg.pens = [{ a: birdA.uid, b: rockB.uid, breed: 0 }];
eggMsg.eggs = [];
const egEv = L.tick(eggMsg, 3);
const egFight = egEv.find((e) => e.fight);
check(!!egFight && egFight.code === 'egg-group', '蛋组不匹配标记 egg-group', egFight?.code);
check(!!egFight && egFight.msg.includes('蛋组不合'), '蛋组不匹配的文案单独说明', egFight?.msg);
check(L.failedPair(eggMsg, 16, 74), '异性蛋组不匹配写入永久锁定');

// 锁定的对只警告一次，不重复刷屏
const lockTwice = L.newGame(4205);
const lockA = L.createMon(lockTwice, 16, 10, { gender: 'm' });
const lockB = L.createMon(lockTwice, 74, 10, { gender: 'f' });
lockTwice.mons = [lockA, lockB];
lockTwice.failedPairs = ['16-74'];
lockTwice.pens = [{ a: lockA.uid, b: lockB.uid, breed: 5 }];
lockTwice.eggs = [];
const lockEv1 = L.tick(lockTwice, 0.1);
const lockEv2 = L.tick(lockTwice, 0.1);
check(lockEv1.some((e) => e.failedPair), '锁定的对第一次会警告');
check(!lockEv2.some((e) => e.failedPair), '锁定的对不会重复警告');
check((lockTwice.stats.fights || 0) === 0, '锁定的对不争斗');
check(lockTwice.pens[0].breed === 0, '锁定的对不空转繁育条');
check(L.failedPair(lockTwice, 16, 74), '锁定关系持续保留');

// 培育栏遗体：占位 + 付费处理
const penCorpse = L.newGame(4206);
const pcA = L.createMon(penCorpse, 16, 30, { gender: 'm' });
const pcB = L.createMon(penCorpse, 74, 3, { gender: 'f' });
penCorpse.mons = [pcA, pcB];
penCorpse.pens = [{ a: pcA.uid, b: pcB.uid, breed: 0 }];
penCorpse.eggs = [];
L.tick(penCorpse, 3);
const pcPen = penCorpse.pens[0];
check(!!pcPen.bCorpse && pcPen.b === null, '争斗死者留下遗体占住位置', JSON.stringify(pcPen).slice(0, 60));
check(L.penCorpseCost(penCorpse, 0, 'b') === CONFIG.penCorpseProcessCost, '遗体处理费用固定 6 资金');
const pcSpare = L.createMon(penCorpse, 16, 5, { gender: 'f' });
penCorpse.mons.push(pcSpare);
const corpseBlocked = L.assignPen(penCorpse, 0, 'b', pcSpare.uid);
check(corpseBlocked.ok === false && corpseBlocked.msg.includes('遗体'), '有遗体的位置不能放新的', corpseBlocked.msg);
penCorpse.gold = CONFIG.penCorpseProcessCost;
const pcRes = L.processPenCorpse(penCorpse, 0, 'b');
check(pcRes.ok && penCorpse.gold === 0, '处理遗体扣 6 资金', `(${penCorpse.gold})`);
check(!penCorpse.pens[0].bCorpse, '处理后位置空出');
check(L.assignPen(penCorpse, 0, 'b', pcSpare.uid).ok, '处理后可以重新放入');

// 力竭的母亲也会留下遗体，事件带栏位索引
const exhaustCorpse = L.newGame(4208);
const exM = L.createMon(exhaustCorpse, 16, CONFIG.maxLevel, { gender: 'm' });
const exF = L.createMon(exhaustCorpse, 21, CONFIG.maxLevel, { gender: 'f' });
exF.tolerance = CONFIG.breedToleranceCost;
exhaustCorpse.mons = [exM, exF];
exhaustCorpse.pens = [{ a: exM.uid, b: exF.uid, breed: 0 }];
exhaustCorpse.eggs = [];
const exEv = L.tick(exhaustCorpse, 3);
check(exEv.some((e) => e.exhausted && Number.isInteger(e.pen)), '力竭事件带栏位索引');
check(!!exhaustCorpse.pens[0].bCorpse, '力竭的母亲留下遗体');

// ---------- 血统记录（只写不读） ----------
const kinData = L.newGame(4300);
const kDad = L.createMon(kinData, 16, CONFIG.maxLevel, { gender: 'm' });
const kMom = L.createMon(kinData, 21, CONFIG.maxLevel, { gender: 'f' });
kinData.mons = [kDad, kMom];
kinData.pens = [{ a: kDad.uid, b: kMom.uid, breed: 0 }];
kinData.eggs = [];
check(kDad.ancestors.length === 0 && kDad.gen === 0, '初始个体没有血统记录');
// 分步推进：一次 tick 跨过 2.5 天会让新蛋当帧孵出
for (let i = 0; i < 40 && !kinData.eggs.length; i++) L.tick(kinData, 0.25);
const kinEgg1 = kinData.eggs[0];
check(!!kinEgg1, '血统用例：正常产蛋');
check(kinEgg1?.ancestors?.includes(kDad.uid) && kinEgg1?.ancestors?.includes(kMom.uid), '蛋记录双亲 uid');
check(kinEgg1?.gen === 1, '蛋的世代为 1', `(${kinEgg1?.gen})`);
kinEgg1.daysLeft = 0.01;
L.tick(kinData, 0.1);
const kinChild = L.monByUid(kinData, kinEgg1.uid);
check(!!kinChild && kinChild.gen === 1 && kinChild.ancestors.includes(kDad.uid), '孵出的个体继承血统');
const kMom2 = L.createMon(kinData, 21, CONFIG.maxLevel, { gender: kinChild.gender === 'f' ? 'm' : 'f' });
kinData.mons.push(kMom2);
kinData.pens = [{ a: kinChild.uid, b: kMom2.uid, breed: 0 }];
for (let i = 0; i < 40 && !kinData.eggs.length; i++) L.tick(kinData, 0.25);
const kinEgg2 = kinData.eggs[0];
check(kinEgg2?.gen === 2, '第二代蛋的世代为 2', `(${kinEgg2?.gen})`);
check(kinEgg2?.ancestors?.includes(kDad.uid), '祖先并集保留更早的辈分');

// ---------- 近亲 / 体质 / 死胎 ----------
const vig = L.newGame(4302);
const vDadM = L.createMon(vig, 16, CONFIG.maxLevel, { gender: 'm' });
const vMomF = L.createMon(vig, 21, CONFIG.maxLevel, { gender: 'f' });
check(vDadM.vigor === 1 && vMomF.vigor === 1, '外血个体体质为 1');
check(vDadM.inbred === false, '外血个体不带近亲标记');
check(!L.isKin(vDadM, vMomF), '无共同祖先不算近亲');

// childVigor：近亲衰减 / 下限 / 非近亲回升
check(L.childVigor({ vigor: 1 }, { vigor: 1 }, true) === 0.85, '近亲子代体质 ×0.85');
check(L.childVigor({ vigor: 0.72 }, { vigor: 1 }, true) === 0.612, '第二代近亲继续衰减', `(${L.childVigor({ vigor: 0.72 }, { vigor: 1 }, true)})`);
check(L.childVigor({ vigor: 0.5 }, { vigor: 1 }, true) === 0.5, '近亲子代体质触底 0.5');
check(L.childVigor({ vigor: 1 }, { vigor: 1 }, false) === 1, '非近亲子代封顶 1');
check(L.childVigor({ vigor: 0.5 }, { vigor: 0.5 }, false) === 0.7, '两条退化线互配 = 均值 +0.2', `(${L.childVigor({ vigor: 0.5 }, { vigor: 0.5 }, false)})`);
check(L.childVigor({ vigor: 0.61 }, { vigor: 1 }, false) === 1, '外血能把退化品系拉回 1');

// 体质系数乘在耐受上限上
const vgTolState = L.newGame(4308);
const vgFullMon = L.createMon(vgTolState, 21, 30, { gender: 'f' });
const vgHalfMon = L.createMon(vgTolState, 21, 30, { gender: 'f', vigor: 0.5 });
check(maxTolerance(vgHalfMon) === Math.max(1, Math.round(maxTolerance(vgFullMon) * 0.5)), '体质系数乘在耐受上限上', `(${maxTolerance(vgFullMon)}→${maxTolerance(vgHalfMon)})`);

// isKin：亲子 / 共同祖先 / 无交集
check(L.isKin({ uid: 'k1', ancestors: [] }, { uid: 'k2', ancestors: ['k1'] }), '亲子算近亲');
check(L.isKin({ uid: 'k3', ancestors: ['k9'] }, { uid: 'k4', ancestors: ['k9'] }), '共享祖先算近亲');
check(!L.isKin({ uid: 'k5', ancestors: ['k7'] }, { uid: 'k6', ancestors: ['k8'] }), '无共享祖先不算近亲');

// 祖先表不再截断：母体祖先很多时，父本也不会被挤出
const ancState = L.newGame(4304);
const ancDad = L.createMon(ancState, 16, CONFIG.maxLevel, { gender: 'm' });
const ancMom = L.createMon(ancState, 21, CONFIG.maxLevel, { gender: 'f' });
ancMom.ancestors = Array.from({ length: 10 }, (_, i) => `x${i}`);
ancState.mons = [ancDad, ancMom];
ancState.pens = [{ a: ancDad.uid, b: ancMom.uid, breed: 0 }];
ancState.eggs = [];
for (let i = 0; i < 40 && !ancState.eggs.length; i++) L.tick(ancState, 0.25);
const ancEgg = ancState.eggs[0];
check(ancEgg?.ancestors?.includes(ancDad.uid), '祖先表不截断：父本仍在表内');
check(ancEgg?.ancestors?.length === 12, '祖先表 = 父本 + 母本 + 10 条祖辈', `(${ancEgg?.ancestors?.length})`);

// 力竭：先产下最后一胎，再死
const exh = L.newGame(4305);
const exhDad = L.createMon(exh, 16, CONFIG.maxLevel, { gender: 'm' });
const exhMom = L.createMon(exh, 21, CONFIG.maxLevel, { gender: 'f' });
exhMom.tolerance = 10; // 连一发都不够
exh.mons = [exhDad, exhMom];
exh.pens = [{ a: exhDad.uid, b: exhMom.uid, breed: 0 }];
exh.eggs = [];
for (let i = 0; i < 40 && !exh.eggs.length; i++) L.tick(exh, 0.25);
check(exh.eggs.length === 1, '母体撑不住也会先产下最后一胎');
check(L.monByUid(exh, exhMom.uid) === null, '产完最后一胎后力竭而死');

// 死胎：体质 1.0 永不发生；体质 0.5 会出现
const runCycles = (vigor) => {
  const st = L.newGame(4306);
  const dad = L.createMon(st, 16, CONFIG.maxLevel, { gender: 'm' });
  const mom = L.createMon(st, 21, CONFIG.maxLevel, { gender: 'f' });
  mom.vigor = vigor;
  mom.tolerance = 1e6;
  st.mons = [dad, mom];
  st.pens = [{ a: dad.uid, b: mom.uid, breed: 0 }];
  st.eggs = [];
  let stillbirths = 0;
  let sawMsg = false;
  for (let i = 0; i < 120; i++) {
    const evs = L.tick(st, CONFIG.breedDays);
    const sb = evs.find((e) => e.stillbirth);
    if (sb) {
      stillbirths++;
      if (sb.msg === '这一胎没有成型。母体照样耗掉了这一次。') sawMsg = true;
    }
    st.eggs = [];
  }
  return { stillbirths, sawMsg };
};
const sbHealthy = runCycles(1);
check(sbHealthy.stillbirths === 0, '体质 1.0 时不会死胎', `(${sbHealthy.stillbirths})`);
const sbWeak = runCycles(0.5);
check(sbWeak.stillbirths > 0, '体质 0.5 时会出现死胎', `(${sbWeak.stillbirths})`);
check(sbWeak.sawMsg, '死胎文案正确');

// 开局 3 只：一雄两雌，两只雌性同物种且彼此无亲缘
const start3 = L.newGame(4307);
check(start3.mons.length === 3, '开局 3 只');
const start3F = start3.mons.filter((m) => m.dexId === 21 && m.gender === 'f');
check(start3F.length === 2, '开局有两只同物种雌性');
check(!L.isKin(start3F[0], start3F[1]), '两只开局雌性彼此无亲缘');
check(start3.pens[0].a && start3.pens[0].b, '开局第一栏位已有配对');

// ---------- 培育栏 → 实验室 ----------
const mvState = L.newGame(4301);
const mvA = L.createMon(mvState, 16, CONFIG.maxLevel, { gender: 'm' });
const mvB = L.createMon(mvState, 21, CONFIG.maxLevel, { gender: 'f' });
mvState.mons = [mvA, mvB];
mvState.pens = [
  { a: mvA.uid, b: mvB.uid, breed: 1.2 },
  { a: null, b: null, breed: 0 },
];
const penToLabBlocked = L.assignLab(mvState, 0, mvA.uid);
check(penToLabBlocked.ok === false, 'assignLab 不接受培育栏里的个体', penToLabBlocked.msg);
const penToLab = L.sendPenToLab(mvState, mvA.uid, 0);
check(penToLab.ok, '培育栏详情可以把个体送进实验室', penToLab.msg);
check(L.penIndex(mvState, mvA.uid) === -1, '送进实验室后离开培育栏');
check(mvState.pens[0].a === null && mvState.pens[0].breed === 0, '原栏位清空且繁育条归零');
check(L.labContains(mvState, mvA.uid), '个体已经在实验室里');
check(L.sendPenToLab(mvState, mvB.uid, 0).ok === false, '实验台被占用时不能把栏位个体送进去');
check(L.penIndex(mvState, mvB.uid) !== -1, '送入失败时个体仍留在培育栏');
mvState.lab[0].corpse = { dexId: 16, no: null, level: 1, gender: 'm', day: 1, cause: 'overload' };
mvState.lab[0].uid = null;
check(L.sendPenToLab(mvState, mvB.uid, 0).ok === false, '有遗体的实验台不能送入');
check(L.penIndex(mvState, mvB.uid) !== -1, '遗体占位时个体仍留在培育栏');

// ---------- 按物种累计花费 ----------
const spendState = L.newGame(4306);
const spendMon = L.createMon(spendState, 16, 20, { gender: 'm' });
spendState.mons.push(spendMon);
L.assignLab(spendState, 0, spendMon.uid);
spendMon.tolerance = 200; // 夹具：只关心花费累加
const beforeSpend = (spendState.speciesSpend[16] || { exp: 0, corpse: 0 }).exp;
L.startExperiment(spendState, spendMon.uid, 'measure');
const measureCost = L.experimentsFor(16).find((e) => e.id === 'measure').cost;
check(spendState.speciesSpend[16].exp === beforeSpend + measureCost, '实验花费按物种累计', `(${spendState.speciesSpend[16].exp})`);
const procCost = L.labProcessCost(spendState, 0);
spendState.gold = 9999;
L.processLabSlot(spendState, 0);
check(spendState.speciesSpend[16].corpse === procCost, '处理活体花费按物种累计', `(${spendState.speciesSpend[16].corpse})`);
const idleCorpseState = L.newGame(4307);
idleCorpseState.gold = 999;
idleCorpseState.idleCorpses = [{ dexId: 21, no: 1, level: 3, gender: 'f', day: 2, cause: 'bully' }];
L.processIdleCorpse(idleCorpseState, 0);
check(idleCorpseState.speciesSpend[21].corpse === CONFIG.idleCorpseProcessCost, '围栏遗体处理花费按物种累计');

// ---------- 设施表：喂食器已移除 ----------
check(!('feeder' in UPGRADE_INFO), '自动喂食器已从设施表移除');
check(!('feeder' in L.newGame(4302).upgrades), '新档不再有喂食器字段');
check(!('feederTimer' in L.newGame(4303)), '新档不再有喂食器计时器');

// ---------- 蛋位守卫 ----------
const guardState = L.newGame(4304);
guardState.eggs = Array.from({ length: L.eggSlots(guardState) }, (_, i) => ({ uid: `g${i}`, dexId: 16, daysLeft: 5, total: 5 }));
const beforeEggs = guardState.eggs.length;
const fullBuy = L.buyEggOffer(guardState, 0);
check(fullBuy.ok === false && fullBuy.msg.includes('孵化器已满'), '蛋位满时买蛋被拒绝', fullBuy.msg);
check(guardState.eggs.length === beforeEggs, '被拒绝时不会多出蛋');

// ---------- 争斗 tie-break 用数值编号 ----------
const tieState = L.newGame(4305);
const tieA = L.createMon(tieState, 16, 5, {});
const tieB = L.createMon(tieState, 16, 5, {});
tieA.uid = 'u10';
tieB.uid = 'u9';
check(L.weakerOf(tieA, tieB)[0].uid === 'u9', '同等级同种族值时按编号数值比较（u9 弱于 u10）');

// ---------- 围栏分组：培育相关 / 其它 ----------
const secState = L.newGame(4310);
const vaporeon = L.createMon(secState, 134, 10, { gender: 'm' }); // 水伊布（在培育栏）
const flareon = L.createMon(secState, 136, 10, { gender: 'm' }); // 火伊布（同一进化链）
const pidgeyIdle = L.createMon(secState, 16, 10, { gender: 'm' }); // 波波（无关物种）
secState.mons = [vaporeon, flareon, pidgeyIdle];
secState.pens = [{ a: vaporeon.uid, b: null, breed: 0 }];
const evoIds = L.evolutionChainIds(134);
check([133, 134, 135, 136].every((id) => evoIds.includes(id)), '进化链包含分支进化的全部物种', evoIds.join(','));
const sections = L.idleSections(secState);
check(sections.related.some((m) => m.uid === flareon.uid), '同链其它分支归入培育相关');
check(sections.others.some((m) => m.uid === pidgeyIdle.uid), '无关物种归入其它');
check(!sections.related.some((m) => m.uid === pidgeyIdle.uid), '无关物种不出现在培育相关');
check(!sections.others.some((m) => m.uid === vaporeon.uid), '培育栏里的个体不出现在围栏分组');

// ---------- 围栏霸凌 ----------
const idleFight = L.newGame(8200);
const f1 = L.createMon(idleFight, 16, CONFIG.maxLevel, { gender: 'm' });
const f2 = L.createMon(idleFight, 16, CONFIG.maxLevel, { gender: 'm' });
idleFight.mons = [f1, f2];
const f0 = f1.tolerance;
L.tick(idleFight, 1);
check(f1.tolerance === f0 && f2.tolerance === maxTolerance(f2), '同种同性 2 只不触发霸凌');
check(L.idleConflicts(idleFight).length === 0, '2 只不显示霸凌冲突');

const idleFight3 = L.newGame(8201);
const g1 = L.createMon(idleFight3, 16, CONFIG.maxLevel, { gender: 'm' });
const g2 = L.createMon(idleFight3, 16, CONFIG.maxLevel, { gender: 'm' });
const g3 = L.createMon(idleFight3, 16, CONFIG.maxLevel, { gender: 'm' });
idleFight3.mons = [g1, g2, g3];
const t3 = g1.tolerance;
L.tick(idleFight3, 1);
check(g1.tolerance === t3 && g2.tolerance === maxTolerance(g2) && g3.tolerance === maxTolerance(g3), '同种同性 3 只仍不触发霸凌');

const idleBully = L.newGame(8202);
const b1 = L.createMon(idleBully, 16, CONFIG.maxLevel, { gender: 'm' });
const b2 = L.createMon(idleBully, 16, CONFIG.maxLevel, { gender: 'm' });
const b3 = L.createMon(idleBully, 16, CONFIG.maxLevel, { gender: 'm' });
const b4 = L.createMon(idleBully, 16, CONFIG.maxLevel, { gender: 'm' });
b1.tolerance -= 10;
idleBully.mons = [b1, b2, b3, b4];
const b1Tol = b1.tolerance;
L.tick(idleBully, 1);
check(Math.abs(b1Tol - b1.tolerance - CONFIG.bullyRatePerExtraDay) < 1e-6, '4 只时最弱者被霸凌掉耐受', `(${(b1Tol - b1.tolerance).toFixed(1)})`);
check([b2, b3, b4].every((m) => m.tolerance === maxTolerance(m)), '霸凌只伤害最弱的那只');
const bullyConflicts = L.idleConflicts(idleBully);
check(bullyConflicts.length === 1 && bullyConflicts[0].weakestUid === b1.uid, '冲突信息标记最弱个体');

// 百变怪不会被霸凌，也不形成霸凌群体
const dittoBully = L.newGame(82021);
const dt1 = L.createMon(dittoBully, 132, CONFIG.maxLevel, { gender: 'x' });
const dt2 = L.createMon(dittoBully, 132, CONFIG.maxLevel, { gender: 'x' });
const dt3 = L.createMon(dittoBully, 132, CONFIG.maxLevel, { gender: 'x' });
const dt4 = L.createMon(dittoBully, 132, CONFIG.maxLevel, { gender: 'x' });
dt1.tolerance -= 10;
dittoBully.mons = [dt1, dt2, dt3, dt4];
const dt1Tol = dt1.tolerance;
L.tick(dittoBully, 1);
check(dt1.tolerance === dt1Tol, '百变怪不会被同类霸凌');
check(L.idleConflicts(dittoBully).length === 0, '百变怪不产生霸凌冲突');

const idleCalm = L.newGame(8203);
const h1 = L.createMon(idleCalm, 16, CONFIG.maxLevel, { gender: 'm' });
const h2 = L.createMon(idleCalm, 16, CONFIG.maxLevel, { gender: 'f' });
const h3 = L.createMon(idleCalm, 21, CONFIG.maxLevel, { gender: 'm' });
idleCalm.mons = [h1, h2, h3];
L.tick(idleCalm, 1);
check(
  h1.tolerance === maxTolerance(h1) && h2.tolerance === maxTolerance(h2) && h3.tolerance === maxTolerance(h3),
  '异性或异种不会霸凌'
);

const idleDie = L.newGame(8204);
const d1 = L.createMon(idleDie, 16, CONFIG.maxLevel, { gender: 'm' });
const d2 = L.createMon(idleDie, 16, CONFIG.maxLevel, { gender: 'm' });
const d3 = L.createMon(idleDie, 16, CONFIG.maxLevel, { gender: 'm' });
const d4 = L.createMon(idleDie, 16, CONFIG.maxLevel, { gender: 'm' });
d1.tolerance = 1;
idleDie.mons = [d1, d2, d3, d4];
const dieEv = L.tick(idleDie, 1);
check(L.monByUid(idleDie, d1.uid) === null, '霸凌致死的个体离队');
check(idleDie.mons.length === 3, '其余三只仍在围栏');
check(idleDie.idleCorpses?.length === 1 && idleDie.idleCorpses[0].no === d1.no, '霸凌死亡留下遗体');
check(dieEv.some((e) => e.type === 'warn' && e.msg.includes('霸凌')), '霸凌致死有专属提示');
check(L.idleConflicts(idleDie).length === 0, '剩 3 只后霸凌解除');
check((idleDie.expJournal || []).length === 0, '霸凌死亡不计入研究笔记日志');
const savedIdle = deserialize(serialize(idleDie));
check(savedIdle.idleCorpses?.length === 1, '存档保留围栏遗体');
const logLen = idleDie.expJournal.length;
idleDie.gold = 100;
const corpseGold = idleDie.gold;
const idleCorpseRes = L.processIdleCorpse(idleDie, 0);
check(idleCorpseRes.ok && idleDie.idleCorpses.length === 0, '可以处理围栏遗体');
check(idleDie.gold === corpseGold - CONFIG.idleCorpseProcessCost, '围栏遗体处理扣费');
check(idleDie.stats.corpseSpent === CONFIG.idleCorpseProcessCost, '围栏遗体处理计入尸体成本');
check(idleDie.expJournal.length === logLen, '处理遗体不重复写日志');

// 蛋只能孵出最初形态
check(L.baseDexId(53) === 52, '猫老大的蛋应为喵喵', `(${L.baseDexId(53)})`);
check(L.baseDexId(6) === 4, '喷火龙的蛋应为小火龙', `(${L.baseDexId(6)})`);
check(L.baseDexId(31) === 29, '尼多后的蛋应为尼多兰', `(${L.baseDexId(31)})`);
check(L.baseDexId(133) === 133, '伊布的蛋仍是伊布');

const breedState = L.newGame(2024);
const persianA = L.createMon(breedState, 53, 25, { gender: 'f', origin: 'test' });
const persianB = L.createMon(breedState, 53, 25, { gender: 'm', origin: 'test' });
breedState.mons = [persianA, persianB];
breedState.pens = [{ a: persianA.uid, b: persianB.uid, breed: 0 }];
breedState.eggs = [];
let sawEgg = null;
for (let i = 0; i < 40; i++) {
  L.tick(breedState, 0.25);
  if (!sawEgg && breedState.eggs.length) sawEgg = { ...breedState.eggs[0] };
}
check(!!sawEgg, '猫老大配对能产蛋');
check(sawEgg?.dexId === 52, '产出的蛋物种是喵喵', `(${sawEgg?.dexId})`);

const marketState = L.newGame(5150);
L.refreshMarket(marketState);
const allBase = marketState.market.every((o) => !sp(o.dexId).evolvesFrom);
check(allBase, '市场只出售最初形态的蛋');
check(marketState.market.every((o) => typeof o.source === 'string' && o.source.length > 0), '市场每枚蛋都带来源');

// 来源跟着蛋 → 个体走完整个生命周期
const srcOffer = { ...marketState.market[0] };
marketState.gold = 99999;
const eggsBeforeBuy = marketState.eggs.length;
L.buyEggOffer(marketState, 0);
const boughtEgg = marketState.eggs[eggsBeforeBuy];
check(boughtEgg?.dexId === srcOffer.dexId, '买到的蛋物种正确');
check(boughtEgg?.source === srcOffer.source, '购买后蛋保留来源', `(${boughtEgg?.source})`);
boughtEgg.daysLeft = 0;
L.tick(marketState, 0.01);
const hatchedMon = L.monByUid(marketState, boughtEgg.uid);
check(hatchedMon?.source === srcOffer.source, '孵化后来源跟随个体', `(${hatchedMon?.source})`);
check(hatchedMon && L.penIndex(marketState, hatchedMon.uid) === -1, '孵出后默认不进培育栏');
check(hatchedMon && !L.labContains(marketState, hatchedMon.uid), '孵出后默认不在实验室');

// ---------- 职级与设施 ----------
const rankState = L.newGame(6001);
rankState.gold = 99999;
rankState.rep = 0;
const lockedUpg = L.buyUpgrade(rankState, 'pens'); // 第 3→4 个栏位需要职级 1
check(lockedUpg.ok === false && lockedUpg.rankLocked === 1, '低职级无法升级设施', lockedUpg.msg);
check(L.promote(rankState).ok === false, '声望不足不能晋升');
rankState.rep = 20;
const promoted = L.promote(rankState);
check(promoted.ok && rankState.rank === 1, '声望达标后花资金晋升', promoted.msg);
check(rankState.gold === 99999 - RANKS[1].cost, '晋升扣资金', `(${rankState.gold})`);
check(L.buyUpgrade(rankState, 'pens').ok, '达到职级后可升级设施');
check(L.upgradeRankReq(rankState, 'pens') === 2, '下一级需要更高职级', `(${L.upgradeRankReq(rankState, 'pens')})`);
check(L.currentRank(rankState).name === '助理研究员', '当前职级名称正确');

// ---------- 设施价格表 ----------
// 价格/职级表以“当前等级”为下标，所以长度必须恰好等于 max（0 级…max-1 级各一项）。
// 长度偏大 = 尾部有永远取不到的无效条目；偏小 = 末尾取到 undefined，升级变免费。
// 起始等级以下的条目是占位（pens 从 3 级起、lab 从 2 级起），不参与校验。
const startLevel = { pens: 3, lab: 2, incubator: 0, advertising: 0, training: 0 };
for (const [key, info] of Object.entries(UPGRADE_INFO)) {
  check(info.costs.length === info.max, `${info.name}价格表长度 = 等级上限`, `(${info.costs.length} vs ${info.max})`);
  check(info.rankReq.length === info.max, `${info.name}职级表长度 = 等级上限`, `(${info.rankReq.length} vs ${info.max})`);
  const firstCost = info.costs[startLevel[key]];
  check(Number.isFinite(firstCost) && firstCost > 0, `${info.name}首次升级不免费`, `(${firstCost})`);
}

const upgState = L.newGame(6002);
upgState.gold = 5000;
const incCost1 = L.upgradeCost(upgState, 'incubator');
check(incCost1 === 1200, '孵化器首次升级 1200 资金', `(${incCost1})`);
const slotsBefore = L.eggSlots(upgState);
check(L.buyUpgrade(upgState, 'incubator').ok, '孵化器可以升级');
check(upgState.gold === 5000 - 1200, '孵化器升级如实扣款', `(${upgState.gold})`);
check(L.eggSlots(upgState) === slotsBefore + 1, '孵化器升级 +1 蛋位', `(${L.eggSlots(upgState)})`);
check(L.upgradeCost(upgState, 'incubator') === 2600, '孵化器第二次升级 2600', `(${L.upgradeCost(upgState, 'incubator')})`);
upgState.upgrades.incubator = UPGRADE_INFO.incubator.max;
check(L.upgradeCost(upgState, 'incubator') === null, '孵化器满级后不再报价');
check(L.buyUpgrade(upgState, 'incubator').ok === false, '孵化器满级后无法购买');

const poorState = L.newGame(6003);
poorState.gold = 1199;
const poorRes = L.buyUpgrade(poorState, 'incubator');
check(poorRes.ok === false && /资金不足/.test(poorRes.msg), '资金不足时无法免费升级孵化器', poorRes.msg);
check(poorState.upgrades.incubator === 0 && poorState.gold === 1199, '升级失败不改变状态');

// ---------- 胜利条件 ----------
const allIds = Object.keys(dex.species).map(Number);
const winState = L.newGame(31337);
winState.dex = allIds.slice(0, 150);
check(L.checkVictory(winState) === null, '未集齐 151 不触发胜利');
winState.dex = allIds;
const winEvt = L.checkVictory(winState);
check(winEvt?.type === 'win' && winState.won === true, '集齐 151 触发胜利');
check(L.checkVictory(winState) === null, '胜利只触发一次');

// ---------- 认输 ----------
const quitState = L.newGame(7001);
const dayBefore = quitState.day;
const quitRes = L.quitGame(quitState);
check(quitRes.ok && quitState.quit === true, '可以离开火箭队认输');
check(L.tick(quitState, 5).length === 0, '认输后不再推进时间');
check(quitState.day === dayBefore, '认输后日期冻结');
check(L.quitGame(quitState).ok === false, '不能重复认输');

// ---------- 进化道具 ----------
const stone = L.newGame(999);
const pikachu = L.createMon(stone, 25, 20, { origin: 'test' });
stone.mons.push(pikachu);
stone.inventory['thunder-stone'] = 1;
const plan = L.evoPlanFor(stone, pikachu).find((p) => p.kind === 'item');
check(!!plan && plan.ready, '雷丘进化路线可识别');
const evolved = L.evolveWithItem(stone, pikachu, plan);
check(evolved.ok && pikachu.dexId === 26, '雷之石进化成功');
check(stone.inventory['thunder-stone'] === 0, '进化石被消耗');

// 通信进化
const tradeMon = L.createMon(stone, 93, 30, { origin: 'test' });
stone.mons.push(tradeMon);
stone.inventory['trade-cable'] = 1;
const tplan = L.evoPlanFor(stone, tradeMon).find((p) => p.kind === 'trade');
check(!!tplan, '通信进化路线可识别');
check(L.evolveWithItem(stone, tradeMon, tplan).ok && tradeMon.dexId === 94, '通信电缆进化成功');

// ---------- 纯配种链路 ----------
const pure = L.newGame(777);
for (let i = 0; i < 200; i++) L.tick(pure, 0.25);
check(pure.stats.bred > 0, '配种产出蛋', `(${pure.stats.bred})`);
check(pure.stats.hatched > 0, '蛋能自然孵化', `(${pure.stats.hatched})`);

// 部门需求
check(state.orders.every((o) => !!o.dept), '订单都带部门归属');
check(DEPARTMENTS.length >= 4, '存在多个火箭队部门', `(${DEPARTMENTS.length})`);

// ---------- 总裁办 ----------
check(DEPARTMENTS.some((d) => d.id === 'board'), '存在总裁办');
const b0 = L.newGame(9100);
b0.rank = 0;
const b5 = L.newGame(9101);
b5.rank = 5;
let c0 = 0;
let c5 = 0;
let boardSample = null;
for (let i = 0; i < 3000; i++) {
  const o0 = L.makeOrder(b0);
  if (o0.dept === 'board') c0++;
  const o5 = L.makeOrder(b5);
  if (o5.dept === 'board') {
    c5++;
    if (!boardSample) boardSample = o5;
  }
}
check(c0 > 0 && c0 < 150, '总裁办初始极度稀少', `(${c0}/3000)`);
check(c5 > c0, '职级越高总裁办越多', `(${c0} → ${c5})`);
check((boardSample?.repGain ?? 0) > 4, '总裁办声望增益更高', boardSample ? `+${boardSample.repGain}` : '无样本');

const rewardProbe = L.newGame(9302);
rewardProbe.rank = 3;
let normalSum = 0, normalCount = 0, boardSum = 0, boardCount = 0;
for (let i = 0; i < 1200; i++) {
  const o = L.makeOrder(rewardProbe);
  if (o.dept === 'board') { boardSum += o.reward; boardCount++; }
  else { normalSum += o.reward; normalCount++; }
}
const normalAvg = normalSum / Math.max(1, normalCount);
const boardAvg = boardSum / Math.max(1, boardCount);
check(boardCount > 0 && boardAvg > normalAvg * 2, '普通订单金币大幅下调、总裁办更高', `(${Math.round(normalAvg)} / ${Math.round(boardAvg)})`);

const boardState = L.newGame(9200);
boardState.rep = 0;
const mkBoardOrder = (id) => ({
  id,
  dept: 'board',
  kind: 'any',
  dexId: null,
  type: null,
  minLevel: 1,
  needNature: 0,
  reward: 500,
  repGain: 13,
  repLoss: 10,
  abandonLoss: 8,
  deadline: boardState.day + 5,
  created: boardState.day,
});
boardState.orders = [mkBoardOrder('ob1')];
const anyMon = L.createMon(boardState, 16, 10, {});
boardState.mons.push(anyMon);
check(L.deliver(boardState, 'ob1', anyMon.uid).ok && boardState.rep === 13, '交付总裁办声望 +13', `(${boardState.rep})`);

const abState = L.newGame(9201);
abState.rep = 20;
abState.orders = [{ ...mkBoardOrder('ob2'), deadline: abState.day + 5 }];
const abRes = L.abandonOrder(abState, 'ob2');
check(abRes.ok && abState.rep === 20, '放弃需求不再扣声望', `(${abState.rep})`);
check(abRes.msg.includes('不再扣除'), '放弃提示不再扣声望', abRes.msg);

const exState = L.newGame(9202);
exState.rep = 20;
exState.orders = [{ ...mkBoardOrder('ob3'), deadline: exState.day + 0.1 }];
exState.day += 0.2;
L.tick(exState, 0.01);
check(exState.rep === 20, '总裁办过期不再扣声望', `(${exState.rep})`);
check(boardState.lastTaskDay === boardState.day, '交付订单会重置闲置计时');

// 声望闲置流失
const decayState = L.newGame(9300);
decayState.rep = 50;
decayState.lastTaskDay = 0;
decayState.day = 2.5;
check(!L.repDecay(decayState).active, '未到阈值不流失声望');
decayState.day = 4;
const decay1 = L.repDecay(decayState);
check(decay1.active && decay1.rate > 0, '超过阈值开始流失声望');
decayState.day = 14;
const decay2 = L.repDecay(decayState);
check(decay2.rate > decay1.rate, '闲置越久流失越快', `(${decay1.rate.toFixed(2)}→${decay2.rate.toFixed(2)})`);
const repBeforeTick = decayState.rep;
L.tick(decayState, 1);
check(decayState.rep < repBeforeTick, '闲置流失会在 tick 中扣声望');

check(CONFIG.orderRewardMultiplier < 1 && CONFIG.boardOrderRewardMultiplier > 2, '普通订单金币下调、总裁办上调');

// 订单交付排除培育栏 / 实验室
const delState = L.newGame(9400);
const delOrder = {
  id: 'odel', dept: 'research', kind: 'any', dexId: null, type: null, minLevel: 1, needNature: 0,
  reward: 100, repGain: 4, deadline: delState.day + 5, created: delState.day,
};
delState.orders = [delOrder];
const penCand = L.createMon(delState, 16, 5, { gender: 'm' });
const labCand = L.createMon(delState, 16, 5, { gender: 'f' });
delState.mons.push(penCand, labCand);
L.assignPen(delState, 1, 'a', penCand.uid);
L.assignLab(delState, 0, labCand.uid);
check(!L.deliverableMons(delState, delOrder).some((m) => m.uid === penCand.uid), '培育栏个体不可交付');
check(!L.deliverableMons(delState, delOrder).some((m) => m.uid === labCand.uid), '实验室个体不可交付');
check(!L.deliver(delState, delOrder.id, penCand.uid).ok, '培育栏个体交付被拒绝');
check(!L.deliver(delState, delOrder.id, labCand.uid).ok, '实验室个体交付被拒绝');
L.removeFromPen(delState, penCand.uid);
check(L.deliverableMons(delState, delOrder).some((m) => m.uid === penCand.uid), '移出培育栏后可交付');
check(L.deliver(delState, delOrder.id, penCand.uid).ok, '闲置个体交付成功');

// 实验死亡遗体占位与处理费用
const corpseState = L.newGame(9500);
const corpseMon = L.createMon(corpseState, 16, 60, { gender: 'm' });
corpseState.mons.push(corpseMon);
L.assignLab(corpseState, 0, corpseMon.uid);
corpseMon.tolerance = 1;
corpseState.gold = 1000;
const corpseExp = L.experimentsFor(16)[0];
const corpseRes = L.startExperiment(corpseState, corpseMon.uid, corpseExp.id);
check(corpseRes.ok && corpseRes.released, '致死实验正常完成');
check(L.monByUid(corpseState, corpseMon.uid) === null, '死亡个体从名单移除');
check(!!corpseState.lab[0].corpse, '死亡个体留下遗体');
check(L.labOccupied(corpseState) === 1, '遗体占用实验台');
const blockedMon = L.createMon(corpseState, 16, 5, { gender: 'f' });
corpseState.mons.push(blockedMon);
check(!L.assignLab(corpseState, 0, blockedMon.uid).ok, '遗体占位时不能放新个体');
const corpseCost = L.labProcessCost(corpseState, 0);
check(corpseCost === CONFIG.labCorpseProcessCost, '遗体处理费用固定且较低', `(${corpseCost})`);
const savedCorpse = deserialize(serialize(corpseState));
check(!!savedCorpse.lab[0].corpse, '存档保留遗体');
corpseState.gold = 0;
check(!L.processLabSlot(corpseState, 0).ok, '资金不足不能处理');
check(!!corpseState.lab[0].corpse, '处理失败遗体仍占位');
corpseState.gold = 100;
const goldBeforeCorpse = corpseState.gold;
const processRes = L.processLabSlot(corpseState, 0);
check(processRes.ok && corpseState.gold === goldBeforeCorpse - corpseCost, '处理遗体扣费');
check(corpseState.stats.corpseSpent === corpseCost, '记录遗体处理消耗总额');
check(corpseState.expJournal?.length === 1 && corpseState.expJournal[0].expName !== '处理', '处理遗体不重复写日志');
check(L.researchLostCount(corpseState, 16) === 1, '处理遗体不重复计损耗');
check(!corpseState.lab[0].corpse && L.labOccupied(corpseState) === 0, '处理后实验台空出');

const livingCostState = L.newGame(9501);
const livingMon = L.createMon(livingCostState, 16, 60, { gender: 'm' });
livingCostState.mons.push(livingMon);
L.assignLab(livingCostState, 0, livingMon.uid);
const costHigh = L.labProcessCost(livingCostState, 0);
livingMon.tolerance = 1;
const costLow = L.labProcessCost(livingCostState, 0);
check(costHigh > costLow, '活体处理费用随剩余耐受度提高', `(${costHigh}→${costLow})`);
const livingProcess = L.processLabSlot(livingCostState, 0);
check(livingProcess.ok && L.researchLostCount(livingCostState, 16) === 1, '处理活体计入研究损耗');
check(livingCostState.expJournal?.[0]?.expName === '处理' && livingCostState.expJournal[0].survived === false, '处理活体写入实验日志');

const doneProcessState = L.newGame(9502);
const doneProcessMon = L.createMon(doneProcessState, 16, 60, { gender: 'm' });
doneProcessState.mons.push(doneProcessMon);
L.assignLab(doneProcessState, 0, doneProcessMon.uid);
doneProcessState.research[16] = L.researchRequirement(16);
const doneProcess = L.processLabSlot(doneProcessState, 0);
check(doneProcess.ok && !doneProcess.logged, '研究满 100% 后处理不再记录');
check(L.researchLostCount(doneProcessState, 16) === 0 && (doneProcessState.expJournal || []).length === 0, '研究满 100% 后不计损耗、不写日志');

// 闪光 / 不孕不育
check(CONFIG.shinyChance === 1 / 4096 && CONFIG.sterileChance === 2 / 4096, '闪光 1/4096、不孕不育 2/4096');
const specialState = L.newGame(9600);
const shinyMon = L.createMon(specialState, 16, 5, { gender: 'f', shiny: true, sterile: true });
const normalMale = L.createMon(specialState, 16, 5, { gender: 'm' });
specialState.mons.push(shinyMon, normalMale);
check(shinyMon.shiny === true && shinyMon.sterile === true, '闪光与不孕可以共存');
check(L.sterilityLabel(shinyMon) === '不孕', '雌性标注不孕');
check(L.sterilityLabel(normalMale) === '', '正常雄性没有不育标记');
const sterileComp = L.compatibility(shinyMon, normalMale);
check(!sterileComp.ok && sterileComp.sterile === true, '不孕个体无法配种');
specialState.pens = [{ a: shinyMon.uid, b: normalMale.uid, breed: 0 }];
specialState.eggs = [];
specialState.market = [];
const sterileEvents = L.tick(specialState, 3);
check(specialState.eggs.length === 0, '不孕配对不产蛋');
check((specialState.stats.fights || 0) === 0, '不孕配对不触发争斗');
check(sterileEvents.some((e) => e.sterile && e.msg.includes('不孕')), '不孕配对有明确提示');
const specialRound = deserialize(serialize(specialState));
check(specialRound.mons.find((m) => m.uid === shinyMon.uid)?.shiny === true, '存档保留闪光');
check(specialRound.mons.find((m) => m.uid === shinyMon.uid)?.sterile === true, '存档保留不孕');

// 市场与数值
check(L.sellPrice(a) > 0 && L.sellPrice(a) < L.monValue(a), '售价低于估值');

console.log(`\n${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
