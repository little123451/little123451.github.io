// 一次性 LLM 文案生产工具（不是运行时生成器）。
// 用法：
//   node tools/llm-generate-results.mjs --list
//   node tools/llm-generate-results.mjs --generate [--limit N] [--concurrency N]
//   node tools/llm-generate-results.mjs --merge
//
// 配置：复制 .env.example 为 .env，填入 DEEPSEEK_API_KEY；.env 已被 gitignore。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_EXPERIMENTS } from '../js/rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM = JSON.parse(readFileSync(join(ROOT, 'data/experiments.json'), 'utf8')).species;
const OUT_DIR = join(ROOT, 'content/llm');
const SOURCE_DIRS = ['content/llm', 'content/pilot', 'content/batch2', 'content/batch3', 'content/batch4', 'content/batch5'];
const BANNED = /四肢|后腿|前肢|爪子|研究员|记录员|台面|笼|灯|纸|仪器|房间|像是|仿佛/;
const ALIVE = /活着|活下来|没死|没有死|没有断气|没断气|没有停止呼吸|呼吸还在|心跳还在|呼吸没有断|呼吸没有停|心跳没有停|仍有气息|命保住了|熬了过来|挺了过来|还在喘|还会呼吸|没有倒下/;
const DEATH = /死亡|死了|断气|呼吸停止|心跳停止|没有再醒来|遗体|没能活|没有呼吸/;
const BASE_IDS = new Set(BASE_EXPERIMENTS.map((e) => e.id));

loadDotEnv();

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.LLM_CONCURRENCY) || 4));

function loadDotEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

function behaviors() {
  const base = BASE_EXPERIMENTS.map((e) => ({
    id: e.id,
    name: e.name,
    desc: e.desc,
    dexId: null,
    species: '基础行为',
  }));
  const custom = Object.entries(CUSTOM).flatMap(([dexId, entry]) =>
    entry.experiments.map((e) => ({
      id: e.id,
      name: e.name,
      desc: e.desc,
      dexId: Number(dexId),
      species: entry.zh || entry.name || `#${dexId}`,
    }))
  );
  return [...base, ...custom];
}

function validPool(pool) {
  return (
    Array.isArray(pool?.survive) &&
    Array.isArray(pool?.death) &&
    pool.survive.length === 40 &&
    pool.death.length === 10 &&
    new Set([...pool.survive, ...pool.death]).size === 50
  );
}

function readPool(id) {
  for (const dir of SOURCE_DIRS) {
    const file = join(ROOT, dir, `${id}.json`);
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const pool = Array.isArray(data) ? null : data.id === id ? data : data[id];
      if (validPool(pool)) return { ...pool, _file: file };
    } catch {
      // 忽略损坏的暂存文件，重新生成
    }
  }
  return null;
}

function queue() {
  return behaviors().filter((b) => !readPool(b.id));
}

function printList() {
  const all = behaviors();
  const remain = queue();
  const bySpecies = new Map();
  for (const b of remain) bySpecies.set(b.species, (bySpecies.get(b.species) || 0) + 1);
  console.log(`总行为: ${all.length}`);
  console.log(`已完成: ${all.length - remain.length}`);
  console.log(`剩余: ${remain.length}`);
  for (const [species, count] of [...bySpecies].slice(0, 20)) console.log(`  ${species}: ${count}`);
  if (bySpecies.size > 20) console.log(`  ... 其余 ${bySpecies.size - 20} 组`);
}

function apiEndpoint() {
  if (BASE_URL.endsWith('/chat/completions')) return BASE_URL;
  return `${BASE_URL}/chat/completions`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request(messages, maxTokens = 6000) {
  if (!API_KEY) throw new Error('缺少 DEEPSEEK_API_KEY；请写入 .env 或在环境中设置');
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(apiEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 1.0,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(180000),
      });
      if (res.status === 401) throw new Error('API Key 无效或没有权限');
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      lastErr = err;
      if (attempt === 4) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr || new Error('模型请求失败');
}

function parseResults(text) {
  const raw = String(text || '').trim();
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型没有返回 JSON');
    parsed = JSON.parse(clean.slice(start, end + 1));
  }
  const arr = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(arr)) throw new Error('JSON 缺少 results 数组');
  return arr.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

function promptFor(behavior, kind, count, accepted = []) {
  const death = kind === 'death';
  const examples = death
    ? ['花苞彻底干瘪，香气断供，身体不再起伏。', '壳顶的裂缝一直裂到壳缘，壳片塌下去，裂口里的软肉被挤得发黑。']
    : ['创面边缘开始翻黑，抽搐从局部蔓延到全身。', '翅膜上凝着一层水膜，鳞粉被黏成一片片，拍打时两侧幅度对不上。'];
  const lines = [
    `行为：${behavior.name}`,
    `物种：${behavior.species}`,
    `行为描述：${behavior.desc}`,
    `本次只生成 ${count} 条${death ? '死亡' : '生还'}结果。`,
    '',
    '硬性规则：',
    '- 不强制字数，质量优先；可以短，但每条必须有具体后果，不能空泛。',
    '- 只写实验体自身；禁止研究员、记录员、台面、笼子、灯光、纸页、仪器、房间等旁观者/环境/道具。',
    '- 禁止四肢、后腿、前肢、爪子等肢体词。',
    '- 不引用实验行为名称，不用“像是/仿佛”等比喻。',
    '- 同批结果不能重复，句式、切入角度要变化，不要每条都写呼吸/体温/意识。',
    '- 不要用“但/却/可”作为句尾悬空。',
    '',
    death
      ? '- 这是死亡结果：只写行为后的后果和最终状态；**禁止出现死亡、死了、断气、呼吸停止、心跳停止、没有再醒来、遗体、没能活、没有呼吸**。结果卡会统一追加“实验结束后对象死亡”，正文不要自己收尾。'
      : '- 这是生还结果：只写行为后的后果和未恢复状态；**禁止出现活着、活下来、没死、没有死、没有断气、没有停止呼吸、呼吸还在、心跳还在、呼吸没有断/停、心跳没有停、仍有气息、命保住了、熬/挺了过来、还在喘、还会呼吸、没有倒下**，也禁止死亡结论。结果卡会标明生还。',
    '',
    ...examples.map((s) => `风格示例（不要照抄）：${s}`),
  ];
  if (accepted.length) {
    lines.push('', '已经生成的结果，不要重复：', ...accepted.map((s) => `- ${s}`));
  }
  lines.push('', '只返回 JSON 对象：{"results":["...","..."]}。');
  return [
    { role: 'system', content: '你是黑暗向游戏的中文实验结果文案作者。只输出合法 JSON，不解释、不用 Markdown。' },
    { role: 'user', content: lines.join('\n') },
  ];
}

