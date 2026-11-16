// 生成每条实验行为的独立结果池：40 条生还 + 10 条死亡（4:1）。
// 结果不引用实验名，使用 80–130 字叙事；行为描述只用于生成过程性开场。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_EXPERIMENTS } from '../js/rules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const custom = JSON.parse(readFileSync(`${root}/data/experiments.json`, 'utf8')).species;

const BASE_TONES = { measure: 'gentle', sample: 'standard', battle: 'harsh' };
const base = BASE_EXPERIMENTS.map((e) => ({ ...e, tone: BASE_TONES[e.id] || 'standard' }));

const actionOf = (desc, name) => {
  let first = desc.replace(/。$/, '').split(/[，；]/)[0].replace(/^在/, '');
  if (name && first.includes(name)) first = '这一轮操作';
  if ([...first].length > 18) first = [...first].slice(0, 18).join('');
  return first;
};

const survivalTemplates = [
  '在{act}之后，它没有立刻倒下，只是蜷在台边，{after}。研究员把这一轮数据记下时，它的呼吸仍然又浅又乱，连抬头的力气都没有。',
  '在{act}之后，它还活着。它试着抬头，却只发出一点沙哑的气音；{after}。台面上的血迹被草草擦去，记录继续，没人多看它一眼。',
  '在{act}之后，它撑了过来。实验停止后，它趴了很久才勉强撑起身子，{after}。旁边的仪器还在滴答作响，下一轮记录已经开始。',
  '在{act}之后，研究员松开固定带。它没有逃跑，只是{after}，身体还在发抖。这一轮数据被留下，代价也留下，它被拖回了角落的笼子。',
  '在{act}之后，它又醒了一次。伤口还在渗血，它{after}。没人给它处理，只把新的观察写进表里，然后关掉了台灯。',
  '在{act}之后，它活着，但只剩半条命。它{after}，被拖回笼子时爪子在台面上刮出很轻的声响。记录员没有回头。',
  '在{act}之后，它还在呼吸，眼睛半天没有聚焦。它{after}。研究员看了它一眼，继续整理记录，把它的挣扎写进观察栏。',
  '在{act}之后，实验台上只剩它粗重的喘息。它{after}，却还是撑着没有断气。这一轮记录到此为止，下一轮要等它缓过来。',
];

const deathTemplates = [
  '在{act}之后，它的呼吸突然停了。研究员探了探鼻息，又翻开眼皮看了看，最后只来得及在记录表上写下死亡时间，旁边的人还在补最后一组数据。',
  '在{act}之后，它没有再动。最后一轮数据刚记到一半，实验台就安静了下来。研究员叫了它两声，没有回应，才把记录本合上。',
  '它没能撑过这轮实验。在{act}之后，它的身体彻底软下去，眼睛一直睁着。有人伸手替它合上眼皮，另一只手还在写最后的观察结果。',
  '在{act}之后，它开始抽搐，随后断了气。旁边的人没有停手，直到记录写完才把工具放下。实验台上只剩一股淡淡的焦味。',
  '这轮实验的代价是它的命。在{act}之后，它倒在台边，再也没有醒来。记录员把它的编号圈了起来，标注为“损耗”。',
  '在{act}之后，研究者发现它已经没有了脉搏。遗体被推到角落，等着之后处理；记录本上多了一行潦草的死亡说明。',
  '它试图撑到最后，但在{act}之后还是断了气。记录本上只剩下一个死亡时间，和一句没有写完的观察笔记。',
  '在{act}之后，它的胸口不再起伏。实验结束了，台上只剩一具还温着的尸体。有人拿来白布，有人继续整理数据。',
  '它没能走下实验台。在{act}之后，它的身体彻底松弛，呼吸停在半途。台边的计时器还在走，记录员伸手把它按停。',
  '在{act}之后，它发出一声很轻的呜咽，然后没了声息。数据留下了，命没有；它的编号被划掉，实验台上换了新的固定带。',
];

const aftermath = {
  gentle: [
    '身上多了几道伤，连站都站不稳',
    '疼得直发抖，半天没有动',
    '呼吸又浅又急，眼神也没了焦点',
    '缩成一团，谁靠近都躲',
    '趴在台边，身体还在轻轻抽搐',
  ],
  standard: [
    '伤口还在渗血，身体一阵阵抽搐',
    '疼得连叫声都哑了，只能张着嘴喘',
    '精神恍惚，眼睛很久才重新聚焦',
    '被折腾到脱水，连头都抬不起来',
    '身上留下大片淤伤，呼吸又急又乱',
  ],
  harsh: [
    '皮肉翻卷，血止不住地往下滴',
    '骨头发出不正常的响声，动一下就痉挛',
    '疼得昏过去又醒过来，意识已经散了',
    '身体一阵阵痉挛，呼吸微弱得几乎听不见',
    '留下大片淤伤，连抬一下爪子都困难',
  ],
};

