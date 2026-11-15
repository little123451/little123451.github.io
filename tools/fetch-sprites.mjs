// 下载第一世代像素图到 data/sprites/，让游戏不依赖外链图片
// 优先 jsDelivr（gcore），失败时回退 gh-proxy，最后回退 GitHub raw
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const GITHUB = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const SOURCES = [
  (id) => `https://gcore.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/${id}.png`,
  (id) => `https://gh-proxy.com/${GITHUB}/${id}.png`,
  (id) => `${GITHUB}/${id}.png`,
];

const DIR = fileURLToPath(new URL('../data/sprites/', import.meta.url));
const IDS = Array.from({ length: 151 }, (_, i) => i + 1);
const CONCURRENCY = 6;

await mkdir(DIR, { recursive: true });

let ok = 0;
let bytes = 0;
let next = 0;
const failed = [];

async function fetchOne(id) {
  for (const build of SOURCES) {
    const url = build(id);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'pokemon-daycare-build/1.0' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error('suspiciously small');
      await writeFile(`${DIR}${id}.png`, buf);
      ok++;
      bytes += buf.length;
      return;
    } catch {
      /* 换下一个源 */
    }
  }
  failed.push(id);
}

async function worker() {
  while (next < IDS.length) {
    const id = IDS[next++];
    await fetchOne(id);
    if (id % 25 === 0) console.log(`... ${id}/151`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`downloaded ${ok}/${IDS.length} sprites, ${(bytes / 1024).toFixed(0)} KB total`);
if (failed.length) console.log(`failed ids: ${failed.join(',')}`);
