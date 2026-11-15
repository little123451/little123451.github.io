// UI 集成测试：用最小 DOM 桩驱动 ui.mjs，检查渲染与交互不抛错
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initDex, initExperiments, sp, DEX } from '../js/data.mjs';
import { CONFIG, RANKS, maxTolerance } from '../js/rules.mjs';
import * as L from '../js/logic.mjs';
import * as UI from '../js/ui.mjs';

const dex = JSON.parse(await readFile(fileURLToPath(new URL('../data/dex.json', import.meta.url)), 'utf8'));
initDex(dex);
const experimentData = JSON.parse(await readFile(fileURLToPath(new URL('../data/experiments.json', import.meta.url)), 'utf8'));
initExperiments(experimentData);

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
    disabled: false,
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
let resetCalls = 0;
let saveCalls = 0;
UI.mount(state, { onSave: () => { saveCalls++; }, onReset: () => { resetCalls++; } });
check(makeEl('#pens').innerHTML.includes('波波'), '培育栏渲染出波波');
check(makeEl('#pens').innerHTML.includes('烈雀'), '培育栏渲染出烈雀');
check(makeEl('#pens').innerHTML.includes('？？？'), '未确认的蛋组显示为 ？？？');
check(!makeEl('#pens').innerHTML.includes('可以配种'), '培育栏不再显示“可以配种”提示');
check(!makeEl('#pens').innerHTML.includes('需要一雄一雌'), '培育栏不再显示性别提示');
check(makeEl('#orders').innerHTML.includes('🪙'), '订单渲染出报酬');
check(makeEl('#orders').innerHTML.includes('部'), '订单展示需求部门');
check(makeEl('#shop').innerHTML.includes('蛋'), '市场渲染出蛋');
check(makeEl('#shop').innerHTML.includes('经验糖果'), '市场售卖经验糖果');
check(makeEl('#shop').innerHTML.includes('蛋组'), '蛋市场显示蛋组');
check(!makeEl('#shop').innerHTML.includes('class="type"'), '蛋市场不再显示属性标签');
check(makeEl('#shop').innerHTML.includes('来源：'), '蛋市场显示来源');
check(!makeEl('#shop').innerHTML.includes('孵化 '), '蛋市场不再显示孵化天数');
check(makeEl('#shop').innerHTML.includes('item-ico'), '进化道具带图标');
check(makeEl('#shop').innerHTML.includes('data/items/fire-stone.png'), '道具图标使用游戏内道具像素图');

// 速度按钮、手动保存、底部 TAB
click('speed', { speed: '2' });
check(UI.getSpeed() === 2, '速度按钮生效');
check(makeEl('#speed-2').classList.contains('on'), '速度按钮高亮');
click('save');
check(saveCalls === 1, '手动保存调用存档钩子');
for (const tab of ['pens', 'lab', 'idle', 'market', 'dex']) {
  click('tab', { tab });
  check(makeEl(`#page-${tab}`).classList.contains('active'), `TAB 切换：${tab}`);
}
click('tab', { tab: 'pens' });
check(makeEl('#shop').innerHTML.includes('🪙'), '道具价格旁有金币图标');
check(makeEl('#upgrades').innerHTML.includes('孵化器'), '设施渲染出孵化器');
check(makeEl('#upgrades').innerHTML.includes('需 助理研究员'), '设施升级显示职级限制');
check(makeEl('#gold').textContent !== '', '顶栏金币已填充');
check(makeEl('#candies').textContent !== '', '顶栏经验糖果已填充');
check(makeEl('#rank').textContent === '见习研究员', '顶栏显示职级', makeEl('#rank').textContent);

// 配对失败记录
state.breedFails = [{ day: 3, a: { dexId: 16, level: 5 }, b: { dexId: 21, level: 5 }, loser: { dexId: 21, level: 5 }, kind: 'fight' }];
click('open-breedlog');
check(makeEl('#modal').innerHTML.includes('配对失败记录'), '可打开配对失败记录');
check(makeEl('#modal').innerHTML.includes('波波') && makeEl('#modal').innerHTML.includes('烈雀'), '失败记录显示配对双方');
check(makeEl('#modal').innerHTML.includes('伤重不治'), '失败记录显示结果');
click('close');
state.breedFails = [];