function isAccepted(behavior, kind, text) {
  if (!text || BANNED.test(text) || ALIVE.test(text)) return false;
  if (behavior.name && text.includes(behavior.name)) return false;
  if (kind === 'death' && DEATH.test(text)) return false;
  if (kind === 'survive' && DEATH.test(text)) return false;
  if (/[但可却]\s*$/.test(text.replace(/[。！？]$/, ''))) return false;
  return true;
}

async function generateKind(behavior, kind, target) {
  const accepted = [];
  const seen = new Set();
  const batchSize = kind === 'survive' ? 20 : 10;
  for (let attempt = 0; attempt < 6 && accepted.length < target; attempt++) {
    const need = Math.min(batchSize, target - accepted.length);
    const text = await request(promptFor(behavior, kind, need, accepted), 6000);
    for (const item of parseResults(text)) {
      if (accepted.length >= target) break;
      if (!isAccepted(behavior, kind, item) || seen.has(item)) continue;
      seen.add(item);
      accepted.push(item);
    }
  }
  if (accepted.length < target) throw new Error(`${kind} 只得到 ${accepted.length}/${target} 条合格结果`);
  return accepted;
}

function writePool(behavior, survive, death) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${behavior.id}.json`);
  const tmp = `${file}.tmp`;
  const payload = { id: behavior.id, dexId: behavior.dexId, survive, death, model: MODEL, generatedAt: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  renameSync(tmp, file);
  return file;
}

async function generateOne(behavior) {
  if (readPool(behavior.id)) return { id: behavior.id, skipped: true };
  const survive = await generateKind(behavior, 'survive', 40);
  const death = await generateKind(behavior, 'death', 10);
  const file = writePool(behavior, survive, death);
  return { id: behavior.id, file };
}

async function runPool(list, concurrency) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      const b = list[index];
      try {
        const result = await generateOne(b);
        results.push(result);
        console.log(`${result.skipped ? 'SKIP' : 'OK'} ${b.id}${result.file ? ` -> ${result.file}` : ''}`);
      } catch (err) {
        console.error(`FAIL ${b.id}: ${err.message}`);
        results.push({ id: b.id, error: err.message });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function merge() {
  const all = behaviors();
  const byDex = new Map();
  for (const b of all) {
    if (b.dexId == null) continue;
    if (!byDex.has(b.dexId)) byDex.set(b.dexId, []);
    byDex.get(b.dexId).push(b);
  }
  const backupDir = join(OUT_DIR, 'backup');
  mkdirSync(backupDir, { recursive: true });
  let merged = 0;
  for (const [dexId, list] of byDex) {
    const pools = list.map((b) => ({ behavior: b, pool: readPool(b.id) }));
    if (pools.some((x) => !x.pool)) continue;
    const data = {};
    for (const { behavior, pool } of pools) data[behavior.id] = { survive: pool.survive, death: pool.death };
    const out = join(ROOT, 'data/results', `${dexId}.json`);
    if (existsSync(out)) writeFileSync(join(backupDir, `${dexId}.json`), readFileSync(out));
    writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
    merged++;
  }
  const baseList = BASE_EXPERIMENTS.map((e) => ({ behavior: e, pool: readPool(e.id) }));
  if (baseList.every((x) => x.pool)) {
    const data = {};
    for (const { behavior, pool } of baseList) data[behavior.id] = { survive: pool.survive, death: pool.death };
    const out = join(ROOT, 'data/results/base.json');
    if (existsSync(out)) writeFileSync(join(backupDir, 'base.json'), readFileSync(out));
    writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
    merged++;
  }
  console.log(`merged ${merged} files`);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag('--list')) {
  printList();
} else if (flag('--merge')) {
  merge();
} else if (flag('--generate')) {
  if (!API_KEY) {
    console.error('缺少 DEEPSEEK_API_KEY。请复制 .env.example 为 .env 并填写，或在环境中设置。');
    process.exit(1);
  }
  const limit = Number(option('--limit', '0')) || 0;
  const concurrency = Number(option('--concurrency', DEFAULT_CONCURRENCY)) || DEFAULT_CONCURRENCY;
  let list = queue();
  if (limit > 0) list = list.slice(0, limit);
  console.log(`待生成 ${list.length} 个行为，并发 ${concurrency}`);
  const results = await runPool(list, concurrency);
  const failed = results.filter((r) => r.error);
  console.log(`完成 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) process.exit(1);
} else {
  console.log('用法：--list | --generate [--limit N] [--concurrency N] | --merge');
}
