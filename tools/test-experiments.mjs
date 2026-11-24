// 全量实验覆盖：151 个物种、458 条实验逐条执行；同时检查组成、排序、成本、CD、文案与存档。
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as L from '../js/logic.mjs';
import { initDex, initExperiments, sp } from '../js/data.mjs';
import { initBaseResults, seedSpeciesResults } from '../js/results.mjs';
import { serialize, deserialize } from '../js/save.mjs';

const dex = JSON.parse(await readFile(fileURLToPath(new URL('../data/dex.json', import.meta.url)), 'utf8'));
const experiments = JSON.parse(await readFile(fileURLToPath(new URL('../data/experiments.json', import.meta.url)), 'utf8'));
initDex(dex);
initExperiments(experiments);
const baseResults = JSON.parse(await readFile(fileURLToPath(new URL('../data/results/base.json', import.meta.url)), 'utf8'));
initBaseResults(baseResults);
const resultData = { ...baseResults };
let resultFileCount = 0;
for (const file of await readdir(new URL('../data/results/', import.meta.url))) {
  if (!/^\d+\.json$/.test(file)) continue;
  resultFileCount++;
  const data = JSON.parse(await readFile(new URL(`../data/results/${file}`, import.meta.url), 'utf8'));
  seedSpeciesResults(Number(file.replace('.json', '')), data);
  Object.assign(resultData, data);
}

let failures = 0;
const check = (ok, label, extra = '') => {
  if (ok) return;
  failures++;
  console.log(`FAIL ${label} ${extra}`);
};

const BASE = new Set(['measure', 'sample', 'battle']);
const nameById = new Map([
  ['measure', '基础体测'],
  ['sample', '组织采样'],
  ['battle', '对战测试'],
  ...Object.values(experiments.species).flatMap((entry) => entry.experiments.map((e) => [e.id, e.name])),
]);
const allIds = new Set();
let total = 0;
let executed = 0;
let seed = 7000;

check(resultFileCount === 151, '物种结果文件按物种拆分', `(${resultFileCount})`);
check(Object.keys(resultData).length === nameById.size, '每个行为都有独立结果池', `(${Object.keys(resultData).length}/${nameById.size})`);
for (const [id, name] of nameById) {
  const pool = resultData[id];
  check(pool?.survive?.length === 40 && pool?.death?.length === 10, `${id} 结果池为 40 生还 + 10 死亡`);
  check(new Set(pool?.survive || []).size === 40 && new Set(pool?.death || []).size === 10, `${id} 结果无重复`);
  check((pool?.survive || []).every((s) => String(s).trim().length > 0), `${id} 生还结果非空`);
  check((pool?.death || []).every((s) => String(s).trim().length > 0), `${id} 死亡结果非空`);
  check((pool?.survive || []).every((s) => !s.includes(name)), `${id} 生还结果不引用行为名`);
  check((pool?.death || []).every((s) => !s.includes(name)), `${id} 死亡结果不引用行为名`);
  check((pool?.survive || []).every((s) => !/四肢|后腿|前肢/.test(s)), `${id} 生还结果不使用肢体专属词`);
  check((pool?.death || []).every((s) => !/四肢|后腿|前肢/.test(s)), `${id} 死亡结果不使用肢体专属词`);
  check((pool?.survive || []).every((s) => !/呼吸就停|没有反应|死在|断了气|遗体|再没有醒来/.test(s)), `${id} 生还池无死亡文案`);
  check((pool?.death || []).every((s) => !/还活着|没有断气|活着出来/.test(s)), `${id} 死亡池无生还文案`);
}

