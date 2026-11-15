// UI 集成测试：用最小 DOM 桩驱动 ui.mjs，检查渲染与交互不抛错
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initDex, sp } from '../js/data.mjs';
import * as L from '../js/logic.mjs';
import * as UI from '../js/ui.mjs';

const dex = JSON.parse(await readFile(fileURLToPath(new URL('../data/dex.json', import.meta.url)), 'utf8'));
initDex(dex);

let failures = 0;
const check = (cond, label, extra = '') => {
  if (!cond) {
    failures++;
    console.log(`FAIL ${label} ${extra}`);
  } else {
    console.log(`ok   ${label} ${extra}`);
  }
};

// ---------- DOM 桩 ----------
const elements = new Map();
function makeEl(sel) {
  if (elements.has(sel)) return elements.get(sel);
  let html = '';
  const el = {
    sel,
    _writes: 0,
    textContent: '',
    className: '',
    style: {},
    dataset: {},
    classList: {
      _s: new Set(['hidden']),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    appendChild() {},
    querySelector() { return makeEl(sel + ' > child'); },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = v;
      el._writes++;
    },
  });
  elements.set(sel, el);
  return el;
}

const handlers = {};
const speedButtons = ['0', '1', '2', '3'].map((s) => {
  const b = makeEl('#speed-' + s);
  b.dataset.speed = s;
  return b;
});

globalThis.document = {
  addEventListener(type, fn) { handlers[type] = fn; },
  querySelector(sel) { return makeEl(sel); },
  querySelectorAll(sel) { return sel === '#speeds button' ? speedButtons : []; },
  getElementById(id) { return makeEl('#' + id); },
};

const click = (act, data = {}) => {
  const target = { dataset: { act, ...data } };
  handlers.click({ target: { closest: () => target } });
};

// ---------- 挂载 ----------
const state = L.newGame(4242);
UI.mount(state, { onSave: () => {}, onReset: () => {} });
check(makeEl('#pens').innerHTML.includes('波波'), '培育栏渲染出波波');
check(makeEl('#pens').innerHTML.includes('烈雀'), '培育栏渲染出烈雀');
check(makeEl('#pens').innerHTML.includes('飞行'), '卡片展示蛋组');
check(makeEl('#orders').innerHTML.includes('🪙'), '订单渲染出报酬');
check(makeEl('#orders').innerHTML.includes('部'), '订单展示需求部门');
check(makeEl('#shop').innerHTML.includes('蛋'), '市场渲染出蛋');
check(makeEl('#upgrades').innerHTML.includes('孵化器'), '设施渲染出孵化器');
check(makeEl('#gold').textContent !== '', '顶栏金币已填充');

// 弹窗
click('open-help');
check(makeEl('#modal').innerHTML.includes('玩法说明'), '玩法弹窗可打开');
click('close');
check(!makeEl('#modal').innerHTML.includes('玩法说明'), '弹窗可关闭');

click('open-dex');
check(makeEl('#modal').innerHTML.includes('图鉴'), '图鉴弹窗可打开');
check(makeEl('#modal').innerHTML.split('dex-cell').length - 1 === 151, '图鉴含 151 个格子');
click('close');

// 购买
const gold0 = state.gold;
click('buy-berries', { qty: '5' });
check(state.berries > 12 && state.gold < gold0, '买树果生效', `(${gold0}→${state.gold})`);

// 宝可梦详情 + 喂食
const starter = state.mons[0];
click('open-mon', { uid: starter.uid });
check(makeEl('#modal').innerHTML.includes('能力值'), '详情弹窗含能力值');
check(makeEl('#modal').innerHTML.includes('进化路线'), '详情弹窗含进化路线');
const lv0 = starter.level;
const exp0 = starter.exp;
const berries0 = state.berries;
click('feed', { uid: starter.uid });
check(state.berries === berries0 - 1 && (starter.level > lv0 || starter.exp > exp0), '喂食生效');

// 交付：构造一个满足订单的高等级宝可梦
const order = state.orders[0];
const mon = L.createMon(state, sp(order.dexId || 16) ? order.dexId || 16 : 16, order.minLevel + 2, { origin: 'test' });
state.mons.push(mon);
const before = state.gold;
click('deliver-open', { order: order.id });
check(makeEl('#modal').innerHTML.includes('选择交付'), '交付弹窗可打开');
click('deliver', { order: order.id, uid: mon.uid });
check(state.gold > before, '交付获得金币', `(${before}→${state.gold})`);

// 市场买蛋
const eggs0 = state.eggs.length;
state.gold += 5000;
if (state.market.length) {
  const idx = 0;
  click('buy-egg', { idx: String(idx) });
  check(state.eggs.length === eggs0 + 1, '买蛋进入孵化器');
}

