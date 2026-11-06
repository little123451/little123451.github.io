#!/usr/bin/env node
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items';
const FORCE = process.argv.includes('--force');
const UA = 'little123451.github.io-build/1.0 (+https://little123451.github.io)';

const ICONS = {
  skill_up: 'pp-up.png',
  heal: 'oran-berry.png',
  new_skill: 'tm-flying.png',
  evolution_stone: 'oval-stone.png',
  stat_boost: 'protein.png',
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(name, attempt = 1) {
  try {
    const res = await fetch(`${BASE}/${name}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return download(name, attempt + 1);
  }
}

for (const [itemId, fileName] of Object.entries(ICONS)) {
  const outPath = join(ROOT, 'assets/items', `${itemId}.png`);
  if (!FORCE && (await exists(outPath))) {
    console.log(`${itemId} <- ${fileName} (skip)`);
    continue;
  }
  const buffer = await download(fileName);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  console.log(`${itemId} <- ${fileName} (${buffer.length} bytes)`);
}

console.log('Item icons ready: assets/items/');