// 耐受度灰度：满值彩色，越低越灰，≤1 全黑白
const grayMon = state.mons[0];
grayMon.tolerance = Math.round(maxTolerance(grayMon) / 2);
UI.render();
check((makeEl('#pen-0-a-img').style.filter || '').includes('grayscale'), '耐受度下降后精灵变灰');
grayMon.tolerance = 1;
UI.render();
check(makeEl('#pen-0-a-img').style.filter === 'grayscale(1.000)', '耐受度≤1时完全黑白');
grayMon.tolerance = maxTolerance(grayMon);
UI.render();
check(!makeEl('#pen-0-a-img').style.filter, '满耐受度恢复彩色');

// 繁育爱心动画
UI.handleEvents([{ type: 'egg', pen: 0, msg: '配种成功（测试）' }]);
check(makeEl('#pen-0').classList.contains('love'), '繁育成功时培育栏播放爱心动画');
UI.handleEvents([{ type: 'warn', pen: 0, fight: true, msg: '争斗（测试）' }]);
check(makeEl('#pen-0').classList.contains('clash'), '争斗失败时培育栏播放交战动画');
check(!makeEl('#pen-0').classList.contains('love'), '交战动画替换爱心动画');

// 市场：蛋贩子与花钱换货
check(makeEl('#shop').innerHTML.includes('蛋贩子'), '市场由蛋贩子供货');
check(makeEl('#shop').innerHTML.includes('换一批'), '市场提供花钱换货按钮');
const shopGoldBefore = state.gold;
click('reroll-market');
check(state.gold === shopGoldBefore - CONFIG.marketRefreshCost, '市场换货扣钱', `(${shopGoldBefore}→${state.gold})`);
check(makeEl('#shop').innerHTML.includes('来源：'), '换货后仍显示来源');
check(makeEl('#shop').innerHTML.includes('来源：从') || makeEl('#shop').innerHTML.includes('来源：在'), '来源为完整描述');

// 驻守占位
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
check((indexHtml.match(/驻守位/g) || []).length === 4, '围栏页有四个驻守位');
check(indexHtml.includes('暂未启用'), '驻守位暂未启用');
const cssText = await readFile(fileURLToPath(new URL('../css/style.css', import.meta.url)), 'utf8');
check(/\.orders\s*\{[^}]*height:\s*340px/s.test(cssText), '部门需求框体固定高度');
for (const key of ['heartPop', 'clashPop', 'labHit', 'idleFightPulse', 'boardShine']) {
  check(cssText.includes(`@keyframes ${key}`), `动效关键帧存在：${key}`);
}

// 新界面：英雄区 / 图鉴环 / TAB 底栏
check(makeEl('#hero-art-pens').innerHTML.includes('data/sprites/16.png'), '培育页英雄区展示宝可梦');
check(makeEl('#hero-sub-pens').textContent.includes('栏位'), '英雄区副标题展示栏位信息', makeEl('#hero-sub-pens').textContent);
check((makeEl('#dex-ring').style.background || '').includes('conic-gradient'), '图鉴页有进度环');
check(makeEl('#hero-sub-dex').textContent.includes('151'), '图鉴英雄区显示总数');

// 总裁办订单渲染
const boardOrder = {
  id: 'oboard', dept: 'board', kind: 'any', dexId: null, type: null, minLevel: 20, needNature: 0,
  reward: 3000, repGain: 13, repLoss: 10, abandonLoss: 8, deadline: state.day + 6, created: state.day,
};
state.orders.push(boardOrder);
UI.render();
check(makeEl('#orders').innerHTML.includes('总裁办'), '订单显示总裁办');
check(makeEl('#orders').innerHTML.includes('总裁办直令'), '总裁办订单有专属横幅');
check(makeEl('#orders').innerHTML.includes('board-banner'), '总裁办订单使用豪华框体');
check(makeEl('#orders').innerHTML.includes('声望 +13'), '总裁办显示声望增益');
state.orders = state.orders.filter((o) => o.id !== 'oboard');
UI.render();

// 声望闲置流失提示
const repBeforeDecay = state.rep;
const lastTaskBeforeDecay = state.lastTaskDay;
state.rep = 20;
state.lastTaskDay = state.day - 10;
UI.render();
check(!makeEl('#rep-decay').classList.contains('hidden'), '闲置过久显示声望流失提示');
check(makeEl('#rep-decay').textContent.includes('声望'), '声望流失提示包含说明');
state.lastTaskDay = state.day;
UI.render();
check(makeEl('#rep-decay').classList.contains('hidden'), '完成订单后隐藏声望流失提示');
state.rep = repBeforeDecay;
state.lastTaskDay = lastTaskBeforeDecay;
UI.render();

