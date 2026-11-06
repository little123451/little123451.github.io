#!/usr/bin/env node
import { mkdir, writeFile, access, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite';
const FORCE = process.argv.includes('--force');
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];
const UA = 'little123451.github.io-build/1.0 (+https://little123451.github.io)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ANIM_SLOTS = {
  idle: ['Float', 'Idle'],
  move: ['FlapAround', 'Walk'],
  attack: ['Shoot', 'Attack'],
  hurt: ['Hurt'],
};

async function fetchBuffer(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url} -> ${err.message}`);
    await sleep(400 * attempt);
    return fetchBuffer(url, attempt + 1);
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

function parseAnims(xml) {
  const anims = new Map();
  for (const match of xml.matchAll(/<Anim>([\s\S]*?)<\/Anim>/g)) {
    const body = match[1];
    const name = /<Name>([^<]+)<\/Name>/.exec(body)?.[1];
    if (!name) continue;
    const durations = [...body.matchAll(/<Duration>(\d+)<\/Duration>/g)].map((m) => Number(m[1]));
    anims.set(name, {
      name,
      frameWidth: Number(/<FrameWidth>(\d+)<\/FrameWidth>/.exec(body)?.[1] ?? 0),
      frameHeight: Number(/<FrameHeight>(\d+)<\/FrameHeight>/.exec(body)?.[1] ?? 0),
      copyOf: /<CopyOf>([^<]+)<\/CopyOf>/.exec(body)?.[1] ?? null,
      durations,
    });
  }
  return anims;
}

function resolveAnim(anims, name, depth = 0) {
  const anim = anims.get(name);
  if (!anim) return null;
  if (!anim.copyOf) return anim;
  if (depth > 3) return null;
  return resolveAnim(anims, anim.copyOf, depth + 1);
}

function pngSize(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

function decodeRgba(buffer) {
  const { width, height, colorType } = pngSize(buffer);
  if (colorType !== 6) return null;
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = value & 255;
    }
  }
  return { width, height, data: out };
}

function extractAnchors(offsetsBuffer, frameWidth, frameHeight, frames, rows) {
  const image = offsetsBuffer ? decodeRgba(offsetsBuffer) : null;
  const center = [Math.round(frameWidth / 2), Math.round(frameHeight / 2)];
  const empty = () => Array.from({ length: rows }, () => Array.from({ length: frames }, () => center));
  if (!image) return empty();

  const result = [];
  for (let row = 0; row < rows; row += 1) {
    const rowAnchors = [];
    for (let i = 0; i < frames; i += 1) {
      let best = null;
      let bestScore = -1;
      for (let y = row * frameHeight; y < (row + 1) * frameHeight; y += 1) {
        if (y >= image.height) break;
        for (let x = i * frameWidth; x < (i + 1) * frameWidth; x += 1) {
          if (x >= image.width) break;
          const o = (y * image.width + x) * 4;
          const r = image.data[o];
          const g = image.data[o + 1];
          const b = image.data[o + 2];
          const score = g - r - b;
          if (g > 90 && score > bestScore) {
            bestScore = score;
            best = [x - i * frameWidth, y - row * frameHeight];
          }
        }
      }
      rowAnchors.push(best);
    }
    const fallback = rowAnchors.find(Boolean) || center;
    result.push(rowAnchors.map((anchor) => anchor || fallback));
  }
  return result;
}

const pokedex = JSON.parse(await readFile(join(ROOT, 'data/pokemon.json'), 'utf8'));
const targets = ONLY ? pokedex.filter((entry) => String(entry.id) === ONLY) : pokedex;
const meta = {};
let totalBytes = 0;
let failed = 0;

for (const species of targets) {
  const id = String(species.id).padStart(4, '0');
  let xml;
  try {
    xml = (await fetchBuffer(`${BASE}/${id}/AnimData.xml`)).toString('utf8');
  } catch (err) {
    console.error(`[${species.id}] AnimData missing: ${err.message}`);
    failed += 1;
    continue;
  }
  const anims = parseAnims(xml);
  const slots = {};

  for (const [slot, candidates] of Object.entries(ANIM_SLOTS)) {
    let picked = null;
    for (const candidate of candidates) {
      const resolved = resolveAnim(anims, candidate);
      if (!resolved || resolved.frameWidth <= 0 || resolved.frameHeight <= 0) continue;
      if (!resolved.durations.length) continue;
      picked = resolved;
      break;
    }
    if (!picked) {
      console.warn(`[${species.id}] slot ${slot} missing`);
      continue;
    }

    const fileName = `${picked.name}.png`;
    const outPath = join(ROOT, 'assets/pmd', String(species.id), fileName);
    let strip;
    if (!FORCE && (await exists(outPath))) {
      strip = await readFile(outPath);
    } else {
      strip = await fetchBuffer(`${BASE}/${id}/${picked.name}-Anim.png`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, strip);
    }
    totalBytes += strip.length;

    const size = pngSize(strip);
    const frames = Math.max(1, Math.round(size.width / picked.frameWidth));
    const rows = Math.max(1, Math.round(size.height / picked.frameHeight));
    const offsetsPath = join(ROOT, 'assets/pmd', String(species.id), `${picked.name}-Offsets.png`);
    let offsets = null;
    if (!FORCE && (await exists(offsetsPath))) {
      offsets = await readFile(offsetsPath);
    } else {
      try {
        offsets = await fetchBuffer(`${BASE}/${id}/${picked.name}-Offsets.png`);
        await writeFile(offsetsPath, offsets);
      } catch {
        offsets = null;
      }
    }
    const anchors = extractAnchors(offsets, picked.frameWidth, picked.frameHeight, frames, rows);
    if (offsets) await rm(offsetsPath, { force: true });

    if (frames !== picked.durations.length) {
      console.warn(`[${species.id}] ${picked.name}: frames=${frames} durations=${picked.durations.length}`);
    }

    slots[slot] = {
      name: picked.name,
      src: `assets/pmd/${species.id}/${fileName}`,
      fw: picked.frameWidth,
      fh: picked.frameHeight,
      rows,
      frames,
      durations: picked.durations.map((d) => Math.round((d * 1000) / 60)),
      anchors,
    };
    await sleep(60);
  }

  meta[species.id] = { id: species.id, name: species.name, anims: slots };
  const summary = Object.entries(slots)
    .map(([slot, info]) => `${slot}:${info.name} ${info.fw}x${info.fh}x${info.frames}r${info.rows}`)
    .join(' | ');
  console.log(`[${String(species.id).padStart(3)}] ${summary}`);
}

await mkdir(join(ROOT, 'data'), { recursive: true });
await writeFile(join(ROOT, 'data/pmd.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
console.log(`Wrote data/pmd.json (${Object.keys(meta).length} species, ${(totalBytes / 1024).toFixed(0)} KB strips, failed=${failed})`);
