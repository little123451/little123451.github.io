// 逻辑层冒烟测试：模拟 300 天，检查不变量与经济
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as L from '../js/logic.mjs';
import { initDex, sp, bst } from '../js/data.mjs';

const dex = JSON.parse(await readFile(fileURLToPath(new URL('../data/dex.json', import.meta.url)), 'utf8'));
initDex(dex);

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
check(state.mons.length === 2, '初始 2 只宝可梦');
check(state.orders.length === 2, '初始订单');
check(state.market.length === 3, '初始蛋市场');

// 基础兼容性
const [a, b] = state.mons;
check(!L.compatibility(state, a, a).ok, '不能和自己配种');
check(L.compatibility(state, a, b).ok, '波波 + 烈雀 可配种（同为飞行组）');

// 喂食：只增加经验，不再有亲密度
const lv0 = a.level;
const exp0 = a.exp;
L.buyBerries(state, 5);
const berriesAfterBuy = state.berries;
L.feed(state, a.uid);
check(state.berries === berriesAfterBuy - 1, '喂食消耗树果', `(${state.berries})`);
check(a.level > lv0 || a.exp > exp0, '喂食增加经验');
check(L.compatibility(state, a, b).ok, '无需亲密度即可配种');

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
  // 缺树果就补
  if (state.berries < 5 && state.gold > 200) L.buyBerries(state, 10);
  // 偶尔升级设施
  if (state.gold > 6000 && L.upgradeCost(state, 'incubator') != null && state.upgrades.incubator < 2) L.buyUpgrade(state, 'incubator');
  if (state.gold > 9000 && state.pens.length < 5) L.buyUpgrade(state, 'pens');
}

console.log(`\n--- 模拟 300 天后 ---`);
console.log(`天数=${state.day.toFixed(1)} 金币=${state.gold} 树果=${state.berries} 声望=${state.rep}`);
console.log(`宝可梦=${state.mons.length} 蛋=${state.eggs.length} 订单=${state.orders.length} 已完成图鉴=${state.dex.length}`);
console.log(`交付=${delivered} 孵化=${state.stats.hatched} 配种=${state.stats.bred} 过期=${state.stats.expired}`);
console.log(`事件=${totalEvents.length} 进化=${totalEvents.filter((e) => e.type === 'evolve').length} 升级=${totalEvents.filter((e) => e.type === 'level').length}`);

check(Number.isFinite(state.gold) && state.gold >= 0, '金币合法');
check(state.mons.every((m) => m.gold !== null && Number.isFinite(m.exp) && Number.isFinite(m.level) && m.level >= 1 && m.level <= L.CONFIG.maxLevel), '宝可梦数值合法');
check(new Set(state.mons.map((m) => m.uid)).size === state.mons.length, 'UID 唯一');
check(state.eggs.length <= L.eggSlots(state), '蛋位不超上限');
check(state.orders.length <= L.orderSlots(state), '订单不超上限');
check(state.dex.length === 0, '未做实验的物种不解锁图鉴', `(${state.dex.length})`);
check(totalEvents.some((e) => e.type === 'evolve'), '发生过进化');
check(delivered > 0, '完成过交付', `(${delivered})`);

// 存档往返
const raw = L.serialize(state);
const loaded = L.deserialize(raw);
check(!!loaded, '存档可反序列化');
check(loaded.gold === state.gold && loaded.mons.length === state.mons.length, '存档字段一致');
check(L.deserialize(JSON.stringify({ v: 1, mons: [] })) === null, '旧版本存档被忽略');

// ---------- 实验室 ----------
const reqPidgey = L.researchRequirement(16);
const reqMew = L.researchRequirement(151);
check(reqPidgey === 40, '波波研究要求 40', `(${reqPidgey})`);
check(reqMew === 334, '梦幻研究要求更高', `(${reqMew})`);

const lab = L.newGame(2025);
const subject = L.createMon(lab, 16, 10, { origin: 'test' });
lab.mons.push(subject);

check(L.assignLab(lab, 0, subject.uid).ok, '可以放进实验室');
check(subject.tolerance === L.CONFIG.toleranceBase, '进实验室耐受度满值', `(${subject.tolerance})`);
check(L.assignLab(lab, 1, subject.uid).ok === false, '同一只不能重复放入');
check(L.feed(lab, subject.uid).ok === false, '实验室里的不能喂食');
check(L.sellMon(lab, subject.uid).ok === false, '实验室里的不能出售');

const gold0 = lab.gold;
const exp1 = L.startExperiment(lab, subject.uid, 'measure');
check(exp1.ok && !exp1.released, '基础体测成功');
check(subject.tolerance < L.CONFIG.toleranceBase, '耐受度下降', `(${subject.tolerance})`);
check(L.researchProgress(lab, 16) === 4, '研究进度 +4');
check(lab.gold === gold0, '免费实验不扣资金');