// 围栏：闲置宝可梦
check(makeEl('#idle').innerHTML.includes('围栏是空的'), '围栏初始为空');
const idler = L.createMon(state, 74, 6, { origin: 'test' });
state.mons.push(idler);
UI.render();
check(makeEl('#idle').innerHTML.includes('小拳石'), '围栏显示闲置宝可梦');
check(makeEl('#idle').innerHTML.includes(`data-uid="${idler.uid}"`), '围栏卡片可点击查看');
check(makeEl('#idle-hint').textContent.includes('1'), '围栏数量提示', makeEl('#idle-hint').textContent);
L.assignPen(state, 1, 'a', idler.uid);
UI.render();
check(!makeEl('#idle').innerHTML.includes('小拳石'), '进入培育栏后离开围栏');
L.removeFromPen(state, idler.uid);
UI.render();
check(makeEl('#idle').innerHTML.includes('小拳石'), '移出培育栏后回到围栏');

// 围栏个体详情：不再提供“放入栏位”快捷按钮，改从培育栏空位进入
click('open-mon', { uid: idler.uid });
const idleModal = makeEl('#modal').innerHTML;
check(!idleModal.includes('放入栏位'), '围栏个体详情不再显示放入栏位按钮');
check(!idleModal.includes('data-act="assign"'), '围栏个体详情没有快捷放入操作');
check(idleModal.includes('喂经验糖果'), '围栏个体详情保留喂糖果');
check(idleModal.includes('点培育栏空位'), '围栏个体详情提示从培育栏空位放入');
click('close');

click('open-picker', { pen: '1', slot: 'a' });
check(makeEl('#modal').innerHTML.includes('选择宝可梦'), '培育栏空位仍可打开选择弹窗');
check(makeEl('#modal').innerHTML.includes('data-act="assign"'), '选择弹窗仍能放入栏位');
check(!makeEl('#modal').innerHTML.includes(`data-uid="${state.mons[0].uid}"`), '已在培育栏的个体不出现在选择列表');
click('close');

// 围栏争斗提示：同种同性
const brawlerA = L.createMon(state, 16, 5, { gender: 'm' });
const brawlerB = L.createMon(state, 16, 5, { gender: 'm' });
state.mons.push(brawlerA, brawlerB);
UI.render();
check(!makeEl('#idle-alert').classList.contains('hidden'), '斗殴提示出现');
check(makeEl('#idle-alert').textContent.includes('争斗'), '提示说明正在争斗', makeEl('#idle-alert').textContent);
check(makeEl(`#idle-${brawlerA.uid}`).classList.contains('fighting'), '争斗个体带红边动效标记');
check(makeEl('#idle-hint').textContent.includes('组争斗'), '围栏计数标出争斗组', makeEl('#idle-hint').textContent);
check(!makeEl('#badge-idle').classList.contains('hidden'), '底栏围栏出现争斗红点');
check(Number(makeEl('#badge-idle').textContent) >= 2, '红点统计争斗个体数', makeEl('#badge-idle').textContent);
state.mons = state.mons.filter((m) => m.uid !== brawlerA.uid && m.uid !== brawlerB.uid);
UI.render();
check(makeEl('#idle-alert').classList.contains('hidden'), '争斗解除后提示隐藏');
check(makeEl('#badge-idle').classList.contains('hidden'), '争斗解除后红点消失');

// 弹窗
click('open-help');
check(makeEl('#modal').innerHTML.includes('玩法说明'), '玩法弹窗可打开');
check(makeEl('#modal').innerHTML.includes('经验糖果'), '玩法说明提到经验糖果');
click('close');
check(!makeEl('#modal').innerHTML.includes('玩法说明'), '弹窗可关闭');
click('open-help');
handlers.keydown({ key: 'Escape' });
check(!makeEl('#modal').innerHTML.includes('玩法说明'), 'Escape 可关闭弹窗');

// TAB：图鉴页
check(makeEl('#page-pens').classList.contains('active'), '默认停在培育 TAB');
check(!makeEl('#page-dex').classList.contains('active'), '图鉴页默认隐藏');
click('open-dex');
check(makeEl('#page-dex').classList.contains('active'), '图鉴页可切换显示');
check(!makeEl('#page-pens').classList.contains('active'), '切换后培育页隐藏');
check(makeEl('#dex-page').innerHTML.split('dex-cell').length - 1 === 151, '图鉴含 151 个格子');
check(makeEl('#dex-page').innerHTML.includes('研究记录'), '图鉴含研究记录区');
click('tab', { tab: 'pens' });
check(makeEl('#page-pens').classList.contains('active') && !makeEl('#page-dex').classList.contains('active'), '可以切回培育 TAB');

