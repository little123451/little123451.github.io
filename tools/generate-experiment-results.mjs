// 生成每条实验行为的独立结果池：40 条生还 + 10 条死亡（4:1）。
// 结果文本含实验名，因此每条行为的 50 条结果都是独立字符串。
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'D:/deepseek/little123451.github.io';
const dex = JSON.parse(readFileSync(`${root}/data/dex.json`, 'utf8')).species;
const custom = JSON.parse(readFileSync(`${root}/data/experiments.json`, 'utf8')).species;

const base = [
  { id: 'measure', name: '基础体测', tone: 'gentle' },
  { id: 'sample', name: '组织采样', tone: 'standard' },
  { id: 'battle', name: '对战测试', tone: 'harsh' },
];

const survival = {
  gentle: [
    '「{exp}」结束后，它还活着，只是{after}。',
    '记录完「{exp}」时，它没有断气，但{after}。',
    '它撑过了「{exp}」，{after}。',
    '「{exp}」停止后，它趴了很久才抬起头，{after}。',
    '「{exp}」留下了数据，也留下一具还在喘气的身体——{after}。',
    '它从「{exp}」里活着出来，{after}。',
    '「{exp}」收尾时，研究员收起工具，它还有呼吸，但{after}。',
    '「{exp}」完成后，它勉强睁着眼，{after}。',
  ],
  standard: [
    '「{exp}」结束后，它还没死，但{after}。',
    '记录完「{exp}」时，它瘫在台上，{after}。',
    '它硬撑过了「{exp}」，{after}。',
    '「{exp}」停止后，它连惨叫的力气都没有，{after}。',
    '「{exp}」的数据留下了，它自己只剩下半条命——{after}。',
    '它从「{exp}」里活着出来，{after}。',
    '「{exp}」收尾时，研究员按住它，它还在发抖，{after}。',
    '「{exp}」完成后，它没有断气，但{after}。',
  ],
  harsh: [
    '「{exp}」结束后，它还没死，但{after}。',
    '记录完「{exp}」时，它瘫在血泊里，{after}。',
    '它硬撑过了「{exp}」，{after}。',
    '「{exp}」停止后，它连惨叫的力气都没有，{after}。',
    '「{exp}」的数据留下了，它自己只剩下半条命——{after}。',
    '它从「{exp}」里活着出来，{after}。',
    '「{exp}」收尾时，研究员按住它，它还在抽搐，{after}。',
    '「{exp}」完成后，它没有断气，但{after}。',
  ],
};

const aftermath = {
  gentle: ['身上多了几道伤', '疼得直发抖', '呼吸又浅又急', '半天站不起来', '缩成一团，谁碰都躲'],
  standard: ['伤口还在渗血', '四肢抽搐，站不起来', '疼得连叫声都哑了', '精神恍惚，眼神很久才聚焦', '被折腾到脱水，连头都抬不起来'],
  harsh: ['皮肉翻卷，血止不住', '骨头发出不正常的响声', '疼得昏过去又醒过来', '身体一阵阵痉挛，呼吸微弱', '留下大片淤伤，连动一下都困难'],
};

const death = [
  '「{exp}」进行到一半，它的呼吸就停了。',
  '它没能撑过「{exp}」，最后一点耐受度耗尽。',
  '「{exp}」结束时，它已经没有了反应。',
  '「{exp}」记录到一半，它的身体彻底软了下去。',
  '「{exp}」的代价是它的命。',
  '它死在「{exp}」的台上，眼睛一直没有闭上。',
  '「{exp}」后，研究员只来得及记下死亡时间。',
  '它试图撑过「{exp}」，但最终断了气。',
  '「{exp}」没有留下活口，只有一具遗体。',
  '「{exp}」结束后，它的耐受度归零，再没有醒来。',
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

const out = {};
const all = [
  ...base.map((e) => ({ id: e.id, name: e.name, tone: e.tone })),
  ...Object.values(custom).flatMap((entry) =>
    entry.experiments.map((e) => ({ id: e.id, name: e.name, tone: e.tier }))
  ),
];

for (const e of all) {
  const tone = survival[e.tone] ? e.tone : 'standard';
  const after = aftermath[tone];
  const surv = [];
  for (const t of survival[tone]) for (const a of after) surv.push(t.replace('{exp}', e.name).replace('{after}', a));
  const dead = death.map((t) => t.replace('{exp}', e.name));
  out[e.id] = { survive: shuffle(surv, h(e.id)), death: shuffle(dead, h(e.id) ^ 0x9e3779b9) };
}

writeFileSync(`${root}/data/experiment-results.json`, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('generated', Object.keys(out).length, 'behaviors,', Object.keys(out).length * 50, 'results');