// 升级设施
const pens0 = state.pens.length;
state.gold += 99999;
click('upgrade', { key: 'pens' });
check(state.pens.length === pens0 + 1, '扩建培育栏');

// 回归：数值变化不应重建 DOM（hover 一直闪烁的根因）
const pensEl = makeEl('#pens');
const ordersEl = makeEl('#orders');
const pensWrites = pensEl._writes;
const ordersWrites = ordersEl._writes;
const expNode = makeEl('#pen-0-a-exp');
const expBefore = expNode.style.width;
for (let i = 0; i < 10; i++) {
  L.tick(state, 0.02);
  UI.render();
}
check(pensEl._writes === pensWrites, '数值变化不重建培育栏 DOM', `(${pensWrites}→${pensEl._writes})`);
check(ordersEl._writes === ordersWrites, '倒计时不重建订单 DOM', `(${ordersWrites}→${ordersEl._writes})`);
check(expNode.style.width !== expBefore, '经验条宽度仍在更新', `${expBefore}→${expNode.style.width}`);

// 连续渲染压力测试
let renderError = null;
try {
  for (let i = 0; i < 200; i++) {
    L.tick(state, 0.1);
    UI.render();
  }
} catch (err) {
  renderError = err;
}
check(!renderError, '连续 200 帧渲染无异常', renderError ? renderError.message : '');

// 事件日志
UI.handleEvents([{ type: 'evolve', msg: '测试进化' }]);
UI.render();
check(makeEl('#log').innerHTML.includes('测试进化'), '日志渲染事件');

// ---------- 实验室流程 ----------
const labMon = L.createMon(state, 16, 8, { origin: 'test' });
state.mons.push(labMon);
UI.render();
check(makeEl('#lab').innerHTML.includes('放入实验对象'), '空实验台渲染');

click('open-lab-picker', { slot: '1' });
check(makeEl('#modal').innerHTML.includes('选择实验对象'), '实验对象选择弹窗');
click('lab-confirm', { slot: '1', uid: labMon.uid });
check(makeEl('#modal').innerHTML.includes('无法取出'), '放入前有不可取出警告');
click('assign-lab', { slot: '1', uid: labMon.uid });
check(L.labContains(state, labMon.uid), '放入实验室成功');
UI.render();
check(makeEl('#lab').innerHTML.includes('实验'), '实验室卡片有实验入口');
check(makeEl('#lab').innerHTML.includes('耐受度'), '实验室卡片显示耐受度');

click('open-exp', { uid: labMon.uid });
const expHtml = makeEl('#modal').innerHTML;
check(expHtml.includes('进行实验'), '实验弹窗可打开');
check(expHtml.includes('基础体测') && expHtml.includes('极限实验'), '实验弹窗列出实验');
check(!expHtml.includes('预计') && !expHtml.includes('进度'), '实验弹窗不展示进度与耐受预估');
check(expHtml.includes('🪙') || expHtml.includes('免费'), '实验弹窗显示资金消耗');

const goldBeforeExp = state.gold;
click('run-exp', { uid: labMon.uid, exp: 'sample' });
check(state.gold === goldBeforeExp - 30, '执行实验扣资金', `(${goldBeforeExp}→${state.gold})`);
check(L.researchProgress(state, 16) > 0, '实验增加物种研究进度');

click('open-mon', { uid: labMon.uid });
check(makeEl('#modal').innerHTML.includes('实验中（无法取出）'), '详情显示实验室状态');
check(!makeEl('#modal').innerHTML.includes('出售'), '实验室宝可梦没有出售按钮');
check(!makeEl('#modal').innerHTML.includes('喂树果'), '实验室宝可梦不能喂食');
click('close');

click('release-mon', { uid: labMon.uid });
check(makeEl('#modal').innerHTML.includes('确认放生'), '放生需要二次确认');
click('confirm-release', { uid: labMon.uid });
check(L.monByUid(state, labMon.uid) === null, '确认后放生');
check(L.researchProgress(state, 16) > 0, '放生后研究进度保留');

click('open-dex');
check(makeEl('#modal').innerHTML.includes('%'), '图鉴显示研究进度');
click('close');

// 胜利界面
UI.handleEvents([{ type: 'win', msg: '图鉴完成！' }]);
check(makeEl('#modal').innerHTML.includes('图鉴完成'), '胜利弹窗可打开');
click('close');
state.won = true;
UI.render();
check(!makeEl('#win-banner').classList.contains('hidden'), '胜利后显示横幅');

console.log(`\n${failures === 0 ? 'UI 测试全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
