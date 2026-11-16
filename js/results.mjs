// 实验结果的按物种懒加载：启动只加载基础行为，进入实验时再取对应物种文件。
let baseResults = {};
const speciesResults = new Map();
const pending = new Map();

export function initBaseResults(payload) {
  baseResults = payload || {};
}

// 测试/预取注入用
export function seedSpeciesResults(dexId, payload) {
  speciesResults.set(Number(dexId), payload || {});
}

export function speciesResultsLoaded(dexId) {
  return speciesResults.has(Number(dexId));
}

export function clearResultCache() {
  speciesResults.clear();
  pending.clear();
}

export async function ensureSpeciesResults(dexId) {
  const id = Number(dexId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的研究笔记编号');
  if (speciesResults.has(id)) return speciesResults.get(id);
  if (pending.has(id)) return pending.get(id);
  const p = fetch(`data/results/${id}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`实验记录加载失败（HTTP ${res.status}）`);
      return res.json();
    })
    .then((data) => {
      speciesResults.set(id, data || {});
      return data;
    })
    .finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

export function resultPoolFor(expId) {
  if (baseResults[expId]) return baseResults[expId];
  for (const bundle of speciesResults.values()) {
    if (bundle[expId]) return bundle[expId];
  }
  return null;
}
