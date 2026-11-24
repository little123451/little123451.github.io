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
UI.setExperimentLoading(false);
check(makeEl('#pens').innerHTML.includes('波波'), '培育栏渲染出波波');
check(makeEl('#pens').innerHTML.includes('烈雀'), '培育栏渲染出烈雀');
check(!makeEl('#pens').innerHTML.includes('？？？'), '培育栏卡片不再显示蛋组（已移入选择器）');
check(!makeEl('#pens').innerHTML.includes('class="type"'), '培育栏卡片不再显示属性徽章');
check(!makeEl('#pens').innerHTML.includes('bar exp'), '培育栏卡片不再显示经验条');
check(!makeEl('#pens').innerHTML.includes('可以配种'), '培育栏不再显示“可以配种”提示');
check(!makeEl('#pens').innerHTML.includes('需要一雄一雌'), '培育栏不再显示性别提示');
check(makeEl('#orders').innerHTML.includes('🪙'), '订单渲染出报酬');
check(makeEl('#orders').innerHTML.includes('class="dept'), '订单展示需求部门');
check(makeEl('#shop').innerHTML.includes('蛋'), '市场渲染出蛋');
check(makeEl('#shop').innerHTML.includes('经验糖果'), '市场售卖经验糖果');
check(makeEl('#shop').innerHTML.includes('蛋组'), '蛋市场显示蛋组');
check(!makeEl('#shop').innerHTML.includes('class="type"'), '蛋市场不再显示属性标签');
check(makeEl('#shop').innerHTML.includes('来源：'), '蛋市场显示来源');
check(!makeEl('#shop').innerHTML.includes('孵化 '), '蛋市场不再显示孵化天数');
check(makeEl('#shop').innerHTML.includes('item-ico'), '进化道具带图标');
check(makeEl('#shop').innerHTML.includes('data/items/fire-stone.png'), '道具图标使用游戏内道具像素图');

// 闪光 / 不孕标记
const specialMon = L.createMon(state, 16, 5, { gender: 'f', shiny: true, sterile: true });
state.mons.push(specialMon);
L.assignPen(state, 2, 'a', specialMon.uid);
UI.render();
check(makeEl('#pens').innerHTML.includes('shiny'), '闪光个体卡片带闪光样式');
check(makeEl('#pens').innerHTML.includes('data/sprites/shiny/16.png'), '闪光个体使用本地闪光贴图');
check(makeEl('#pens').innerHTML.includes('✨'), '闪光个体显示闪光标记');
check(makeEl('#pens').innerHTML.includes('不孕'), '不孕个体显示不孕标记');
check(makeEl('#pens').innerHTML.includes(`#${String(specialMon.no).padStart(4, '0')}`), '培育栏卡片显示个体编号');
const normalMale = L.createMon(state, 16, 5, { gender: 'm' });
state.mons.push(normalMale);
L.assignPen(state, 2, 'b', normalMale.uid);
UI.render();
check(makeEl('#pen-2-warn').textContent.includes('不孕') && makeEl('#pen-2-warn').textContent.includes('无法配种'), '不孕配对显示提示');
L.removeFromPen(state, normalMale.uid);
state.mons = state.mons.filter((m) => m.uid !== normalMale.uid);
click('open-mon', { uid: specialMon.uid });
check(makeEl('#modal').innerHTML.includes('闪光'), '详情显示闪光');
check(makeEl('#modal').innerHTML.includes('生育') && makeEl('#modal').innerHTML.includes('不孕'), '详情显示不孕');
click('close');
L.removeFromPen(state, specialMon.uid);
state.mons = state.mons.filter((m) => m.uid !== specialMon.uid);
UI.render();

// 选择伙伴时同性不列出（不是禁用）
const pairA = L.createMon(state, 16, 5, { gender: 'f' });
const pairB = L.createMon(state, 21, 5, { gender: 'm' });
const pairC = L.createMon(state, 19, 5, { gender: 'f' });
state.mons.push(pairA, pairB, pairC);
L.assignPen(state, 2, 'a', pairA.uid);
UI.render();
click('open-picker', { pen: '2', slot: 'b' });
const genderPickHtml = makeEl('#modal').innerHTML;
check(genderPickHtml.includes(`data-uid="${pairB.uid}"`), '异性伙伴正常列出');
check(!genderPickHtml.includes(`data-uid="${pairC.uid}"`), '同性伙伴不出现在选择器里');
click('close');
L.removeFromPen(state, pairA.uid);
state.mons = state.mons.filter((m) => m.uid !== pairA.uid && m.uid !== pairB.uid && m.uid !== pairC.uid);
UI.render();

// 速度按钮、手动保存、底部 TAB
click('speed', { speed: '2' });
check(UI.getSpeed() === 2, '速度按钮生效');
check(makeEl('#speed-2').classList.contains('on'), '速度按钮高亮');
click('save');
check(saveCalls === 1, '手动保存调用存档钩子');
for (const tab of ['pens', 'lab', 'idle', 'market', 'dex']) {
  click('tab', { tab });
  check(makeEl(`#page-${tab}`).classList.contains('active'), `TAB 切换：${tab}`);
  if (tab === 'lab') check(UI.getSpeed() === 2, '切到实验室不再暂停');
  if (tab === 'idle') check(UI.getSpeed() === 2, '离开实验室保持速度');
  if (tab === 'dex') check(UI.getSpeed() === 0, '切到研究笔记自动暂停');
}
click('tab', { tab: 'pens' });
check(UI.getSpeed() === 2, '离开研究笔记恢复速度');
check(makeEl('#shop').innerHTML.includes('🪙'), '道具价格旁有金币图标');
check(makeEl('#upgrades').innerHTML.includes('孵化器'), '设施渲染出孵化器');
check(makeEl('#upgrades').innerHTML.includes('需 助理研究员'), '设施升级显示职级限制');
// 首次升级必须标价：四个 0 级起的设施曾因价格表多一个前置 0 而白送
check(makeEl('#upgrades').innerHTML.includes('升级 🪙 1,200'), '孵化器首次升级标价 1,200');
check(!makeEl('#upgrades').innerHTML.includes('>升级 🪙 0<'), '设施升级不再出现免费价格');
check(makeEl('#gold').textContent !== '', '顶栏金币已填充');
check(makeEl('#candies').textContent !== '', '顶栏经验糖果已填充');
check(makeEl('#rank').textContent === '见习研究员', '顶栏显示职级', makeEl('#rank').textContent);

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
check(makeEl('#toast').textContent !== '配种成功（测试）', '产蛋不再弹 toast');
UI.handleEvents([{ type: 'warn', pen: 0, exhausted: true, msg: '力竭（测试）' }]);
check(makeEl('#pen-0').classList.contains('clash'), '力竭时培育栏播放倒地动画');
check(makeEl('#toast').textContent === '力竭（测试）', '力竭仍然弹 toast');
check(!makeEl('#pen-0').classList.contains('love'), '交战动画替换爱心动画');
UI.handleEvents([{ type: 'evolve', msg: '测试进化' }]);
check(makeEl('#toast').textContent !== '测试进化', '进化不再弹 toast');