const exp2 = L.startExperiment(lab, subject.uid, 'sample');
check(lab.gold === gold0 - 30, '实验扣除资金', `(${lab.gold})`);
check(L.researchProgress(lab, 16) === 11, '进度累加');

// 继续实验直到解锁
let guard2 = 0;
while (!L.isResearched(lab, 16) && L.monByUid(lab, subject.uid) && guard2++ < 40) {
  L.startExperiment(lab, subject.uid, 'measure');
}
check(L.isResearched(lab, 16), '累计进度达到要求');
check(lab.dex.includes(16), '研究完成后解锁图鉴');

// 超出耐受：实验不生效、放生
const lab2 = L.newGame(2026);
const weak = L.createMon(lab2, 19, 5, { origin: 'test' });
lab2.mons.push(weak);
L.assignLab(lab2, 0, weak.uid);
weak.tolerance = 3;
const goldBefore = lab2.gold;
const overload = L.startExperiment(lab2, weak.uid, 'stress');
check(overload.ok && overload.released, '超出耐受会放生');
check(L.monByUid(lab2, weak.uid) === null, '放生后从名单移除');
check(lab2.gold === goldBefore, '实验不生效不扣资金');
check(L.researchProgress(lab2, 19) === 0, '实验不生效不给进度');
check(lab2.lab[0].uid === null, '实验室空出位置');

// 耐受恰好归零：给完进度后放生
const lab3 = L.newGame(2027);
const edge = L.createMon(lab3, 16, 5, { origin: 'test' });
lab3.mons.push(edge);
L.assignLab(lab3, 0, edge.uid);
edge.tolerance = 2;
const exact = L.startExperiment(lab3, edge.uid, 'measure');
check(exact.released, '耐受归零时放生');
check(L.researchProgress(lab3, 16) === 4, '归零前进度已结算');
check(L.monByUid(lab3, edge.uid) === null, '归零后移除');

// 手动放生
const lab4 = L.newGame(2028);
const spare = L.createMon(lab4, 16, 5, { origin: 'test' });
lab4.mons.push(spare);
L.assignLab(lab4, 0, spare.uid);
check(L.releaseMon(lab4, spare.uid, 'manual').ok, '可以手动放生');
check(lab4.stats.released >= 1, '放生统计 +1');

// 图鉴进度按物种共享
const shared = L.newGame(2029);
const p1 = L.createMon(shared, 16, 5, {});
const p2 = L.createMon(shared, 16, 5, {});
shared.mons.push(p1, p2);
L.assignLab(shared, 0, p1.uid);
L.startExperiment(shared, p1.uid, 'measure');
check(L.researchProgress(shared, 16) === 4, '不同个体共享物种进度');
check(L.researchPercent(shared, 16) === 10, '进度百分比正确', `(${L.researchPercent(shared, 16)}%)`);

// 胜利条件
const allIds = Object.keys(dex.species).map(Number);
const winState = L.newGame(31337);
winState.dex = allIds.slice(0, 150);
check(L.checkVictory(winState) === null, '未集齐 151 不触发胜利');
winState.dex = allIds;
const winEvt = L.checkVictory(winState);
check(winEvt?.type === 'win' && winState.won === true, '集齐 151 触发胜利');
check(L.checkVictory(winState) === null, '胜利只触发一次');

// 进化道具路径
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

// 配种链路（不买蛋，纯靠配种）
const br = L.newGame(777);
const brEvents = [];
for (let i = 0; i < 200; i++) brEvents.push(...L.tick(br, 0.25));
check(br.stats.bred > 0, '配种产出蛋', `(${br.stats.bred})`);
check(br.stats.hatched > 0, '蛋能自然孵化', `(${br.stats.hatched})`);

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
for (let i = 0; i < 40; i++) L.tick(breedState, 0.25);
check(breedState.eggs.length > 0, '猫老大配对能产蛋');
check(breedState.eggs[0]?.dexId === 52, '产出的蛋物种是喵喵', `(${breedState.eggs[0]?.dexId})`);

const marketState = L.newGame(5150);
L.refreshMarket(marketState);
const allBase = marketState.market.every((o) => !sp(o.dexId).evolvesFrom);
check(allBase, '市场只出售最初形态的蛋');

// 部门需求
check(state.orders.every((o) => !!o.dept), '订单都带部门归属');
check(L.DEPARTMENTS.length >= 4, '存在多个火箭队部门', `(${L.DEPARTMENTS.length})`);

// 市场与数值
check(L.sellPrice(a) > 0 && L.sellPrice(a) < L.monValue(a), '售价低于估值');

console.log(`\n${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
