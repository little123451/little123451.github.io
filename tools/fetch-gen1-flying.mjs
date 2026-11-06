#!/usr/bin/env node
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://pokeapi.co/api/v2';
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
const CRIES = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';
const GEN1_MAX = 151;
const FORCE = process.argv.includes('--force');
const DELAY_MS = 120;
const UA = 'little123451.github.io-build/1.0 (+https://little123451.github.io)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url} -> ${err.message}`);
    await sleep(400 * attempt);
    return fetchJson(url, attempt + 1);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, path, attempt = 1) {
  if (!FORCE && (await exists(path))) return 'skip';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    return 'ok';
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url} -> ${err.message}`);
    await sleep(400 * attempt);
    return download(url, path, attempt + 1);
  }
}

function tierOf(id, total) {
  if ([144, 145, 146].includes(id)) return 'boss';
  if (total >= 330) return 'elite';
  return 'common';
}

const typeData = await fetchJson(`${API}/type/flying`);
const seen = new Map();
for (const entry of typeData.pokemon) {
  const id = Number(entry.pokemon.url.split('/').filter(Boolean).pop());
  if (!Number.isInteger(id) || id < 1 || id > GEN1_MAX) continue;
  if (!seen.has(id)) seen.set(id, { name: entry.pokemon.name, id });
}
const targets = [...seen.values()].sort((a, b) => a.id - b.id);

console.log(`Gen1 flying species: ${targets.length}`);

const pokedex = [];
for (const target of targets) {
  const [pokemon, species] = await Promise.all([
    fetchJson(`${API}/pokemon/${target.id}`),
    fetchJson(`${API}/pokemon-species/${target.id}`),
  ]);
  const nameZh = species.names.find((n) => n.language.name === 'zh-hans')?.name ?? pokemon.name;
  const stats = Object.fromEntries(
    pokemon.stats.map((s) => [s.stat.name.replace('special-attack', 'spAttack').replace('special-defense', 'spDefense'), s.base_stat]),
  );
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const sprite = `assets/sprites/${target.id}.png`;
  const cry = `assets/cries/${target.id}.ogg`;
  const spriteState = await download(`${SPRITES}/${target.id}.png`, join(ROOT, sprite));
  const cryState = await download(`${CRIES}/${target.id}.ogg`, join(ROOT, cry));

  pokedex.push({
    id: target.id,
    name: pokemon.name,
    nameZh,
    types: pokemon.types.map((t) => t.type.name),
    stats: {
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      spAttack: stats.spAttack,
      spDefense: stats.spDefense,
      speed: stats.speed,
    },
    height: pokemon.height,
    weight: pokemon.weight,
    tier: tierOf(target.id, total),
    sprite,
    cry,
  });

  console.log(
    `${String(target.id).padStart(3)} ${pokemon.name.padEnd(12)} total=${String(total).padStart(3)} ` +
      `tier=${tierOf(target.id, total).padEnd(6)} sprite=${spriteState} cry=${cryState}`,
  );
  await sleep(DELAY_MS);
}

const outPath = join(ROOT, 'data/pokemon.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(pokedex, null, 2)}\n`, 'utf8');
console.log(`Wrote ${pokedex.length} entries to data/pokemon.json`);