// 蛋贩子与花钱换货
check(makeEl('#shop').innerHTML.includes('换一批'), '蛋贩子提供花钱换货按钮');
const shopGoldBefore = state.gold;
const rerollCost = L.marketRerollCost(state);
click('reroll-market');
check(state.gold === shopGoldBefore - rerollCost, '换货扣钱', `(${shopGoldBefore}→${state.gold})`);
check(L.marketRerollCost(state) > rerollCost, '换货后下一次费用上涨');
check(makeEl('#shop').innerHTML.includes('来源：'), '换货后仍显示来源');
check(makeEl('#shop').innerHTML.includes('来源：从') || makeEl('#shop').innerHTML.includes('来源：在'), '来源为完整描述');
check(makeEl('#shop').innerHTML.includes(`🪙 ${L.marketRerollCost(state)}`), '换货按钮显示新的递增费用');
const indexHtml = await readFile(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
check(indexHtml.includes('<h3>蛋贩子</h3>'), '经营栏标题改为蛋贩子');
check((indexHtml.match(/驻守位/g) || []).length === 4, '围栏页有四个驻守位');
check(indexHtml.includes('暂未启用'), '驻守位暂未启用');
const cssText = await readFile(fileURLToPath(new URL('../css/style.css', import.meta.url)), 'utf8');
check(/\.orders\s*\{[^}]*height:\s*340px/s.test(cssText), '部门需求框体固定高度');
check(/\.tabbar\s*\{[^}]*position:\s*fixed/s.test(cssText), '底部栏固定到视口');
check(/\.tabbar\s*\{[^}]*max-width:\s*760px/s.test(cssText), '底部栏与主容器同宽');
check(/body\s*\{[^}]*overflow:\s*hidden/s.test(cssText), '页面自身不产生滚动，内容区独立滚动');
for (const key of ['heartPop', 'clashPop', 'labHit', 'idleFightPulse', 'boardShine']) {
  check(cssText.includes(`@keyframes ${key}`), `动效关键帧存在：${key}`);
}

// 新界面：英雄区 / 研究笔记环 / TAB 底栏
check(makeEl('#hero-art-pens').innerHTML.includes('data/sprites/16.png'), '培育页英雄区展示宝可梦');
check(makeEl('#hero-sub-pens').textContent.includes('栏位'), '英雄区副标题展示栏位信息', makeEl('#hero-sub-pens').textContent);
check((makeEl('#dex-ring').style.background || '').includes('conic-gradient'), '研究笔记页有进度环');
check(makeEl('#hero-sub-dex').textContent.includes('151'), '研究笔记英雄区显示总数');

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
check(L.idleMons(state).length === 1, '围栏初始只有开局第三只');
check(makeEl('#idle').innerHTML.includes('烈雀'), '围栏显示开局的第三只');
const idler = L.createMon(state, 74, 6, { origin: 'test' });
state.mons.push(idler);
UI.render();
check(makeEl('#idle').innerHTML.includes('小拳石'), '围栏显示闲置宝可梦');
check(makeEl('#idle').innerHTML.includes(`data-uid="${idler.uid}"`), '围栏卡片可点击查看');
check(idler.no == null, '围栏出生个体尚未编号');
check(makeEl('#idle-hint').textContent.includes(String(L.idleMons(state).length)), '围栏数量提示', makeEl('#idle-hint').textContent);
L.assignPen(state, 1, 'a', idler.uid);
UI.render();
check(idler.no > 0 && makeEl('#pens').innerHTML.includes(`#${String(idler.no).padStart(4, '0')}`), '进入培育栏后分配并显示编号');
check(!makeEl('#idle').innerHTML.includes('小拳石'), '进入培育栏后离开围栏');
L.removeFromPen(state, idler.uid);
UI.render();
check(makeEl('#idle').innerHTML.includes('小拳石'), '移出培育栏后回到围栏');

// 培育栏详情点“移出栏位”后直接收起，不再展示详情
L.assignPen(state, 1, 'a', idler.uid);
UI.render();
click('open-mon', { uid: idler.uid });
click('unassign', { uid: idler.uid });
check(L.penIndex(state, idler.uid) === -1, '移出栏位生效');
check(makeEl('#modal').innerHTML === '', '移出栏位后直接收起详情');
UI.render();
check(makeEl('#idle').innerHTML.includes('小拳石'), '移出后回到围栏');

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
// 弹窗正文必须包在 .modal-body 里：滚动区在这一层，标题才能固定、内容再长也能滑
check(makeEl('#modal').innerHTML.includes('class="modal-body"'), '弹窗正文包在独立滚动区里');
check(!makeEl('#modal').innerHTML.includes('空闲'), '栏位选择列表不显示空闲状态');
check(makeEl('#modal').innerHTML.includes('data-act="assign"'), '选择弹窗仍能放入栏位');
check(!makeEl('#modal').innerHTML.includes(`data-uid="${state.mons[0].uid}"`), '已在培育栏的个体不出现在选择列表');
click('close');

// 围栏霸凌提示：同种同性达到 4 只
const brawlerA = L.createMon(state, 16, 1, { gender: 'm' });
const brawlerB = L.createMon(state, 16, 5, { gender: 'm' });
const brawlerC = L.createMon(state, 16, 5, { gender: 'm' });
const brawlerD = L.createMon(state, 16, 5, { gender: 'm' });
state.mons.push(brawlerA, brawlerB, brawlerC, brawlerD);
UI.render();
check(!makeEl('#idle-alert').classList.contains('hidden'), '霸凌提示出现');
check(makeEl('#idle-alert').textContent.includes('霸凌'), '提示说明正在霸凌', makeEl('#idle-alert').textContent);
check(makeEl(`#idle-${brawlerA.uid}`).classList.contains('fighting'), '最弱个体带红边动效标记');
check(!makeEl(`#idle-${brawlerB.uid}`).classList.contains('fighting'), '非最弱个体不标记');
check(makeEl('#idle-hint').textContent.includes('组霸凌'), '围栏计数标出霸凌组', makeEl('#idle-hint').textContent);
check(!makeEl('#badge-idle').classList.contains('hidden'), '底栏围栏出现霸凌红点');
check(makeEl('#badge-idle').textContent === '1', '红点统计被霸凌个体数', makeEl('#badge-idle').textContent);
state.mons = state.mons.filter((m) => ![brawlerA.uid, brawlerB.uid, brawlerC.uid, brawlerD.uid].includes(m.uid));
UI.render();
check(makeEl('#idle-alert').classList.contains('hidden'), '霸凌解除后提示隐藏');
check(makeEl('#badge-idle').classList.contains('hidden'), '霸凌解除后红点消失');

// 围栏遗体处理
state.idleCorpses = [{ dexId: 16, no: 999, level: 5, gender: 'm', day: 3, cause: 'bully' }];
state.gold = 100;
UI.render();
check(makeEl('#idle').innerHTML.includes('已死亡') && makeEl('#idle').innerHTML.includes('处理'), '围栏显示霸凌遗体与处理按钮');
const idleGold = state.gold;
click('process-idle-corpse', { index: '0' });
check(state.idleCorpses.length === 0, '围栏遗体处理后移除');
check(state.gold === idleGold - CONFIG.idleCorpseProcessCost, '围栏遗体处理扣费');
UI.render();

// 弹窗
click('open-help');
check(makeEl('#modal').innerHTML.includes('玩法说明'), '玩法弹窗可打开');
check(makeEl('#modal').innerHTML.includes('经验糖果'), '玩法说明提到经验糖果');
check(makeEl('#modal').innerHTML.includes('畸形体'), '玩法说明包含畸形体');
check(makeEl('#modal').innerHTML.includes('畸体'), '玩法说明提到围栏畸体段');
check(!makeEl('#modal').innerHTML.includes('争斗'), '玩法说明不再提已移除的争斗');
click('close');
check(!makeEl('#modal').innerHTML.includes('玩法说明'), '弹窗可关闭');
click('open-help');
handlers.keydown({ key: 'Escape' });
check(!makeEl('#modal').innerHTML.includes('玩法说明'), 'Escape 可关闭弹窗');

// TAB：研究笔记页
check(makeEl('#page-pens').classList.contains('active'), '默认停在培育 TAB');
check(!makeEl('#page-dex').classList.contains('active'), '研究笔记页默认隐藏');
click('open-dex');
check(makeEl('#page-dex').classList.contains('active'), '研究笔记页可切换显示');
check(!makeEl('#page-pens').classList.contains('active'), '切换后培育页隐藏');
check(makeEl('#dex-page').innerHTML.split('dex-cell').length - 1 === 151, '研究笔记含 151 个格子');
check(makeEl('#dex-page').innerHTML.includes('实验总成本') && makeEl('#dex-page').innerHTML.includes('累计损耗'), '研究笔记顶部显示成本与损耗');
check(!makeEl('#dex-page').innerHTML.includes('研究记录') && !makeEl('#dex-page').innerHTML.includes('实验日志'), '研究笔记底部不再显示元信息');
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
check(!makeEl('#modal').innerHTML.includes('特性'), '详情弹窗暂不展示特性');
check(makeEl('#modal').innerHTML.includes('能力值') && !makeEl('#modal').innerHTML.includes('已披露'), '能力值不再显示披露数量');
check(!makeEl('#modal').innerHTML.includes('个体值'), '详情弹窗不展示个体值');
check(makeEl('#modal').innerHTML.includes('进化路线'), '详情弹窗含进化路线');
check(makeEl('#modal').innerHTML.includes('扔回围栏'), '培育栏个体可扔回围栏');
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
check(!makeEl('#page-pens').innerHTML.includes('data-act="add-pen"'), '培育栏不再提供扩建按钮');
click('upgrade', { key: 'pens' });
check(state.pens.length === pens0 + 1, '运营页升级培育栏');
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
check(!makeEl('#pen-0-a').innerHTML.includes('bar exp'), '培育栏卡片不再有经验条');

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
check(makeEl('#lab').innerHTML.includes(`#${String(labMon.no).padStart(4, '0')}`), '实验室卡片显示个体编号');
check(makeEl('#lab').innerHTML.includes('处理'), '实验栏提供付费处理按钮');
check(makeEl('#lab').innerHTML.includes('耐受度'), '实验室卡片显示耐受度');
check(makeEl('#lab-1-tol').textContent.includes('/'), '耐受度显示上限（与等级挂钩）', makeEl('#lab-1-tol').textContent);
check(makeEl('#lab').innerHTML.includes('bar study'), '研究进度条使用独立样式类');
check(!makeEl('#lab').innerHTML.includes('bar egg'), '研究进度条不再套用蛋卡样式');

click('open-exp', { uid: labMon.uid });
const expHtml = makeEl('#modal').innerHTML;
check(expHtml.includes('进行实验'), '实验弹窗可打开');
check(!expHtml.includes('正在调取实验记录'), '打开实验不再加载结果文案');
check(expHtml.includes('基础体测') && expHtml.includes('扬沙观察'), '实验弹窗列出基础与专属实验');
check(!expHtml.includes('预计'), '实验弹窗不展示耐受预估');
check(expHtml.includes('研究进度') && !expHtml.includes('已记录 0/') && !expHtml.includes('还差'), '实验弹窗不再显示行为记录进度');
check(!expHtml.includes('exp-row-sample recorded'), '未执行行为不带已记录样式');
const sampleDesc = L.experimentsFor(16).find((e) => e.id === 'sample').desc;
check(!expHtml.includes(sampleDesc), '实验选择界面不展示行为描述');
check(expHtml.includes('🪙 15'), '基础体测需要付费（不再免费）');
check(expHtml.includes('🪙') || expHtml.includes('免费'), '实验弹窗显示资金消耗');

const goldBeforeExp = state.gold;
click('run-exp', { uid: labMon.uid, exp: 'sample' });
check(state.gold === goldBeforeExp - 45, '执行实验扣资金', `(${goldBeforeExp}→${state.gold})`);
check(L.researchProgress(state, 16) > 0, '实验增加物种研究进度');
check(makeEl('#modal').classList.contains('hidden'), '生还实验结束后直接回到页面');
check(!makeEl('#modal').innerHTML.includes('exp-result-text'), '生还结果卡不再展示结果文案');
check(!('result' in ((state.expJournal || [])[0] || {})), '实验日志不写入结果文案');
check(!makeEl('#modal').innerHTML.includes('实验结束 · 生还') && !makeEl('#modal').innerHTML.includes('生还'), '生还结果标题不再显示状态');
check(makeEl('#lab-1').classList.contains('experiment-hit'), '实验对象播放命中反馈动画');
check(Number(makeEl('#lab-1').style['--hit']) > 0, '命中动画带强度参数', makeEl('#lab-1').style['--hit']);
const resBar = makeEl('#lab-1-resbar');
check(resBar.style.width && resBar.style.width !== '0.0%', '研究进度条随实验更新', resBar.style.width);
click('open-exp', { uid: labMon.uid });
UI.render();
const reopenedExpHtml = makeEl('#modal').innerHTML;
check(reopenedExpHtml.includes('冷却 10 秒'), '实验弹窗显示冷却时间');
check(reopenedExpHtml.includes('exp-row-sample') && reopenedExpHtml.includes('recorded'), '已执行行为带已记录样式');
check(!reopenedExpHtml.includes('已记录 1/'), '已记录数量不再显示');
check(makeEl('#exp-run-sample').disabled === true, '冷却中的实验按钮禁用');
L.tick(state, 0.5, 10);
UI.render();
check(makeEl('#exp-run-sample').disabled === false, '冷却结束后按钮恢复可用');

// 研究 100% 后：实验关闭，只剩终末榨取
state.research[16] = L.researchRequirement(16);
if (!state.dex.includes(16)) state.dex.push(16);
UI.render();
const labHtmlAfterDone = makeEl('#lab').innerHTML;
check(!labHtmlAfterDone.includes('data-act="open-exp"'), '研究满后实验台不再提供实验按钮');
check(labHtmlAfterDone.includes('终末榨取'), '研究满后出现终末榨取');
check(!labHtmlAfterDone.includes('最伤身'), '不再提示“只剩最伤身的那种实验”');
check(labHtmlAfterDone.includes('研究已完成'), '实验台标注研究已完成');

click('open-mon', { uid: labMon.uid });
check(makeEl('#modal').innerHTML.includes('实验中（只能处理）'), '详情显示实验室状态');
check(makeEl('#modal').innerHTML.includes('耐受度'), '详情中的耐受度仅在实验室可见');
check(!makeEl('#modal').innerHTML.includes('出售'), '实验室宝可梦没有出售按钮');
check(!makeEl('#modal').innerHTML.includes('喂经验糖果'), '实验室宝可梦不能喂食');
click('close');

// 处理活体：按剩余耐受度收费，立即空出实验台
const processCost = L.labProcessCost(state, 1);
const goldBeforeProcess = state.gold;
click('process-lab', { slot: '1' });
check(L.monByUid(state, labMon.uid) === null, '处理活体立即生效');
check(state.gold === goldBeforeProcess - processCost, '处理活体扣费', `(${goldBeforeProcess}→${state.gold}/${processCost})`);
check(state.lab[1].uid === null && !state.lab[1].corpse, '处理后实验台空出');
check(L.researchProgress(state, 16) > 0, '处理后研究进度保留');
check(!(state.expJournal || []).some((e) => e.cause === 'processed'), '研究满 100% 后处理不写日志');
const processLogMon = L.createMon(state, 17, 5, { gender: 'm' });
state.mons.push(processLogMon);
L.assignLab(state, 1, processLogMon.uid);
state.gold = 100;
check(L.processLabSlot(state, 1).logged, '未满 100% 的活体处理可写日志');
UI.render();
click('open-species', { id: '17' });
check(makeEl('#modal').innerHTML.includes('实验对象被「处理」了'), '处理日志使用统一文案');
click('close');

// 实验死亡 → 遗体占位 → 付费处理（换一个没有研究完的物种：100% 之后已经不能做实验了）
const deathExp = L.experimentsFor(21)[0];
const labDead = L.createMon(state, 21, 5, { gender: 'm' });
state.mons.push(labDead);
L.assignLab(state, 1, labDead.uid);
labDead.tolerance = 1;
state.gold = 1000;
UI.render();
click('run-exp', { uid: labDead.uid, exp: deathExp.id });
check(makeEl('#modal').innerHTML.includes('实验结束') && makeEl('#modal').innerHTML.includes('处理遗体'), '死亡结果卡提供处理遗体按钮');
check(!makeEl('#modal').innerHTML.includes('实验事故') && !makeEl('#modal').innerHTML.includes('实验结束 · 死亡'), '死亡结果标题不再显示死亡状态');
check((makeEl('#modal').innerHTML.match(/data-act="close"/g) || []).length === 1, '实验结束只有一个关闭按钮');
check(makeEl('#modal').innerHTML.includes('实验结束后对象死亡'), '死亡结果卡显示统一死亡结语');
check(L.monByUid(state, labDead.uid) === null, '实验死亡后个体移除');
check(!!state.lab[1].corpse, '实验死亡后留下遗体并占用实验台');
check(makeEl('#lab').innerHTML.includes('已死亡'), '实验室卡片显示死亡状态');
state.gold = 0;
click('close');
check(makeEl('#modal').classList.contains('hidden'), '资金不足时也能关闭死亡结果卡');
state.gold = 100;
UI.render();
const corpseCost = L.labProcessCost(state, 1);
const goldBeforeCorpse = state.gold;
click('process-lab', { slot: '1' });
check(!state.lab[1].corpse, '处理遗体后实验台空出');
check(state.gold === goldBeforeCorpse - corpseCost, '处理遗体扣费', `(${corpseCost})`);

click('open-dex');
check(makeEl('#dex-page').innerHTML.includes('%') || makeEl('#dex-page').innerHTML.includes('完成'), '研究笔记显示研究进度');
state.stats.experimentSpent = 1234;
state.stats.corpseSpent = 56;
UI.render();
const dexSummaryHtml = makeEl('#dex-page').innerHTML;
check(dexSummaryHtml.includes('实验总成本') && dexSummaryHtml.includes('1,290'), '研究笔记顶部显示实验总成本');
check(dexSummaryHtml.includes('累计损耗'), '研究笔记顶部显示累计损耗');
check(!dexSummaryHtml.includes('实验日志') && !dexSummaryHtml.includes('研究记录'), '研究笔记底部不再显示研究记录与实验日志');
check(!dexSummaryHtml.includes('实验行为消耗') && !dexSummaryHtml.includes('遗体处理消耗'), '研究笔记不再显示成本明细');
click('tab', { tab: 'pens' });

// 研究笔记显示规则：研究中灰度、完成彩色、显示研究损耗
state.research[25] = 13;
state.researchLoss[25] = 2;
UI.render();
check(makeEl('#dex-page').innerHTML.includes('dex-cell partial'), '研究中的物种显示为灰度研究笔记');
check(makeEl('#dex-page').innerHTML.includes('皮卡丘'), '研究中显示物种名');
check(makeEl('#dex-page').innerHTML.includes('损2'), '研究笔记显示研究损耗数');
check(makeEl('#dex-page').innerHTML.includes('data-act="open-species"'), '研究过的研究笔记格子可点开详情');

click('open-species', { id: '25' });
check(makeEl('#modal').innerHTML.includes('研究笔记描述'), '物种详情含研究笔记描述栏');
check(makeEl('#modal').innerHTML.includes('补上你写下的描述'), '未完成研究时不显示研究笔记描述');
check(!makeEl('#modal').innerHTML.includes(sp(25).flavor.slice(0, 8)), '未完成研究时描述文本不泄露');
check(makeEl('#modal').innerHTML.includes('蛋组'), '物种详情含蛋组');
check(makeEl('#modal').innerHTML.includes('种族值'), '物种详情含种族值');
check(!makeEl('#modal').innerHTML.includes('已披露'), '未研究时也不显示种族值披露数量');
check(makeEl('#modal').innerHTML.includes('？？？'), '未披露的种族值显示问号');
click('close');

state.research[25] = L.researchRequirement(25);
UI.render();
check(makeEl('#dex-page').innerHTML.includes('dex-cell done'), '研究满后转为彩色');
check(!makeEl('#dex-page').innerHTML.includes('dex-cell partial'), '不再出现研究中样式');

state.dex.push(25);
state.dexRecords[25] = { day: 5, experiments: { measure: 2 }, lost: 3 };
UI.render();
check(makeEl('#dex-page').innerHTML.includes('累计损耗') && makeEl('#dex-page').innerHTML.includes('3 只'), '研究笔记顶部汇总累计损耗');

const doneMon = L.createMon(state, 25, 5, { gender: 'm' });
state.mons.push(doneMon);
UI.render();
const doneIdleHtml = makeEl('#idle').innerHTML;
check(doneIdleHtml.includes(`id="idle-${doneMon.uid}"`) && doneIdleHtml.includes('researched'), '研究完成物种的卡片使用区分背景');
state.mons = state.mons.filter((m) => m.uid !== doneMon.uid);
UI.render();

state.expJournal.unshift({
  day: 12,
  no: 77,
  dexId: 25,
  level: 20,
  expId: 'measure',
  expName: '基础体测',
  survived: true,
  result: '它撑过了这一轮，呼吸逐渐平稳。',
  completed: true,
});
UI.render();
const dexAfterLog = makeEl('#dex-page').innerHTML;
check(!dexAfterLog.includes('实验日志') && !dexAfterLog.includes(`对${sp(25).zh}的研究完成了`), '研究笔记不再展示完成后的实验日志');

state.speciesSpend = { 25: { exp: 321, corpse: 45 } };
click('open-species', { id: '25' });
const speciesModal = makeEl('#modal').innerHTML;
check(speciesModal.includes('研究笔记描述'), '完成研究后物种详情含研究笔记描述');
check(speciesModal.includes(sp(25).flavor.slice(0, 8)), '完成研究后显示研究笔记描述文本', sp(25).flavor);
check(!speciesModal.includes('研究行为'), '物种详情不再展示研究行为栏');
check(speciesModal.includes('研究损耗'), '物种详情展示研究损耗');
check(speciesModal.includes('研究成本') && speciesModal.includes('366'), '物种详情按“研究成本”展示合计金额');
check(!speciesModal.includes('分类'), '物种详情不再展示分类');
check(!speciesModal.includes('已披露'), '物种详情种族值不再显示披露数量');
check(speciesModal.includes(`>${sp(25).stats.hp}<`), '物种详情显示已披露的种族值');
click('close');

// 收束界面
UI.handleEvents([{ type: 'win', msg: '这条路到这里就可以结束了。' }]);
check(makeEl('#modal').innerHTML.includes('这条路走到这里'), '收束弹窗可打开');
check(makeEl('#modal').innerHTML.includes('游戏承认了你的努力'), '收束文案强调不是传统胜负');
click('close');
state.won = true;
UI.render();
check(!makeEl('#win-banner').classList.contains('hidden'), '收束后显示横幅');

// 最高职级收束：不再要求传说研究
state.winKind = 'rank';
state.rank = RANKS.length - 1;
UI.render();
check(makeEl('#win-banner').textContent.includes('干部'), '最高职级横幅使用收束文案');
UI.handleEvents([{ type: 'win', msg: '这条路到这里就可以结束了。' }]);
check(makeEl('#modal').innerHTML.includes('这条路走到这里') && !makeEl('#modal').innerHTML.includes('传说'), '最高职级收束不要求传说宝可梦');
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

// 加载条 → 结果卡
const loadingState = L.newGame(123456);
const loadingMon = L.createMon(loadingState, 16, 8, { gender: 'm' });
loadingState.mons.push(loadingMon);
L.assignLab(loadingState, 0, loadingMon.uid);
UI.setState(loadingState);
UI.render();
UI.setExperimentLoading(true, 40);
const measureDesc = L.experimentsFor(16).find((e) => e.id === 'measure').desc;
click('run-exp', { uid: loadingMon.uid, exp: 'measure' });
check(makeEl('#modal').innerHTML.includes('正在') && makeEl('#modal').innerHTML.includes('基础体测'), '实验加载条提示正在进行的实验');
check(makeEl('#modal').innerHTML.includes(measureDesc), '加载界面展示实验行为描述');
check(!!makeEl('#exp-progress'), '加载界面显示进度条');
check(!makeEl('#modal').innerHTML.includes('实验记录中') && !makeEl('#modal').innerHTML.includes('exp-progress-text'), '加载界面不显示百分比数据和关闭提示');
await new Promise((resolve) => setTimeout(resolve, 120));
check(makeEl('#modal').classList.contains('hidden'), '加载结束后不弹出结果文案卡');
check((loadingState.expJournal || []).some((e) => e.expId === 'measure'), '加载完成后写入实验日志');
check(loadingState.gold < 1800, '加载完成后结算实验');
UI.setExperimentLoading(false);

// 围栏开关：培育相关 / 其它 一次只显示一段；遗体单独成栏
const sectionState = L.newGame(7777);
const evoIdle = L.createMon(sectionState, 17, 5, { gender: 'm' }); // 比比鸟：培育栏里波波的进化
const unrelated = L.createMon(sectionState, 25, 5, { gender: 'm' }); // 皮卡丘：与培育栏无关
sectionState.mons.push(evoIdle, unrelated);
UI.setState(sectionState);
UI.render();
check(indexHtml.includes('idle-tab-related') && indexHtml.includes('idle-tab-others'), '围栏有分段开关');
let idleHtml = makeEl('#idle').innerHTML;
check(idleHtml.includes('<div class="idle-sec" data-sec="related">'), '默认展示培育相关段');
check(idleHtml.includes('<div class="idle-sec hidden" data-sec="others">'), '其它段默认隐藏');
check(idleHtml.includes(`idle-${evoIdle.uid}`) && idleHtml.includes(`idle-${unrelated.uid}`), '两段个体都在页面里，靠开关切换');
check(makeEl('#idle-tab-related').textContent.includes('培育相关（2）'), '开关显示培育相关数量', makeEl('#idle-tab-related').textContent);
check(makeEl('#idle-tab-others').textContent.includes('其它（1）'), '开关显示其它数量', makeEl('#idle-tab-others').textContent);

click('idle-section', { section: 'others' });
idleHtml = makeEl('#idle').innerHTML;
check(idleHtml.includes('<div class="idle-sec hidden" data-sec="related">'), '切换后培育相关段隐藏');
check(idleHtml.includes('<div class="idle-sec" data-sec="others">'), '切换后其它段显示');
check(makeEl('#idle-tab-others').classList.contains('on'), '切换后按钮高亮');

sectionState.idleCorpses = [{ dexId: 25, no: 9, level: 3, gender: 'f', day: 2, cause: 'bully' }];
UI.render();
check(makeEl('#idle').innerHTML.includes('data-sec="corpse"'), '遗体单独成栏');
click('idle-section', { section: 'related' });
const corpseBlockHtml = makeEl('#idle').innerHTML;
check(corpseBlockHtml.includes('idle-corpse-0') && !corpseBlockHtml.includes('<div class="idle-sec hidden" data-sec="corpse">'), '遗体栏与分段开关无关，始终显示');
check(!indexHtml.includes('idle-filters'), '围栏筛选栏已从页面移除');

// 培育栏状态表达：蛋位满 / 锁定 / 遗体
const failUi = L.newGame(8888);
const failA = L.createMon(failUi, 16, 10, { gender: 'm' });
const failB = L.createMon(failUi, 21, 10, { gender: 'f' });
failUi.mons.push(failA, failB);
failUi.pens[0] = { a: failA.uid, b: failB.uid, breed: 1.2 };
failUi.eggs = Array.from({ length: L.eggSlots(failUi) }, (_, i) => ({ uid: `fe${i}`, dexId: 16, daysLeft: 9, total: 9 }));
UI.setState(failUi);
UI.render();
check(makeEl('#egg-hint').textContent.includes('已满'), '蛋位满时孵化器提示已满', makeEl('#egg-hint').textContent);
check(makeEl('#pen-0-warn').textContent.includes('孵化器已满'), '蛋位满时培育栏说明暂停原因', makeEl('#pen-0-warn').textContent);
check(!makeEl('#pen-0-breed').classList.contains('paused'), '蛋位满不属于“注定配不成”，条不置灰');

// 蛋组不匹配不再锁对：条照常走，不再显示“曾配对失败”
failUi.eggs = [];
UI.render();
check(!makeEl('#pen-0-breed').classList.contains('paused'), '蛋组不匹配不再把繁育条置灰');
check(!makeEl('#pen-0-warn').textContent.includes('曾配对失败'), '不再出现配对失败提示', makeEl('#pen-0-warn').textContent);

// 培育栏遗体：占位卡片 + 付费处理入口
const corpseUi = L.newGame(8889);
const cuA = L.createMon(corpseUi, 16, CONFIG.maxLevel, { gender: 'm' });
const cuB = L.createMon(corpseUi, 74, 3, { gender: 'f' });
cuB.tolerance = 10; // 一发就力竭
corpseUi.mons = [cuA, cuB];
corpseUi.pens = [{ a: cuA.uid, b: cuB.uid, breed: 0 }];
corpseUi.eggs = [];
L.tick(corpseUi, 3);
UI.setState(corpseUi);
UI.render();
check(makeEl('#pens').innerHTML.includes('遗体'), '培育栏显示遗体');
check(makeEl('#pens').innerHTML.includes('process-pen-corpse'), '培育栏遗体带处理按钮');
check(makeEl('#pens').innerHTML.includes(`🪙 ${CONFIG.penCorpseProcessCost}`), '遗体处理按钮标价');

// 培育栏详情：放入实验室 / 扔回围栏
const penLabUi = L.newGame(8890);
const plA = L.createMon(penLabUi, 16, 10, { gender: 'm' });
const plB = L.createMon(penLabUi, 21, 10, { gender: 'f' });
const plC = L.createMon(penLabUi, 25, 5, { gender: 'm' });
penLabUi.mons.push(plA, plB, plC);
penLabUi.pens[0] = { a: plA.uid, b: plB.uid, breed: 0.5 };
UI.setState(penLabUi);
UI.render();
click('open-mon', { uid: plA.uid });
check(makeEl('#modal').innerHTML.includes('扔回围栏'), '培育栏详情按钮为扔回围栏');
check(makeEl('#modal').innerHTML.includes('放入实验室'), '培育栏详情提供放入实验室');
check(!makeEl('#modal').innerHTML.includes('调动位置'), '培育栏详情不再提供调动位置');
click('open-pen-lab', { uid: plA.uid });
check(makeEl('#modal').innerHTML.includes('实验台'), '打开实验台选择弹窗');
click('pen-to-lab', { uid: plA.uid, slot: '0' });
check(L.labContains(penLabUi, plA.uid) && L.penIndex(penLabUi, plA.uid) === -1, 'UI 可从培育栏直接送进实验室');
// 实验室自己的选择列表仍然排除培育栏里的个体
click('open-lab-picker', { slot: '1' });
const labPickerHtml = makeEl('#modal').innerHTML;
check(labPickerHtml.includes(plC.uid), '实验室选择列表包含围栏个体');
check(!labPickerHtml.includes(plB.uid), '实验室选择列表排除培育栏个体');
check(!labPickerHtml.includes(plA.uid), '实验室选择列表排除已在实验室的个体');
click('close');

// 研究完成 -> 培育栏卡片实时变绿
const researchUi = L.newGame(8891);
UI.setState(researchUi);
researchUi.research[16] = L.researchRequirement(16);
if (!researchUi.dex.includes(16)) researchUi.dex.push(16);
UI.render();
check(makeEl('#pen-0-a').classList.contains('researched'), '研究完成后培育栏卡片实时变绿');

// 日志落盘：写入 state.log，重新挂载后回播，内部过期记录不回播
UI.pushLog('日志落盘测试', 'info');
check((researchUi.log || []).some((e) => e.msg === '日志落盘测试'), '日志写入 state.log');
researchUi.log.push({ day: 1, type: 'expire', msg: '需求过期测试' });
UI.setState(researchUi);
check(makeEl('#log').innerHTML.includes('日志落盘测试'), '重新挂载后日志能回播');
check(!makeEl('#log').innerHTML.includes('需求过期测试'), '内部过期记录不回播');

// 实验日志：仍写入数据，但研究笔记页不再展示
const journalUi = L.newGame(8892);
journalUi.expJournal = [
  { day: 5, no: 7, dexId: 16, level: 12, expId: 'measure', expName: '基础体测', survived: true, result: '甲' },
  { day: 4, no: 7, dexId: 16, level: 11, expId: 'sample', expName: '组织采样', survived: true, result: '乙' },
  { day: 3, no: 9, dexId: 16, level: 8, expId: 'battle', expName: '对战测试', survived: false, result: '丙' },
];
UI.setState(journalUi);
UI.render();
const journalHtml = makeEl('#dex-page').innerHTML;
check(!journalHtml.includes('exp-journal') && !journalHtml.includes('#0007'), '研究笔记页不再渲染实验日志');

// 未满研究的物种：实验死亡仍写入数据，但不在研究笔记页显示结语
const deathLogUi = L.newGame(8893);
const dlMon = L.createMon(deathLogUi, 17, 10, { gender: 'm' });
deathLogUi.mons.push(dlMon);
L.assignLab(deathLogUi, 0, dlMon.uid);
dlMon.tolerance = 1;
deathLogUi.gold = 1000;
const dlExp = L.experimentsFor(17)[0];
L.startExperiment(deathLogUi, dlMon.uid, dlExp.id);
UI.setState(deathLogUi);
UI.render();
check((deathLogUi.expJournal || []).some((e) => e.expId === dlExp.id && !e.survived), '未满研究的死亡仍写入实验日志数据');
check(!makeEl('#dex-page').innerHTML.includes('实验结束后对象死亡'), '研究笔记页不显示实验日志死亡结语');

// 物种详情实验日志：同一个体同一天的连续记录只显示一次日期
const dateLogUi = L.newGame(8894);
dateLogUi.expJournal = [
  { day: 55, no: 7, dexId: 16, level: 12, expId: 'measure', expName: '基础体测', survived: true },
  { day: 55, no: 7, dexId: 16, level: 12, expId: 'sample', expName: '组织采样', survived: true },
  { day: 4, no: 7, dexId: 16, level: 12, expId: 'battle', expName: '对战测试', survived: true },
  { day: 55, no: 8, dexId: 16, level: 12, expId: 'measure', expName: '基础体测', survived: true },
];
UI.setState(dateLogUi);
UI.render();
click('open-species', { id: '16' });
const dateLogHtml = makeEl('#modal').innerHTML;
const dateLogDesc = L.experimentsFor(16).find((e) => e.id === 'measure').desc;
check(dateLogHtml.includes(dateLogDesc) && !dateLogHtml.includes(`「${dateLogDesc}」`), '实验行为描述不带引号');
check((dateLogHtml.match(/<span class="d">D55<\/span>/g) || []).length === 2, '同一个体同日只显示一次日期');
check((dateLogHtml.match(/<span class="d">D4<\/span>/g) || []).length === 1, '日期变化时重新显示');
click('close');

// ---------- 繁育：近亲标记 / 蛋组绿框 / 个体值 ----------
const breedUi = L.newGame(8895);
const bKinDad = L.createMon(breedUi, 16, 30, { gender: 'm' });
const bKinDau = L.createMon(breedUi, 21, 5, { gender: 'f' });
bKinDau.ancestors = { [bKinDad.uid]: 1 };
bKinDau.gen = 1;
bKinDau.inbred = true;
const bOther = L.createMon(breedUi, 25, 5, { gender: 'f' }); // 皮卡丘：陆上 / 妖精
breedUi.mons = [bKinDad, bKinDau, bOther];
breedUi.pens = [
  { a: bKinDad.uid, b: null, breed: 0 },
  { a: null, b: null, breed: 0 },
  { a: null, b: null, breed: 0 },
];
breedUi.eggs = [];
UI.setState(breedUi);
UI.render();

// 蛋组未知：不亮
click('open-picker', { pen: '0', slot: 'b' });
check(!makeEl('#modal').innerHTML.includes('egg-match'), '蛋组未识别时不给绿框');
check(makeEl('#modal').innerHTML.includes('kin-badge') && makeEl('#modal').innerHTML.includes('女儿'), '选择器用亲属称呼标出关系');
click('close');

// 蛋组已识别：与栏位内那只共享蛋组的候选给绿框
breedUi.eggKnown = { 16: ['flying'], 21: ['flying'], 25: ['ground', 'fairy'] };
UI.render();
click('open-picker', { pen: '0', slot: 'b' });
const pickHtml = makeEl('#modal').innerHTML;
check(pickHtml.includes('egg-match'), '已知同蛋组的候选有绿框');
const btnFor = (uid) => (pickHtml.match(new RegExp(`<button[^>]*data-uid="${uid}"[^>]*>`)) || [''])[0];
const dauBtn = btnFor(bKinDau.uid);
const otherBtn = btnFor(bOther.uid);
check(dauBtn.includes('egg-match'), '同蛋组的候选带绿框');
check(!otherBtn.includes('egg-match'), '不同蛋组的候选不带绿框');
click('close');

// 个体详情：不再显示血缘信息
click('open-mon', { uid: bKinDau.uid });
const kinDetail = makeEl('#modal').innerHTML;
check(!kinDetail.includes('近亲后代') && !kinDetail.includes('血缘'), '详情不再显示血缘信息');
click('close');

// 个体值：研究 100% 才显示
const ivUi = L.newGame(8896);
const ivMon = L.createMon(ivUi, 16, 20, { gender: 'm' });
ivMon.ivs = { hp: 1, atk: 31, def: 5, spa: 12, spd: 24, spe: 30 };
ivUi.mons = [ivMon];
UI.setState(ivUi);
UI.render();
click('open-mon', { uid: ivMon.uid });
check(!makeEl('#modal').innerHTML.includes('class="iv"'), '未研究时不显示个体值');
click('close');
ivUi.research[16] = L.researchRequirement(16);
ivUi.dex = [16];
UI.render();
click('open-mon', { uid: ivMon.uid });
const ivHtml = makeEl('#modal').innerHTML;
check(ivHtml.includes('IV 31'), '研究 100% 后显示个体值', ivHtml.includes('IV 31') ? '' : '缺失');
check((ivHtml.match(/class="iv"/g) || []).length === 6, '六项都显示个体值');
click('close');

// ---------- 实验室：助手 / 终末榨取 / 日志 ----------
const labUi = L.newGame(8897);
labUi.rank = 3;
labUi.gold = 5000;
const labUiMon = L.createMon(labUi, 16, 30, { gender: 'm' });
labUi.mons.push(labUiMon);
L.assignLab(labUi, 0, labUiMon.uid);
labUi.expJournal = [
  { day: 5, no: 7, dexId: 16, level: 12, expId: 'measure', expName: '基础体测', survived: true },
];
UI.setState(labUi);
UI.render();
click('open-species', { id: '16' });
check(!makeEl('#modal').innerHTML.includes('class="cnt"'), '实验日志组头不再显示次数');
click('close');

const assistAttrs = () => (makeEl('#lab').innerHTML.match(/data-act="assign-assistant"[^>]*/) || [''])[0];
check(makeEl('#lab').innerHTML.includes('安排助手'), '实验台提供安排助手按钮');
check(assistAttrs().includes('disabled'), '没亲手做满 5 条实验时安排助手禁用');
for (const e of L.experimentsFor(16)) {
  labUi.expLog[16] = { ...(labUi.expLog[16] || {}), [e.id]: 1 };
}
UI.render();
check(!assistAttrs().includes('disabled'), '做满实验后可以安排助手');
click('assign-assistant', { slot: '0' });
check(labUi.lab[0].auto && labUi.lab[0].assistant, '点击后助手开始自动研究');
check(makeEl('#lab').innerHTML.includes('助手研究中'), '卡片显示「助手研究中」');
click('open-species', { id: '16' });
check(makeEl('#modal').innerHTML.includes('安排助手对其进行实验'), '日志写入「安排助手」');
click('close');
click('interrupt-assistant', { slot: '0' });
check(!labUi.lab[0].auto && labUi.lab[0].assistant, '打断后停止自动但助手仍占用');
check(!makeEl('#lab').innerHTML.includes('助手研究中'), '打断后不再显示「助手研究中」');
click('open-species', { id: '16' });
check(makeEl('#modal').innerHTML.includes('你决定亲自动手'), '日志写入「你决定亲自动手」');
click('close');

// 终末榨取：完成研究后取代实验
const fxUi = L.newGame(8898);
const fxUiMon = L.createMon(fxUi, 16, 50, { gender: 'm' });
fxUiMon.tolerance = 200;
fxUi.mons.push(fxUiMon);
L.assignLab(fxUi, 0, fxUiMon.uid);
fxUi.research[16] = L.researchRequirement(16);
if (!fxUi.dex.includes(16)) fxUi.dex.push(16);
fxUi.gold = 2000;
UI.setState(fxUi);
UI.render();
check(makeEl('#lab').innerHTML.includes('终末榨取'), '完成研究后出现终末榨取');
click('final-extract', { slot: '0' });
check(makeEl('#modal').innerHTML.includes('处置完成 · 样本已耗尽'), '终末榨取结果卡标题');
check(L.samplesOf(fxUi, 16) > 0, '样本入库');
click('close');
check(makeEl('#lab').innerHTML.includes('已死亡'), '榨取后实验台显示遗体');

// ---------- 畸形体：围栏第三段 / 渲染 / 蛋卡 / 实验室 ----------
const mutUi = L.newGame(8899);
const mutA = L.createMon(mutUi, 143, 10, { gender: 'f', mutant: true, vigor: 0.5, sterile: true, mix: [143, 10] });
const normA = L.createMon(mutUi, 143, 10, { gender: 'm' });
mutUi.mons = [mutA, normA];
mutUi.eggs = [];
UI.setState(mutUi);
UI.render();
const mutSegHtml = makeEl('#idle').innerHTML;
check(mutSegHtml.includes('data-sec="mutant"'), '围栏出现畸体段');
check(mutSegHtml.includes('warp-'), '畸形体卡片带湍流滤镜');
check(!makeEl('#idle-tab-mutant').classList.contains('hidden'), '有畸体时开关出现');

// 没有畸体：段与开关一起消失
mutUi.mons = [normA];
UI.render();
check(!makeEl('#idle').innerHTML.includes('data-sec="mutant"'), '没有畸体时不渲染畸体段');
check(makeEl('#idle-tab-mutant').classList.contains('hidden'), '没有畸体时开关隐藏');

// 蛋卡简化：只剩物种与剩余天数
mutUi.eggs = [{ uid: 'e9', dexId: 16, daysLeft: 3, total: 6, ivs: {}, nature: 'hardy' }];
UI.render();
const eggSimpleHtml = makeEl('#eggs').innerHTML;
check(!eggSimpleHtml.includes('蛋组'), '蛋卡不再显示蛋组');
check(eggSimpleHtml.includes('孵化中'), '蛋卡只留物种与剩余天数');

// 实验室：畸形体没有实验，直接可榨取
mutUi.eggs = [];
mutUi.mons = [mutA, normA];
L.assignLab(mutUi, 0, mutA.uid);
UI.render();
const labMutHtml = makeEl('#lab').innerHTML;
check(labMutHtml.includes('没有研究价值'), '实验室标注畸形体没有研究价值');
check(!labMutHtml.includes('data-act="open-exp"'), '畸形体没有实验按钮');
check(labMutHtml.includes('终末榨取'), '畸形体直接可终末榨取');
check((makeEl('#lab-0-img').style.filter || '').includes('warp-'), '实验室畸形体保持湍流贴图');

// 每个畸形体一套独立形态
const mutB = L.createMon(mutUi, 143, 6, { gender: 'm', mutant: true, vigor: 0.5, sterile: true, mix: [143, 10] });
mutUi.mons = [mutA, normA, mutB];
L.assignLab(mutUi, 1, mutB.uid);
UI.render();
const mutF0 = makeEl('#lab-0-img').style.filter || '';
const mutF1 = makeEl('#lab-1-img').style.filter || '';
check(mutF0.includes('warp-') && mutF1.includes('warp-') && mutF0 !== mutF1, '不同畸形体各有独立的扭曲形态');

// 畸形体不出现在培育栏选择器
const mutPickMon = L.createMon(mutUi, 143, 5, { gender: 'f', mutant: true, vigor: 0.5, sterile: true, mix: [143, 10] });
mutUi.mons = [mutA, normA, mutB, mutPickMon];
UI.render();
click('open-picker', { pen: '1', slot: 'a' });
check(!makeEl('#modal').innerHTML.includes(mutPickMon.uid), '畸形体不出现在培育栏选择器');
click('close');

console.log(`\n${failures === 0 ? 'UI 测试全部通过 ✓' : `${failures} 项失败 ✗`}`);
process.exit(failures ? 1 : 0);
