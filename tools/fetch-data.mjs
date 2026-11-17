// 抓取 PokeAPI 第一世代（1-151）研究笔记数据，压缩为本地 dex.json
// 用法: node tools/fetch-data.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://pokeapi.co/api/v2';
const IDS = Array.from({ length: 151 }, (_, i) => i + 1);
const CONCURRENCY = 8;
const OUT = fileURLToPath(new URL('../data/dex.json', import.meta.url));

const cache = new Map();
const stats = { requests: 0, retries: 0 };

async function get(url, tries = 4) {
  if (cache.has(url)) return cache.get(url);
  const task = (async () => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-daycare-build/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        stats.requests++;
        return await res.json();
      } catch (err) {
        lastErr = err;
        stats.retries++;
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw new Error(`GET ${url} failed: ${lastErr?.message}`);
  })();
  cache.set(url, task);
  return task;
}

async function pool(items, worker, limit = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

const idFromUrl = (url) => Number(url.split('/').filter(Boolean).pop());

const langName = (n) => String(n.language?.name ?? '').toLowerCase();

function pickZhField(items, field) {
  for (const lang of ['zh-hans', 'zh-hant', 'zh']) {
    const hit = items.find((n) => langName(n) === lang);
    if (hit) return hit[field] ?? null;
  }
  return null;
}

function pickZh(names) {
  return pickZhField(names, 'name');
}

// 第一世代研究笔记描述：优先 Let's Go 皮卡丘/伊布（官方简体中文，151 只全覆盖），
// 退回剑盾；再不行取红版英文原文。清洗换行、换页符与软连字符。
function pickFlavor(sp) {
  const entries = sp.flavor_text_entries || [];
  const zhOf = (version) => entries.find((e) => e.version?.name === version && langName(e) === 'zh-hans');
  const pick =
    zhOf('lets-go-pikachu') ||
    zhOf('lets-go-eevee') ||
    entries.find((e) => langName(e) === 'zh-hans' && ['sword', 'shield'].includes(e.version?.name)) ||
    entries.find((e) => langName(e) === 'zh-hans') ||
    entries.find((e) => e.version?.name === 'red' && langName(e) === 'en');
  if (!pick) return '';
  return (pick.flavor_text || '')
    .replace(/[\n\f\r\u00ad]+/g, ' ')
    .replace(/\s+/g, ' ')
    // 中文排版：去掉汉字/中文标点两侧由换行带出的多余空格
    .replace(/\s+(?=[\u4e00-\u9fff（《【「『])/g, '')
    .replace(/(?<=[\u4e00-\u9fff，。！？；：、》）】」』])\s+/g, '')
    .trim();
}

function flattenChain(chain, fromId, out) {
  const toId = idFromUrl(chain.species.url);
  if (fromId) {
    out.push({
      from: fromId,
      to: toId,
      d: chain.evolution_details.map((d) => ({
        trigger: d.trigger?.name ?? null,
        minLevel: d.min_level ?? null,
        item: d.item?.name ?? null,
        heldItem: d.held_item?.name ?? null,
        happiness: d.min_happiness ?? null,
        beauty: d.min_beauty ?? null,
        affection: d.min_affection ?? null,
        timeOfDay: d.time_of_day || null,
        location: d.location?.name ?? null,
        knownMove: d.known_move?.name ?? null,
        knownMoveType: d.known_move_type?.name ?? null,
        gender: d.gender ?? null,
        needsRain: d.needs_overworld_rain ? 1 : 0,
        turnUpsideDown: d.turn_upside_down ? 1 : 0,
      })),
    });
  }
  for (const child of chain.evolves_to) flattenChain(child, toId, out);
}

function statKey(name) {
  return { hp: 'hp', attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe' }[name] || name;
}

console.log(`fetching ${IDS.length} species + pokemon ...`);
const [pairs, natures] = await Promise.all([
  pool(IDS, async (id) => {
    const [sp, pk] = await Promise.all([
      get(`${BASE}/pokemon-species/${id}`),
      get(`${BASE}/pokemon/${id}`),
    ]);
    return { id, sp, pk };
  }),
  get(`${BASE}/nature?limit=100`).then((r) => Promise.all(r.results.map((x) => get(x.url)))),
]);

console.log('fetching evolution chains ...');
const chainUrls = [...new Set(pairs.map(({ sp }) => sp.evolution_chain?.url).filter(Boolean))];
const chains = await pool(chainUrls, (url) => get(url));
const evolutions = [];
for (const chain of chains) flattenChain(chain.chain, null, evolutions);

const dex = {};
for (const { id, sp, pk } of pairs) {
  const zh = pickZh(sp.names) || sp.name;
  const evoTo = evolutions.filter((e) => e.from === id);
  const evoFrom = evolutions.find((e) => e.to === id) || null;
  dex[id] = {
    id,
    name: sp.name,
    zh,
    flavor: pickFlavor(sp),
    types: pk.types.slice().sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    stats: Object.fromEntries(pk.stats.map((s) => [statKey(s.stat.name), s.base_stat])),
    abilities: pk.abilities.map((a) => a.ability.name),
    height: pk.height,
    weight: pk.weight,
    eggGroups: sp.egg_groups.map((g) => g.name),
    hatchCounter: sp.hatch_counter,
    growthRate: sp.growth_rate.name,
    baseHappiness: sp.base_happiness,
    captureRate: sp.capture_rate,
    genderRate: sp.gender_rate,
    legendary: sp.is_legendary ? 1 : 0,
    mythical: sp.is_mythical ? 1 : 0,
    evolvesFrom: evoFrom ? { id: evoFrom.from, details: evoFrom.d } : null,
    evolvesTo: evoTo.map((e) => ({ id: e.to, details: e.d })),
  };
}

const natureData = natures.map((n) => ({
  id: n.id,
  name: n.name,
  zh: pickZh(n.names) || n.name,
  plus: n.increased_stat?.name ?? null,
  minus: n.decreased_stat?.name ?? null,
}));

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'https://pokeapi.co/api/v2',
  generation: 1,
  count: IDS.length,
  natures: natureData,
  species: dex,
};

await mkdir(dirname(OUT), { recursive: true });
const json = JSON.stringify(payload);
await writeFile(OUT, json, 'utf8');
console.log(`done: ${Object.keys(dex).length} species, ${evolutions.length} evolutions, ${natureData.length} natures`);
console.log(`requests: ${stats.requests}, retries: ${stats.retries}, size: ${(json.length / 1024).toFixed(0)} KB`);
