// 结果懒加载器：基础池、物种缓存、并发去重与失败处理。
import {
  initBaseResults,
  seedSpeciesResults,
  speciesResultsLoaded,
  ensureSpeciesResults,
  resultPoolFor,
  clearResultCache,
} from '../js/results.mjs';

let failures = 0;
const check = (ok, label, extra = '') => {
  if (ok) return;
  failures++;
  console.log(`FAIL ${label} ${extra}`);
};

clearResultCache();
initBaseResults({ measure: { survive: ['base'], death: [] } });
check(resultPoolFor('measure')?.survive[0] === 'base', '基础结果池可直接读取');
check(!speciesResultsLoaded(16), '物种结果初始未加载');
seedSpeciesResults(16, { 'sp16-x': { survive: ['a'], death: [] } });
check(speciesResultsLoaded(16), '预取后标记为已加载');
check(resultPoolFor('sp16-x')?.survive[0] === 'a', '物种结果可读取');

let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  return {
    ok: true,
    json: async () => ({ 'sp25-x': { survive: [`loaded:${url}`], death: [] } }),
  };
};
const p1 = ensureSpeciesResults(25);
const p2 = ensureSpeciesResults(25);
const [r1, r2] = await Promise.all([p1, p2]);
check(calls === 1, '同一物种并发加载只发一次请求', `(${calls})`);
check(r1 === r2, '并发请求共享结果');
check(speciesResultsLoaded(25) && resultPoolFor('sp25-x')?.survive[0].includes('loaded:'), '懒加载结果进入缓存');

clearResultCache();
globalThis.fetch = async () => ({ ok: false, status: 404 });
let failed = false;
try {
  await ensureSpeciesResults(99);
} catch {
  failed = true;
}
check(failed && !speciesResultsLoaded(99), '加载失败不写入缓存');

console.log(`\n结果懒加载测试：${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