// 菜单
click('open-menu');
check(makeEl('#modal').innerHTML.includes('玩法说明'), '菜单含玩法入口');
check(makeEl('#modal').innerHTML.includes('保存进度'), '菜单含保存入口');
click('close');

click('open-ranks');
check(makeEl('#modal').innerHTML.includes('见习研究员'), '职级弹窗列出职级');
check(makeEl('#modal').innerHTML.includes('声望需'), '职级弹窗显示声望要求');
click('close');

// 购买
const gold0 = state.gold;
click('buy-candy', { qty: '5' });
check(state.candies > 12 && state.gold < gold0, '买经验糖果生效', `(${gold0}→${state.gold})`);

// 宝可梦详情 + 喂食
const starter = state.mons[0];
click('open-mon', { uid: starter.uid });
check(makeEl('#modal').innerHTML.includes('能力值'), '详情弹窗含能力值');
check(makeEl('#modal').innerHTML.includes('已披露 0/6'), '未研究的物种能力值未披露');
check(!makeEl('#modal').innerHTML.includes('个体值'), '详情弹窗不展示个体值');
check(makeEl('#modal').innerHTML.includes('进化路线'), '详情弹窗含进化路线');
check(makeEl('#modal').innerHTML.includes('移出栏位'), '培育栏个体仍可移出栏位');
const lv0 = starter.level;
const exp0 = starter.exp;
const candies0 = state.candies;
click('feed', { uid: starter.uid });
check(state.candies === candies0 - 1 && (starter.level > lv0 || starter.exp > exp0), '喂经验糖果生效');

// 交付：构造一个满足订单的宝可梦
const order = state.orders[0];
const orderDex =
  order.kind === 'species' && order.dexId
    ? order.dexId
    : order.kind === 'type'
    ? Object.values(DEX.species).find((x) => x.types.includes(order.type))?.id ?? 16
    : 16;
const mon = L.createMon(state, orderDex, order.minLevel + 2, { origin: 'test', nature: order.needNature || undefined });
state.mons.push(mon);
check(L.orderMatches(order, mon), '构造的宝可梦满足订单');
UI.render();
check(makeEl('#badge-market').classList.contains('hidden') === false, '有可交付订单时底栏显示红点');
check(Number(makeEl('#badge-market').textContent) >= 1, '红点数量正确', makeEl('#badge-market').textContent);
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

// 晋升职级 + 升级设施
state.rep = 20;
state.gold += 99999;
click('promote');
check(state.rank === 1, '职级晋升成功', L.currentRank(state).name);
const pens0 = state.pens.length;
click('upgrade', { key: 'pens' });
check(state.pens.length === pens0 + 1, '扩建培育栏');
click('upgrade', { key: 'pens' });
check(state.pens.length === pens0 + 1, '下一级仍被职级锁住');

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
UI.handleEvents([{ type: 'expire', msg: '需求过期：测试订单' }]);
UI.render();
check(makeEl('#log').innerHTML.includes('测试进化'), '日志渲染事件');
check(!makeEl('#log').innerHTML.includes('需求过期'), '过期信息不显示在日志');

// ---------- 实验室流程 ----------
const labMon = L.createMon(state, 16, 8, { origin: 'test' });
state.mons.push(labMon);
UI.render();
check(makeEl('#lab').innerHTML.includes('放入实验对象'), '空实验台渲染');

click('open-lab-picker', { slot: '1' });
check(makeEl('#modal').innerHTML.includes('选择实验对象'), '实验对象选择弹窗');
check(makeEl('#modal').innerHTML.includes('取不出来'), '放入前提示不可取出（不再二次确认）');
click('assign-lab', { slot: '1', uid: labMon.uid });
check(L.labContains(state, labMon.uid), '选中即放入实验室');
UI.render();
check(makeEl('#lab').innerHTML.includes('实验'), '实验室卡片有实验入口');
check(makeEl('#lab').innerHTML.includes('放生'), '实验栏提供真实放生按钮');
check(makeEl('#lab').innerHTML.includes('耐受度'), '实验室卡片显示耐受度');
check(makeEl('#lab-1-tol').textContent.includes('/'), '耐受度显示上限（与等级挂钩）', makeEl('#lab-1-tol').textContent);
check(makeEl('#lab').innerHTML.includes('bar study'), '研究进度条使用独立样式类');
check(!makeEl('#lab').innerHTML.includes('bar egg'), '研究进度条不再套用蛋卡样式');