for (const [idStr, entry] of Object.entries(experiments.species)) {
  const id = Number(idStr);
  const custom = entry.experiments;
  check(Array.isArray(custom) && custom.length >= 2 && custom.length <= 8, `#${id} 专属条数`, `(${custom?.length})`);
  total += custom.length;

  const list = L.experimentsFor(id);
  check(list.length >= 5 && list.length <= 8, `#${id} 最终条数`, `(${list.length})`);
  check(list.every((e, i) => i === 0 || list[i - 1].progress <= e.progress), `#${id} 按强度升序`);
  check(new Set(list.map((e) => e.id)).size === list.length, `#${id} 实验 id 唯一`);
  for (const e of list) {
    allIds.add(e.id);
    check(e.name && e.desc && e.cost > 0 && e.cd > 0 && e.progress > 0, `#${id} ${e.id} 字段完整`);
    check([...e.name].length >= 4 && [...e.name].length <= 8, `#${id} ${e.id} 名称长度`);
    check([...e.desc].length >= 10 && [...e.desc].length <= 40, `#${id} ${e.id} 描述长度`);
  }
  if (custom.length < 5) {
    check(list.length === 5, `#${id} 不足 5 条补到 5`);
    const baseInList = list.filter((e) => BASE.has(e.id)).map((e) => e.id);
    const need = 5 - custom.length;
    const expect = ['battle', 'sample', 'measure'].slice(0, need);
    check(expect.every((x) => baseInList.includes(x)) && baseInList.length === need, `#${id} 按强度补入基础实验`, baseInList.join(','));
  }

  // 逐条真正执行一次（独立存档、满资金、超高耐受，排除门槛干扰）
  for (const e of list) {
    const st = L.newGame(seed++);
    st.gold = 1_000_000;
    const mon = L.createMon(st, id, 60, { gender: 'm' });
    st.mons.push(mon);
    L.assignLab(st, 0, mon.uid);
    mon.tolerance = 100000;
    const before = st.gold;
    const r = L.startExperiment(st, mon.uid, e.id);
    check(r.ok && !r.released, `#${id} ${e.id} 可执行`, r.msg);
    check(st.gold === before - e.cost, `#${id} ${e.id} 扣费正确`, `(${before - st.gold}/${e.cost})`);
    check((st.expLog?.[id]?.[e.id] || 0) === 1, `#${id} ${e.id} 写入研究记录`);
    check(L.experimentCooldown(st, mon.uid, e.id) > 0, `#${id} ${e.id} 写入个体冷却`);
    executed++;
  }
}

check(Object.keys(experiments.species).length === 151, '覆盖 151 个物种');
check(total === 458, '总实验条数 458', `(${total})`);
check(executed >= total, '每条实验都实际执行一次', `(${executed})`);

// 报告中的错位案例：伤害必须在实验对象自己身上
const byId = new Map(Object.values(experiments.species).flatMap((x) => x.experiments).map((e) => [e.id, e]));
check(byId.get('sp97-dream')?.desc.includes('它自己'), '引梦貘人梦境抽取伤害对象正确');
check(!byId.get('sp97-dream')?.desc.includes('被催眠者'), '引梦貘人不再伤害被催眠者');
const badTarget = [...byId.values()].filter(
  (e) => (e.tier === 'harsh' || e.tier === 'standard') && /测试者|被催眠者|测试皮肤|测试膜|猎物|测试对象/.test(e.desc)
);
check(badTarget.length === 0, '高损耗实验不再把伤害写在第三方身上', badTarget.map((e) => e.id).join(','));

// 存档字段：蛋组揭示、闲置计时、收束类型、个体冷却
const st = L.newGame(7777);
st.eggKnown = { 16: ['flying'] };
st.lastTaskDay = 2;
st.winKind = 'rank';
st.expCd['u1:measure'] = 5;
const round = deserialize(serialize(st));
check(round.eggKnown?.[16]?.includes('flying'), '存档保留蛋组揭示');
check(round.lastTaskDay === 2, '存档保留闲置计时');
check(round.winKind === 'rank', '存档保留收束类型');
check(round.expCd['u1:measure'] === 5, '存档保留个体冷却');

// 研究笔记完成补全蛋组
const eggState = L.newGame(7788);
const eggMon = L.createMon(eggState, 16, 60, { gender: 'm' });
eggState.mons.push(eggMon);
L.assignLab(eggState, 0, eggMon.uid);
eggMon.tolerance = 100000;
eggState.expLog = { 16: Object.fromEntries(L.experimentsFor(16).map((e) => [e.id, 1])) };
eggState.research[16] = L.researchRequirement(16) - 2;
const unlock = L.startExperiment(eggState, eggMon.uid, 'measure');
check(unlock.ok && L.isResearched(eggState, 16), '研究完成');
check(L.knownEggGroups(eggState, 16).length === sp(16).eggGroups.length, '研究完成补全蛋组');

console.log(`\n全量实验覆盖：${total} 条专属实验、${executed} 个最终选项全部执行成功，失败 ${failures}`);
process.exit(failures ? 1 : 0);
