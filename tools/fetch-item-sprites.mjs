// 下载游戏内道具像素图到 data/items/，让进化道具用“游戏内图标”而不是自制图形
// 优先 jsDelivr（gcore），失败时回退 gh-proxy，最后回退 GitHub raw
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 本站道具 id → PokeAPI sprites/items 里的文件名
const ITEMS = {
  'fire-stone': 'fire-stone',
  'water-stone': 'water-stone',
  'thunder-stone': 'thunder-stone',
  'leaf-stone': 'leaf-stone',
  'moon-stone': 'moon-stone',
  'sun-stone': 'sun-stone',
  'ice-stone': 'ice-stone',
  // 第一世代没有通信电缆，借用第八世代的“联系绳”图标
  'trade-cable': 'linking-cord',
};

const GITHUB = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items';
const SOURCES = [
  (slug) => `https://gcore.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/${slug}.png`,
  (slug) => `https://gh-proxy.com/${GITHUB}/${slug}.png`,
  (slug) => `${GITHUB}/${slug}.png`,
];

const DIR = fileURLToPath(new URL('../data/items/', import.meta.url));

await mkdir(DIR, { recursive: true });

let ok = 0;
let bytes = 0;
const failed = [];

for (const [item, slug] of Object.entries(ITEMS)) {
  let saved = false;
  for (const build of SOURCES) {
    const url = build(slug);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'rocket-simulator-build/1.0' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error('suspiciously small');
      await writeFile(`${DIR}${item}.png`, buf);
      saved = true;
      ok++;
      bytes += buf.length;
      break;
    } catch {
      /* 换下一个源 */
    }
  }
  if (!saved) failed.push(`${item}(${slug})`);
}

console.log(`downloaded ${ok}/${Object.keys(ITEMS).length} item sprites, ${(bytes / 1024).toFixed(1)} KB total`);
if (failed.length) console.log(`failed: ${failed.join(', ')}`);