click('open-exp', { uid: labMon.uid });
const expHtml = makeEl('#modal').innerHTML;
check(expHtml.includes('进行实验'), '实验弹窗可打开');
check(expHtml.includes('基础体测') && expHtml.includes('扬沙观察'), '实验弹窗列出基础与专属实验');
check(!expHtml.includes('预计') && !expHtml.includes('进度'), '实验弹窗不展示进度与耐受预估');
check(expHtml.includes('🪙 15'), '基础体测需要付费（不再免费）');
check(expHtml.includes('🪙') || expHtml.includes('免费'), '实验弹窗显示资金消耗');

const goldBeforeExp = state.gold;
click('run-exp', { uid: labMon.uid, exp: 'sample' });
check(state.gold === goldBeforeExp - 45, '执行实验扣资金', `(${goldBeforeExp}→${state.gold})`);
check(L.researchProgress(state, 16) > 0, '实验增加物种研究进度');
check(makeEl('#modal').classList.contains('hidden'), '实验后收起实验选择框');
check(makeEl('#lab-1').classList.contains('experiment-hit'), '实验对象播放命中反馈动画');
check(Number(makeEl('#lab-1').style['--hit']) > 0, '命中动画带强度参数', makeEl('#lab-1').style['--hit']);
const resBar = makeEl('#lab-1-resbar');
check(resBar.style.width && resBar.style.width !== '0.0%', '研究进度条随实验更新', resBar.style.width);
click('open-exp', { uid: labMon.uid });
UI.render();
check(makeEl('#modal').innerHTML.includes('冷却 10 秒'), '实验弹窗显示冷却时间');
check(makeEl('#exp-run-sample').disabled === true, '冷却中的实验按钮禁用');
L.tick(state, 0.5, 10);
UI.render();
check(makeEl('#exp-run-sample').disabled === false, '冷却结束后按钮恢复可用');

// 研究 100% 后冷却取消
state.research[16] = L.researchRequirement(16);
state.expCd['sp16-stress-threshold'] = 20;
click('open-exp', { uid: labMon.uid });
UI.render();
check(!makeEl('#modal').innerHTML.includes('冷却 20 秒'), '研究满后不显示冷却');
check(makeEl('#exp-run-sp16-stress-threshold').disabled === false, '研究满后遗留冷却不再生效');
check(makeEl('#modal').innerHTML.includes('不再受冷却限制'), '研究满后弹窗提示无冷却');
click('close');

click('open-mon', { uid: labMon.uid });
check(makeEl('#modal').innerHTML.includes('实验中（无法取出）'), '详情显示实验室状态');
check(makeEl('#modal').innerHTML.includes('耐受度'), '详情中的耐受度仅在实验室可见');
check(!makeEl('#modal').innerHTML.includes('出售'), '实验室宝可梦没有出售按钮');
check(!makeEl('#modal').innerHTML.includes('喂经验糖果'), '实验室宝可梦不能喂食');
click('close');

// 放生不再二次确认
click('release-mon', { uid: labMon.uid });
check(L.monByUid(state, labMon.uid) === null, '放生立即生效（无二次确认）');
check(L.researchProgress(state, 16) > 0, '放生后研究进度保留');

click('open-dex');
check(makeEl('#dex-page').innerHTML.includes('%') || makeEl('#dex-page').innerHTML.includes('完成'), '图鉴显示研究进度');
click('tab', { tab: 'pens' });

// 图鉴显示规则：研究中灰度、完成彩色、显示研究损耗
state.research[25] = 13;
state.researchLoss[25] = 2;
UI.render();
check(makeEl('#dex-page').innerHTML.includes('dex-cell partial'), '研究中的物种显示为灰度图鉴');
check(makeEl('#dex-page').innerHTML.includes('皮卡丘'), '研究中显示物种名');
check(makeEl('#dex-page').innerHTML.includes('损2'), '图鉴显示研究损耗数');
check(makeEl('#dex-page').innerHTML.includes('data-act="open-species"'), '研究过的图鉴格子可点开详情');