const survivalTails = [
  '记录员把笔尖停在半空，过了几秒才继续写。',
  '没人给它水，也没人解开它脚边的束缚。',
  '它的编号被写在表格边缘，旁边画了一个小小的叉。',
  '下一轮实验的工具已经摆好，没人问它还能不能撑住。',
  '台灯照在它背上，伤口边缘还在慢慢抽动。',
  '笼门合上时，它没有回头，也没有再发出声音。',
  '记录员写下“可恢复”，笔迹比刚才轻了一点。',
  '外面的人催了一声，实验员才把固定带解开。',
];

const deathTails = [
  '记录表上的墨迹被台面的水汽晕开。',
  '墙上的钟还在走，秒针声显得格外清楚。',
  '有人低声报出编号，然后把它从名单上划掉。',
  '消毒水的气味盖不住血腥味，窗户一直关着。',
  '外面的走廊传来下一批实验对象的脚步声。',
  '窗外的天色暗了一格。',
  '实验员把钢笔帽扣上，停顿了几秒才起身。',
  '推车的轮子压过地面，发出很轻的响动。',
  '红灯闪了两下，随后彻底熄灭。',
  '有人把遗体编号写错，又划掉重写了一遍。',
];

const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
const shuffle = (arr, seed) => {
  const out = [...arr];
  let x = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const len = (s) => [...s].length;
const neutralBody = (s) => s.replace(/四肢|后腿|前肢/g, '身体');
const fit = (text, tail, backup) => {
  let out = neutralBody(text);
  if (len(out) < 80) out += ' ' + tail;
  if (len(out) < 80) out += ' ' + backup;
  if (len(out) > 130) out = [...out].slice(0, 129).join('') + '。';
  return out;
};

const out = {};
const all = [
  ...base,
  ...Object.values(custom).flatMap((entry) =>
    entry.experiments.map((e) => ({ id: e.id, name: e.name, desc: e.desc, tone: e.tier }))
  ),
];

for (const e of all) {
  const tone = aftermath[e.tone] ? e.tone : 'standard';
  const act = actionOf(e.desc, e.name);
  const surv = [];
  for (const [ti, t] of survivalTemplates.entries()) {
    for (const a of aftermath[tone]) {
      surv.push(fit(t.replace('{act}', act).replace('{after}', a), survivalTails[ti], survivalTails[(ti + 1) % survivalTails.length]));
    }
  }
  const dead = deathTemplates.map((t, ti) => fit(t.replace('{act}', act), deathTails[ti], deathTails[(ti + 1) % deathTails.length]));
  out[e.id] = { survive: shuffle(surv, h(e.id)), death: shuffle(dead, h(e.id) ^ 0x9e3779b9) };
}

for (const [id, pool] of Object.entries(out)) {
  for (const text of [...pool.survive, ...pool.death]) {
    if (len(text) < 80 || len(text) > 130) throw new Error(`${id} length ${len(text)}: ${text}`);
  }
  if (pool.survive.length !== 40 || pool.death.length !== 10) throw new Error(`${id} pool size`);
  if (new Set(pool.survive).size !== 40 || new Set(pool.death).size !== 10) throw new Error(`${id} duplicate`);
}

const resultsDir = `${root}/data/results`;
mkdirSync(resultsDir, { recursive: true });
const baseOut = {};
for (const e of base) baseOut[e.id] = out[e.id];
writeFileSync(`${resultsDir}/base.json`, JSON.stringify(baseOut, null, 2) + '\n', 'utf8');
for (const [id, entry] of Object.entries(custom)) {
  const bundle = {};
  for (const e of entry.experiments) bundle[e.id] = out[e.id];
  writeFileSync(`${resultsDir}/${id}.json`, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
}
if (existsSync(`${root}/data/experiment-results.json`)) rmSync(`${root}/data/experiment-results.json`);
console.log('generated', Object.keys(out).length, 'behaviors,', Object.keys(out).length * 50, 'results; base +', Object.keys(custom).length, 'species files');
