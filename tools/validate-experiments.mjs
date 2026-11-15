// 校验 data/experiments.json：覆盖、条数、id、档位、文案长度与最终选项数。
// 用法: node tools/validate-experiments.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../data/experiments.json', import.meta.url));
const BASE_IDS = ['measure', 'sample', 'battle'];
const TIERS = ['gentle', 'standard', 'harsh'];
const data = JSON.parse(await readFile(FILE, 'utf8'));

const errors = [];
const warnings = [];
const ids = new Set();
const names = new Map();
const tierCount = { gentle: 0, standard: 0, harsh: 0 };
const customDist = {};
const finalDist = {};
let total = 0;
const len = (s) => [...s].length;

for (let id = 1; id <= 151; id++) {
  const entry = data.species?.[id];
  if (!entry) {
    errors.push(`缺少物种 #${id}`);
    continue;
  }
  const list = entry.experiments;
  if (!Array.isArray(list)) {
    errors.push(`#${id} experiments 不是数组`);
    continue;
  }
  if (list.length < 2 || list.length > 8) errors.push(`#${id} 专属条数 ${list.length}，应为 2–8`);
  customDist[list.length] = (customDist[list.length] || 0) + 1;
  const finalCount = list.length < 5 ? 5 : list.length;
  finalDist[finalCount] = (finalDist[finalCount] || 0) + 1;
  const customIds = new Set(list.map((e) => e.id));
  for (const base of BASE_IDS) {
    if (customIds.has(base)) errors.push(`#${id} 专属列表不应包含基础实验 ${base}`);
  }

  for (const e of list) {
    total++;
    if (!e.id || !e.name || !e.desc || !e.tier) errors.push(`#${id} 条目字段缺失`);
    if (!TIERS.includes(e.tier)) errors.push(`#${id} 档位非法：${e.tier}`);
    else tierCount[e.tier]++;
    if (ids.has(e.id)) errors.push(`重复 id：${e.id}`);
    ids.add(e.id);
    if (!e.id.startsWith(`sp${id}-`)) errors.push(`#${id} id 前缀错误：${e.id}`);
    if (len(e.name || '') < 4 || len(e.name || '') > 8) errors.push(`#${id} ${e.id} 名称长度 ${len(e.name || '')}`);
    if (len(e.desc || '') < 10 || len(e.desc || '') > 40) errors.push(`#${id} ${e.id} 描述长度 ${len(e.desc || '')}`);
    if (names.has(e.name)) warnings.push(`重名：${e.name}（#${names.get(e.name)} / #${id}）`);
    else names.set(e.name, id);
  }
  if (finalCount < 5 || finalCount > 8) errors.push(`#${id} 最终条数 ${finalCount} 越界`);
}

const speciesCount = Object.keys(data.species || {}).length;
if (speciesCount !== 151) errors.push(`物种数 ${speciesCount}，应为 151`);

console.log(`物种 ${speciesCount}/151，专属 ${total} 条，平均 ${(total / 151).toFixed(2)} 条/物种`);
console.log('专属条数分布:', customDist);
console.log('档位:', tierCount);
console.log('最终选项:', finalDist);
console.log('重名:', warnings.length);
for (const w of warnings) console.log('  ' + w);
console.log('错误:', errors.length);
for (const e of errors) console.log('  ' + e);
if (errors.length) process.exitCode = 1;
else console.log('校验通过 ✓');
