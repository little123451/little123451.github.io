#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://pokeapi.co/api/v2/move';
const MOVES = ['gust'];
const UA = 'little123451.github.io-build/1.0 (+https://little123451.github.io)';

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 4) throw new Error(`${url} -> ${err.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchJson(url, attempt + 1);
  }
}

const result = {};
for (const slug of MOVES) {
  const move = await fetchJson(`${API}/${slug}`);
  const nameZh = move.names.find((n) => n.language.name === 'zh-hans')?.name ?? move.name;
  result[slug] = {
    id: move.id,
    name: move.name,
    nameZh,
    type: move.type.name,
    damageClass: move.damage_class?.name ?? null,
    power: move.power,
    pp: move.pp,
    accuracy: move.accuracy,
    priority: move.priority,
  };
  console.log(`${slug}: ${nameZh} power=${move.power} pp=${move.pp} type=${move.type.name}`);
}

const outPath = join(ROOT, 'data/moves.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`Wrote ${Object.keys(result).length} move(s) to data/moves.json`);