click('open-species', { id: '25' });
check(makeEl('#modal').innerHTML.includes('图鉴描述'), '物种详情含图鉴描述栏');
check(makeEl('#modal').innerHTML.includes('补上你写下的描述'), '未完成研究时不显示图鉴描述');
check(!makeEl('#modal').innerHTML.includes(sp(25).flavor.slice(0, 8)), '未完成研究时描述文本不泄露');
check(makeEl('#modal').innerHTML.includes('蛋组'), '物种详情含蛋组');
check(makeEl('#modal').innerHTML.includes('种族值'), '物种详情含种族值');
check(makeEl('#modal').innerHTML.includes('已披露 0/6'), '未研究时种族值未披露');
check(makeEl('#modal').innerHTML.includes('？？？'), '未披露的种族值显示问号');
click('close');

state.research[25] = L.researchRequirement(25);
UI.render();
check(makeEl('#dex-page').innerHTML.includes('dex-cell done'), '研究满后转为彩色');
check(!makeEl('#dex-page').innerHTML.includes('dex-cell partial'), '不再出现研究中样式');

state.dex.push(25);
state.dexRecords[25] = { day: 5, experiments: { measure: 2 }, lost: 3 };
UI.render();
check(makeEl('#dex-page').innerHTML.includes('损耗 3 只'), '研究记录显示损耗的个体数');
check(makeEl('#dex-page').innerHTML.includes('累计损耗 3 只'), '研究记录汇总累计损耗');

click('open-species', { id: '25' });
const speciesModal = makeEl('#modal').innerHTML;
check(speciesModal.includes('图鉴描述'), '完成研究后物种详情含图鉴描述');
check(speciesModal.includes(sp(25).flavor.slice(0, 8)), '完成研究后显示图鉴描述文本', sp(25).flavor);
check(speciesModal.includes('研究行为'), '物种详情含研究行为记录');
check(speciesModal.includes('已披露 6/6'), '完成研究后种族值全部披露');
check(speciesModal.includes(`>${sp(25).stats.hp}<`), '物种详情显示已披露的种族值');
click('close');

// 胜利界面
UI.handleEvents([{ type: 'win', msg: '图鉴完成！' }]);
check(makeEl('#modal').innerHTML.includes('图鉴完成'), '胜利弹窗可打开');
click('close');
state.won = true;
UI.render();
check(!makeEl('#win-banner').classList.contains('hidden'), '胜利后显示横幅');

// 传说研究胜利：文案与横幅区分
state.winKind = 'legendary';
state.rank = RANKS.length - 1;
UI.render();
check(makeEl('#win-banner').textContent.includes('传说'), '传说胜利横幅有独立文案');
UI.handleEvents([{ type: 'win', msg: '传说研究完成' }]);
check(makeEl('#modal').innerHTML.includes('传说研究完成'), '传说胜利弹窗有独立标题');
click('close');

// ---------- 认输 ----------
click('quit');
check(makeEl('#modal').innerHTML.includes('离开火箭队'), '认输弹窗可打开');
check(makeEl('#modal').innerHTML.includes('认输'), '认输弹窗说明这是认输');
click('confirm-quit');
check(state.quit === true, '确认后本局结束');
check(makeEl('#modal').innerHTML.includes('重新入职'), '结算面板提供重新入职');
UI.render();
check(!makeEl('#quit-banner').classList.contains('hidden'), '认输后显示横幅');
click('open-menu');
check(makeEl('#modal').innerHTML.includes('本局已结束'), '认输后菜单显示已结束');
click('close');
click('quit');
check(makeEl('#modal').innerHTML.includes('重新入职'), '认输后可随时打开结算面板');
const dayAfterQuit = state.day;
L.tick(state, 3);
check(state.day === dayAfterQuit, '认输后时间不再推进');

click('new-game');
check(resetCalls === 1, '重新入职触发重开');
check(makeEl('#modal').innerHTML === '', '重新入职后弹窗关闭');

// setState（主循环重开）清空旧日志与弹窗
UI.pushLog('测试日志', 'info');
click('open-help');
UI.setState(L.newGame(999));
check(makeEl('#modal').innerHTML === '' && makeEl('#modal').classList.contains('hidden'), 'setState 清空并关闭弹窗');
check(!makeEl('#log').innerHTML.includes('测试日志'), 'setState 清空旧日志');

console.log(`\n${failures === 0 ? 'UI 测试全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
