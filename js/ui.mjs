// 视图层：增量渲染（结构变化才重建 DOM，其余只更新数值与进度条）
import * as L from './logic.mjs';
import {
  DEX, sp, art, sprite, remoteSprite, typeZh, typeColor, eggZh, calcStats, natureById, STAT_ZH,
  ITEM_ZH, STONE_ITEMS, GROWTH_ZH, eggGroupsZh, ivTotal, bst,
} from './data.mjs';

const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (v, max) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (v / max) * 100)));
const fmtPct = (v, max) => `${pct(v, max).toFixed(1)}%`;
const imgFallback = (id) => ` onerror="this.onerror=null;this.src='${remoteSprite(Number(id))}'"`;
const setText = (node, text) => {
  if (node && node.textContent !== text) node.textContent = text;
};
const setWidth = (node, value) => {
  const v = `${value.toFixed(1)}%`;
  if (node && node.style.width !== v) node.style.width = v;
};

let S = null;
let hooks = {};
let speed = 1;
let modal = null;
let logs = [];
let toastTimer = null;

// 结构签名：只有签名变化时才重建对应区域的 DOM，避免 hover 状态被反复重置
const sig = { pens: null, eggs: null, lab: null, orders: null, shop: null, upgrades: null, log: null };

export function mount(state, options) {
  S = state;
  hooks = options || {};
  resetSignatures();
  bind();
  render();
}

export function setState(next) {
  S = next;
  resetSignatures();
  render();
}

function resetSignatures() {
  sig.pens = sig.eggs = sig.lab = sig.orders = sig.shop = sig.upgrades = sig.log = null;
}

export function getSpeed() {
  return speed;
}

export function toast(msg, kind = '') {
  const node = $('#toast');
  if (!node) return;
  node.textContent = msg;
  node.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = 'toast';
  }, 2200);
}

export function pushLog(msg, type = 'info') {
  logs.push({ day: Math.floor(S.day), msg, type });
  if (logs.length > 40) logs.splice(0, logs.length - 40);
}

export function handleEvents(events) {
  let important = 0;
  for (const e of events) {
    if (e.type === 'level') continue;
    pushLog(e.msg, e.type);
    if (e.type === 'win') {
      toast(e.msg, 'good');
      openModal('win');
      continue;
    }
    if ((e.type === 'evolve' || e.type === 'egg' || e.type === 'warn' || e.type === 'research') && important < 2) {
      toast(e.msg, e.type === 'warn' ? 'bad' : 'good');
      important++;
    }
  }
}

// ---------- 事件绑定 ----------
function bind() {
  document.addEventListener('click', (ev) => {
    const node = ev.target.closest('[data-act]');
    if (!node) return;
    try {
      handleAction(node.dataset.act, node.dataset, node);
    } catch (err) {
      console.error(err);
      toast('操作出错：' + err.message, 'bad');
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal) closeModal();
  });
}

function handleAction(act, d) {
  switch (act) {
    case 'speed':
      speed = Number(d.speed);
      hooks.onSpeed?.(speed);
      render();
      break;
    case 'save':
      hooks.onSave?.();
      break;
    case 'reset':
      openModal('reset');
      break;
    case 'open-help':
      openModal('help');
      break;
    case 'open-dex':
      openModal('dex');
      break;
    case 'close':
      closeModal();
      break;
    case 'add-pen': {
      const r = L.buyUpgrade(S, 'pens');
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'open-mon':
      openModal('mon', { uid: d.uid });
      break;
    case 'open-picker':
      openModal('picker', { pen: Number(d.pen), slot: d.slot });
      break;
    case 'assign': {
      const r = L.assignPen(S, Number(d.pen), d.slot, d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'unassign': {
      const r = L.removeFromPen(S, d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      openModal('mon', { uid: d.uid });
      render();
      break;
    }
    case 'feed': {
      const r = L.feed(S, d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.events) handleEvents(r.events);
      openModal('mon', { uid: d.uid });
      render();
      break;
    }
    case 'sell': {
      const r = L.sellMon(S, d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'evolve': {
      const mon = L.monByUid(S, d.uid);
      const plan = mon ? L.evoPlanFor(S, mon).find((p) => String(p.toId) === String(d.to)) : null;
      const r = L.evolveWithItem(S, mon, plan);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.events) handleEvents(r.events);
      openModal('mon', { uid: d.uid });
      render();
      break;
    }
    case 'deliver-open':
      openModal('deliver', { orderId: d.order });
      break;
    case 'open-lab-picker':
      openModal('labpicker', { slot: Number(d.slot) });
      break;
    case 'lab-confirm':
      openModal('labconfirm', { slot: Number(d.slot), uid: d.uid });
      break;
    case 'assign-lab': {
      const r = L.assignLab(S, Number(d.slot), d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'open-exp':
      openModal('labexp', { uid: d.uid });
      break;
    case 'run-exp': {
      const r = L.startExperiment(S, d.uid, d.exp);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.events) handleEvents(r.events);
      if (r.released) closeModal();
      else openModal('labexp', { uid: d.uid });
      render();
      break;
    }
    case 'release-mon':
      openModal('release', { uid: d.uid });
      break;
    case 'confirm-release': {
      const r = L.releaseMon(S, d.uid, 'manual');
      toast(r.msg, r.ok ? 'good' : 'bad');
      closeModal();
      render();
      break;
    }
    case 'deliver': {
      const r = L.deliver(S, d.order, d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'abandon': {
      const r = L.abandonOrder(S, d.order);
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'buy-egg': {
      const r = L.buyEggOffer(S, Number(d.idx));
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'buy-berries': {
      const r = L.buyBerries(S, Number(d.qty));
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'buy-item': {
      const r = L.buyItem(S, d.item);
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'upgrade': {
      const r = L.buyUpgrade(S, d.key);
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'confirm-reset':
      closeModal();
      hooks.onReset?.();
      break;
    default:
      break;
  }
}

// ---------- 渲染入口 ----------
export function render() {
  if (!S) return;
  renderTop();
  ensurePens();
  patchPens();
  ensureEggs();
  patchEggs();
  ensureLab();
  patchLab();
  ensureOrders();
  patchOrders();
  ensureShop();
  patchShop();
  ensureUpgrades();
  patchUpgrades();
  renderLog();
}

function renderTop() {
  setText(el('gold'), fmt(S.gold));
  setText(el('berries'), String(S.berries));
  setText(el('rep'), String(Math.round(S.rep)));
  setText(el('dex'), `${S.dex.length}/151`);
  setText(el('day'), String(Math.floor(S.day)));
  document.querySelectorAll('#speeds button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === speed);
  });
  const banner = el('win-banner');
  if (banner) banner.classList.toggle('hidden', !S.won);
}

function typeBadges(types) {
  return types.map((t) => `<span class="type" style="--c:${typeColor(t)}">${typeZh(t)}</span>`).join('');
}

// ---------- 培育栏 ----------
function pensSignature() {
  return S.pens
    .map((p) => {
      const a = L.monByUid(S, p.a);
      const b = L.monByUid(S, p.b);
      return `${p.a || '-'}:${a ? a.dexId : '-'}|${p.b || '-'}:${b ? b.dexId : '-'}`;
    })
    .join(';');
}

function ensurePens() {
  const s = pensSignature();
  if (s === sig.pens) return;
  sig.pens = s;
  $('#pens').innerHTML = S.pens
    .map((pen, i) => {
      const a = L.monByUid(S, pen.a);
      const b = L.monByUid(S, pen.b);
      return `<div class="pen" id="pen-${i}">
        <div class="pen-head"><span>栏位 ${i + 1}</span><span class="tag no" id="pen-${i}-status">—</span></div>
        <div class="slots">
          ${a ? monSlotHtml(a, i, 'a') : emptySlotHtml(i, 'a')}
          ${b ? monSlotHtml(b, i, 'b') : emptySlotHtml(i, 'b')}
        </div>
        <div class="breed" id="pen-${i}-breed" style="display:none">
          <span>繁育</span>
          <div class="bar"><i id="pen-${i}-breedbar" style="width:0%"></i></div>
          <span class="pct" id="pen-${i}-breedpct">0%</span>
        </div>
      </div>`;
    })
    .join('');
}

function monSlotHtml(mon, pen, slot) {
  const s = sp(mon.dexId);
  return `<div class="slot filled" id="pen-${pen}-${slot}" data-act="open-mon" data-uid="${mon.uid}" title="查看详情">
    <img src="${sprite(mon.dexId)}"${imgFallback(mon.dexId)} alt="${s.zh}" />
    <div class="nm">${s.zh}<span class="g">${L.genderZh(mon.gender)}</span></div>
    <div class="lv" id="pen-${pen}-${slot}-lv">Lv.${mon.level}</div>
    <div class="egg-grp">${eggGroupsZh(s.eggGroups)}</div>
    <div class="types">${typeBadges(s.types)}</div>
    <div class="bar exp" style="width:100%"><i id="pen-${pen}-${slot}-exp" style="width:0%"></i></div>
  </div>`;
}

function emptySlotHtml(pen, slot) {
  return `<button class="slot empty" data-act="open-picker" data-pen="${pen}" data-slot="${slot}">＋<br />放入宝可梦</button>`;
}

function patchPens() {
  S.pens.forEach((pen, i) => {
    const a = L.monByUid(S, pen.a);
    const b = L.monByUid(S, pen.b);
    patchSlot(a, i, 'a');
    patchSlot(b, i, 'b');

    const compat = L.compatibility(S, a, b);
    const card = el(`pen-${i}`);
    if (card) card.classList.toggle('ready', compat.ok);

    const status = el(`pen-${i}-status`);
    if (status) {
      status.className = `tag ${compat.ok ? 'ok' : 'no'}`;
      status.textContent = compat.ok ? '可以配种' : a && b ? compat.reason : '等待宝可梦';
    }

    const breed = el(`pen-${i}-breed`);
    if (breed) {
      breed.style.display = compat.ok ? 'flex' : 'none';
      if (compat.ok) {
        const p = pct(pen.breed, L.CONFIG.breedDays);
        setWidth(el(`pen-${i}-breedbar`), p);
        setText(el(`pen-${i}-breedpct`), `${p.toFixed(0)}%`);
      }
    }
  });

  const maxPens = L.UPGRADE_INFO.pens.max;
  const cost = L.upgradeCost(S, 'pens');
  $('#pen-hint').textContent = `${S.pens.length}/${maxPens} 个栏位${cost != null ? ` · 扩建 ${fmt(cost)} 资金` : ''}`;
}

function patchSlot(mon, pen, slot) {
  if (!mon) return;
  const s = sp(mon.dexId);
  setText(el(`pen-${pen}-${slot}-lv`), `Lv.${mon.level}`);
  setWidth(el(`pen-${pen}-${slot}-exp`), pct(mon.exp, L.expNeeded(mon.level, s.growthRate)));
}

// ---------- 孵化器 ----------
function eggsSignature() {
  return S.eggs.map((e) => `${e.uid}:${e.dexId}:${e.total}`).join('|');
}

function ensureEggs() {
  const s = eggsSignature();
  if (s === sig.eggs) return;
  sig.eggs = s;
  const host = $('#eggs');
  if (!S.eggs.length) {
    host.innerHTML = `<div class="empty-tip">孵化器空闲。到市场买蛋，或让同一栏位的两只宝可梦配种（一雄一雌、蛋组有交集即可）。</div>`;
    return;
  }
  host.innerHTML = S.eggs
    .map((egg) => {
      const s2 = sp(egg.dexId);
      return `<div class="egg">
        <div class="egg-top">
          <div class="egg-shape"></div>
          <div>
            <div class="nm">${s2.zh}</div>
            <div class="egg-grp">${eggGroupsZh(s2.eggGroups)}</div>
            <div class="sub" id="egg-${egg.uid}-left">孵化中 · ${egg.daysLeft.toFixed(1)} 天</div>
          </div>
        </div>
        <div class="bar egg"><i id="egg-${egg.uid}-bar" style="width:0%"></i></div>
      </div>`;
    })
    .join('');
}

function patchEggs() {
  $('#egg-hint').textContent = `${S.eggs.length}/${L.eggSlots(S)} 枚蛋`;
  for (const egg of S.eggs) {
    setText(el(`egg-${egg.uid}-left`), `孵化中 · ${Math.max(0, egg.daysLeft).toFixed(1)} 天`);
    setWidth(el(`egg-${egg.uid}-bar`), pct(egg.total - egg.daysLeft, egg.total));
  }
}

// ---------- 实验室 ----------
function labSignature() {
  return `${S.lab.length}:` + S.lab.map((slot) => slot.uid || '-').join('|');
}

function ensureLab() {
  const s = labSignature();
  if (s === sig.lab) return;
  sig.lab = s;
  const host = $('#lab');
  host.innerHTML = S.lab
    .map((slot, i) => {
      const mon = L.monByUid(S, slot.uid);
      if (!mon) {
        return `<button class="slot empty lab-empty" data-act="open-lab-picker" data-slot="${i}">＋<br />放入实验对象</button>`;
      }
      const spc = sp(mon.dexId);
      return `<div class="lab-card" id="lab-${i}">
        <div class="lab-head">
          <img src="${sprite(mon.dexId)}"${imgFallback(mon.dexId)} alt="${spc.zh}" />
          <div>
            <div class="nm">${spc.zh}</div>
            <div class="lv">Lv.${mon.level} · ${eggGroupsZh(spc.eggGroups)}</div>
          </div>
        </div>
        <div class="lab-stat"><span>耐受度</span><b id="lab-${i}-tol">${Math.round(mon.tolerance)}</b></div>
        <div class="bar hap" style="width:100%"><i id="lab-${i}-tolbar" style="width:0%"></i></div>
        <div class="lab-stat"><span>图鉴研究</span><b id="lab-${i}-res">${L.researchPercent(S, mon.dexId)}%</b></div>
        <div class="bar egg" style="width:100%"><i id="lab-${i}-resbar" style="width:0%"></i></div>
        <div class="lab-actions">
          <button class="mini" data-act="open-exp" data-uid="${mon.uid}">实验</button>
          <button class="ghost danger" data-act="release-mon" data-uid="${mon.uid}">放生</button>
        </div>
      </div>`;
    })
    .join('');
}

function patchLab() {
  const filled = S.lab.filter((slot) => slot.uid).length;
  const cost = L.upgradeCost(S, 'lab');
  $('#lab-hint').textContent = `${filled}/${S.lab.length} 个实验台${cost != null ? ` · 扩建 ${fmt(cost)} 资金` : ''}`;
  S.lab.forEach((slot, i) => {
    const mon = L.monByUid(S, slot.uid);
    if (!mon) return;
    const tol = Math.max(0, Math.round(mon.tolerance));
    setText(el(`lab-${i}-tol`), String(tol));
    setWidth(el(`lab-${i}-tolbar`), Math.max(0, Math.min(100, tol)));
    const pctRes = L.researchPercent(S, mon.dexId);
    setText(el(`lab-${i}-res`), `${pctRes}%`);
    setWidth(el(`lab-${i}-resbar`), pctRes);
  });
}

// ---------- 订单 ----------
function ordersSignature() {
  return S.orders
    .map((o) => `${o.id}:${o.dept}:${o.kind}:${o.dexId}:${o.type}:${o.minLevel}:${o.needNature}:${o.reward}`)
    .join('|');
}

function ensureOrders() {
  const s = ordersSignature();
  if (s === sig.orders) return;
  sig.orders = s;
  const host = $('#orders');
  if (!S.orders.length) {
    host.innerHTML = `<div class="empty-tip">暂时没有部门需求，稍等。</div>`;
    return;
  }
  host.innerHTML = S.orders
    .map((o) => {
      const kindLabel = o.kind === 'any' ? '任意' : o.kind === 'type' ? typeZh(o.type) : '指定';
      const kindClass = o.kind === 'species' ? 'species' : o.kind === 'type' ? 'type' : '';
      return `<div class="order" id="order-${o.id}">
        <div class="order-top">
          <span class="dept">${L.deptName(o.dept)}</span>
          <span class="kind ${kindClass}">${kindLabel}</span>
          <span class="reward">🪙 ${fmt(o.reward)}</span>
        </div>
        <div class="req">${L.orderRequirementText(o)}</div>
        <div class="order-foot">
          <span id="order-${o.id}-left">剩余 ${Math.max(0, o.deadline - S.day).toFixed(1)} 天</span>
          <div class="bar"><i id="order-${o.id}-bar" style="width:0%"></i></div>
          <div class="order-actions">
            <button id="order-${o.id}-btn" data-act="deliver-open" data-order="${o.id}">交付</button>
            <button class="ghost" data-act="abandon" data-order="${o.id}">放弃</button>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

function patchOrders() {
  $('#order-hint').textContent = `${S.orders.length}/${L.orderSlots(S)} 单 · 声望加成 +${Math.round(S.rep)}%`;
  for (const o of S.orders) {
    const total = Math.max(0.1, o.deadline - o.created);
    const left = Math.max(0, o.deadline - S.day);
    const card = el(`order-${o.id}`);
    const label = el(`order-${o.id}-left`);
    const bar = el(`order-${o.id}-bar`);
    const btn = el(`order-${o.id}-btn`);
    if (card) card.classList.toggle('urgent', left < 2.5);
    setText(label, `剩余 ${left.toFixed(1)} 天`);
    if (bar) setWidth(bar, pct(left, total));
    if (btn) {
      const n = L.deliverableMons(S, o).length;
      btn.disabled = n === 0;
      btn.textContent = n ? `交付 (${n})` : '无匹配';
    }
  }
}

// ---------- 市场 ----------
function shopSignature() {
  return S.market.map((o) => `${o.dexId}:${o.price}`).join('|');
}

function ensureShop() {
  const s = shopSignature();
  if (s === sig.shop) return;
  sig.shop = s;
  const host = $('#shop');
  const marketHtml = S.market
    .map((offer, idx) => {
      const mon = sp(offer.dexId);
      return `<div class="market-item">
        <img src="${sprite(offer.dexId)}"${imgFallback(offer.dexId)} alt="${mon.zh}" />
        <div>
          <div class="m-nm">${mon.zh} 的蛋</div>
          <div class="m-sub">${mon.types.map(typeZh).join('/')} · 孵化 ${L.hatchDays(S, offer.dexId).toFixed(1)} 天</div>
        </div>
        <button id="buy-egg-${idx}" data-act="buy-egg" data-idx="${idx}">🪙 ${fmt(offer.price)}</button>
      </div>`;
    })
    .join('');

  const itemsHtml = [...STONE_ITEMS, 'trade-cable']
    .map((item) => {
      const price = L.ITEM_PRICES[item];
      return `<span class="item-chip">${ITEM_ZH[item]} <b id="inv-${item}">×0</b>
        <button id="buy-item-${item}" data-act="buy-item" data-item="${item}">${fmt(price)}</button>
      </span>`;
    })
    .join('');

  host.innerHTML = `
    <div class="shop-row">
      <span class="lab">🍒 树果单价</span>
      <span class="val" id="berry-price" style="color:var(--green)">—</span>
      <span style="margin-left:auto"></span>
      <button id="buy-berry-1" data-act="buy-berries" data-qty="1">买 1</button>
      <button id="buy-berry-5" data-act="buy-berries" data-qty="5">买 5</button>
    </div>
    <div class="section-title" style="margin:2px 0 4px">蛋市场</div>
    <div class="market-list">${marketHtml || '<div class="empty-tip">今天的蛋卖完了，明天再来。</div>'}</div>
    <div class="section-title" style="margin:10px 0 4px">进化道具</div>
    <div class="items">${itemsHtml}</div>`;
}

function patchShop() {
  setText(el('berry-price'), `${S.berryPrice.toFixed(1)} 资金`);
  const b1 = el('buy-berry-1');
  const b5 = el('buy-berry-5');
  if (b1) b1.disabled = S.gold < S.berryPrice;
  if (b5) b5.disabled = S.gold < S.berryPrice * 5;
  S.market.forEach((offer, idx) => {
    const btn = el(`buy-egg-${idx}`);
    if (btn) btn.disabled = S.gold < offer.price;
  });
  for (const item of [...STONE_ITEMS, 'trade-cable']) {
    setText(el(`inv-${item}`), `×${S.inventory[item] || 0}`);
    const btn = el(`buy-item-${item}`);
    if (btn) btn.disabled = S.gold < L.ITEM_PRICES[item];
  }
  $('#market-hint').textContent = `树果 ${S.berryPrice.toFixed(1)} 资金`;
}

// ---------- 设施 ----------
function upgradesSignature() {
  return `${S.pens.length}:${S.upgrades.incubator}:${S.upgrades.feeder}:${S.upgrades.advertising}:${S.upgrades.training}`;
}

function ensureUpgrades() {
  const s = upgradesSignature();
  if (s === sig.upgrades) return;
  sig.upgrades = s;
  $('#upgrades').innerHTML = Object.entries(L.UPGRADE_INFO)
    .map(([key, info]) => {
      const lvl = key === 'pens' ? S.pens.length : S.upgrades[key];
      const cost = L.upgradeCost(S, key);
      const maxed = cost == null;
      return `<div class="upgrade">
        <div class="u-name">${info.name}<small>Lv.${lvl}/${info.max}</small></div>
        <button id="upg-${key}" data-act="upgrade" data-key="${key}" ${maxed ? 'disabled' : ''}>
          ${maxed ? '已满级' : `升级 🪙 ${fmt(cost)}`}
        </button>
        <div class="u-desc">${info.desc}</div>
      </div>`;
    })
    .join('');
}

function patchUpgrades() {
  for (const key of Object.keys(L.UPGRADE_INFO)) {
    const btn = el(`upg-${key}`);
    const cost = L.upgradeCost(S, key);
    if (btn) btn.disabled = cost == null || S.gold < cost;
  }
}

// ---------- 日志 ----------
function renderLog() {
  const key = `${logs.length}:${logs[logs.length - 1]?.msg || ''}`;
  if (key === sig.log) return;
  sig.log = key;
  $('#log').innerHTML = logs
    .slice(-6)
    .reverse()
    .map((l) => `<span class="entry ${l.type}"><span class="d">D${l.day}</span>${l.msg}</span>`)
    .join('');
}

// ---------- 弹窗 ----------
function openModal(type, data = {}) {
  modal = { type, ...data };
  renderModal();
  const root = $('#modal');
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal = null;
  const root = $('#modal');
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '';
}

function modalShell(title, body, extra = '') {
  return `<div class="modal-card">
    <div class="modal-head"><h3>${title}</h3>${extra}<button class="ghost close" data-act="close">关闭</button></div>
    ${body}
  </div>`;
}

function renderModal() {
  const root = $('#modal');
  if (!root || !modal) return;
  if (modal.type === 'mon') root.innerHTML = monModalHtml(modal.uid);
  else if (modal.type === 'picker') root.innerHTML = pickerModalHtml(modal.pen, modal.slot);
  else if (modal.type === 'deliver') root.innerHTML = deliverModalHtml(modal.orderId);
  else if (modal.type === 'labexp') root.innerHTML = labExpModalHtml(modal.uid);
  else if (modal.type === 'labpicker') root.innerHTML = labPickerModalHtml(modal.slot);
  else if (modal.type === 'labconfirm') root.innerHTML = labConfirmModalHtml(modal.slot, modal.uid);
  else if (modal.type === 'release') root.innerHTML = releaseModalHtml(modal.uid);
  else if (modal.type === 'dex') root.innerHTML = dexModalHtml();
  else if (modal.type === 'help') root.innerHTML = helpModalHtml();
  else if (modal.type === 'win') root.innerHTML = winModalHtml();
  else if (modal.type === 'reset') root.innerHTML = resetModalHtml();
}

function monModalHtml(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经被交付或卖出。</p>');
  const s = sp(mon.dexId);
  const nat = natureById(mon.nature);
  const need = L.expNeeded(mon.level, s.growthRate);
  const st = calcStats(mon);
  const statRows = Object.keys(STAT_ZH)
    .map((k) => `<div class="stat-row"><span>${STAT_ZH[k]}</span><div class="bar"><i style="width:${Math.min(100, (st[k] / 220) * 100)}%"></i></div><b>${st[k]}</b></div>`)
    .join('');
  const ivCells = Object.keys(STAT_ZH)
    .map((k) => {
      const iv = mon.ivs[k];
      const cls = iv >= 24 ? 'good' : iv <= 8 ? 'poor' : '';
      return `<div class="iv-cell ${cls}">
        <div class="iv-lab">${STAT_ZH[k]}</div>
        <div class="iv-bar"><i style="height:${Math.max(6, (iv / 31) * 100)}%"></i></div>
        <div class="iv-val">${iv}</div>
      </div>`;
    })
    .join('');
  const plans = L.evoPlanFor(S, mon);
  const evoHtml = plans.length
    ? plans
        .map((p) => {
          const target = sp(p.toId);
          const cond =
            p.kind === 'level'
              ? `等级 ${p.minLevel}`
              : p.kind === 'item'
              ? `${ITEM_ZH[p.item] || p.item}（库存 ${S.inventory[p.item] || 0}）`
              : `通信电缆（库存 ${S.inventory['trade-cable'] || 0}）`;
          return `<div class="kv" style="align-items:center">
            <span class="k">→ ${target.zh}</span>
            <span class="v" style="font-weight:500;color:var(--muted)">${cond}</span>
            ${p.kind === 'level'
              ? `<span class="tag ${p.ready ? 'ok' : 'no'}" style="margin-left:auto">${p.ready ? '已满足' : `还差 ${Math.max(0, p.minLevel - mon.level)} 级`}</span>`
              : `<button class="mini" style="margin-left:auto" data-act="evolve" data-uid="${mon.uid}" data-to="${p.toId}" ${p.ready ? '' : 'disabled'}>进化</button>`}
          </div>`;
        })
        .join('')
    : '<div class="kv"><span class="k">—</span><span class="v">已达最终形态</span></div>';

  const inPen = L.penIndex(S, mon.uid);
  const inLab = L.labContains(S, mon.uid);
  let penButtons = '';
  if (inLab) {
    penButtons = '';
  } else if (inPen >= 0) {
    penButtons = `<button class="ghost" data-act="unassign" data-uid="${mon.uid}">移出栏位 ${inPen + 1}</button>`;
  } else {
    const slots = [];
    S.pens.forEach((p, i) => {
      if (!p.a) slots.push(`<button class="ghost" data-act="assign" data-pen="${i}" data-slot="a" data-uid="${mon.uid}">放入栏位 ${i + 1}</button>`);
      else if (!p.b) slots.push(`<button class="ghost" data-act="assign" data-pen="${i}" data-slot="b" data-uid="${mon.uid}">放入栏位 ${i + 1}</button>`);
    });
    penButtons = slots.slice(0, 3).join('');
  }

  const labMeta = inLab
    ? `<div class="kv"><span class="k">耐受度</span><span class="v">${Math.max(0, Math.round(mon.tolerance))} / ${L.CONFIG.toleranceBase}</span></div>
       <div class="bar hap" style="max-width:230px"><i style="width:${Math.max(0, Math.min(100, mon.tolerance))}%"></i></div>
       <div class="kv"><span class="k">图鉴研究</span><span class="v">${L.researchPercent(S, mon.dexId)}%</span></div>
       <div class="bar egg" style="max-width:230px"><i style="width:${L.researchPercent(S, mon.dexId)}%"></i></div>
       <div class="kv"><span class="k">状态</span><span class="v" style="color:#ffb3ba">实验中（无法取出）</span></div>`
    : '';

  const actionButtons = inLab
    ? `<button data-act="open-exp" data-uid="${mon.uid}">进行实验</button>
       <button class="ghost danger" data-act="release-mon" data-uid="${mon.uid}">放生</button>`
    : `<button data-act="feed" data-uid="${mon.uid}" ${S.berries <= 0 ? 'disabled' : ''}>喂树果（余 ${S.berries}）</button>
       ${penButtons}
       <button class="ghost danger" data-act="sell" data-uid="${mon.uid}">出售 🪙 ${fmt(L.sellPrice(mon))}</button>`;

  return modalShell(
    s.zh,
    `
    <div class="detail">
      <div class="detail-art"><img src="${art(mon.dexId)}"${imgFallback(mon.dexId)} alt="${s.zh}" /></div>
      <div class="detail-meta">
        <div class="kv"><span class="k">属性</span><span class="v">${typeBadges(s.types)}</span></div>
        <div class="kv"><span class="k">分类</span><span class="v">${s.genus || '—'}</span></div>
        <div class="kv"><span class="k">等级</span><span class="v">Lv.${mon.level} <span style="color:var(--muted);font-weight:400">(${fmt(mon.exp)}/${fmt(need)} 经验)</span></span></div>
        <div class="bar exp" style="max-width:230px"><i style="width:${pct(mon.exp, need)}%"></i></div>
        <div class="kv"><span class="k">性别</span><span class="v">${L.genderZh(mon.gender)}　性格 ${nat.zh}</span></div>
        <div class="kv"><span class="k">特性</span><span class="v">${mon.ability}</span></div>
        <div class="kv"><span class="k">蛋组</span><span class="v">${eggGroupsZh(s.eggGroups)}</span></div>
        <div class="kv"><span class="k">个体值</span><span class="v">${ivTotal(mon)} / 186</span></div>
        ${labMeta}
      </div>
    </div>

    <div class="section-title">能力值（含个体值与性格修正）</div>
    <div class="stats-grid">${statRows}</div>

    <div class="section-title">个体值明细（0-31）</div>
    <div class="iv-row">${ivCells}</div>

    <div class="section-title">进化路线</div>
    ${evoHtml}

    <div class="actions">
      ${actionButtons}
    </div>`,
    `<span class="hint" style="font-size:11px;color:var(--muted)">${s.zh} #${String(mon.dexId).padStart(3, '0')}</span>`
  );
}

function pickerModalHtml(penIdx, slot) {
  const pen = S.pens[penIdx];
  const body = S.mons
    .filter((m) => !L.labContains(S, m.uid))
    .map((m) => {
      const s = sp(m.dexId);
      const where = L.penIndex(S, m.uid);
      const here = pen && (pen.a === m.uid || pen.b === m.uid);
      return `<button class="pick" data-act="assign" data-pen="${penIdx}" data-slot="${slot}" data-uid="${m.uid}" ${here ? 'disabled' : ''}>
        <img src="${sprite(m.dexId)}"${imgFallback(m.dexId)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}</span>
        <span class="ps">Lv.${m.level} · ${eggGroupsZh(s.eggGroups)}${where >= 0 ? ` · 栏位${where + 1}` : ' · 空闲'}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    `选择宝可梦 → 栏位 ${penIdx + 1}`,
    `<div class="picker-list">${body || '<div class="empty-tip">还没有宝可梦，先去市场买蛋吧。</div>'}</div>`
  );
}

function deliverModalHtml(orderId) {
  const order = S.orders.find((o) => o.id === orderId);
  if (!order) return modalShell('需求已失效', '<p>这个需求可能已经过期了。</p>');
  const cands = L.deliverableMons(S, order);
  const body = cands
    .map((m) => {
      const s = sp(m.dexId);
      return `<button class="pick" data-act="deliver" data-order="${order.id}" data-uid="${m.uid}">
        <img src="${sprite(m.dexId)}"${imgFallback(m.dexId)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}</span>
        <span class="ps">Lv.${m.level} · ${typeZh(s.types[0])} · ${eggGroupsZh(s.eggGroups)}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    '选择交付的宝可梦',
    `<div class="req" style="margin-bottom:10px">${L.orderRequirementText(order)} <span style="margin-left:auto;color:var(--gold)">🪙 ${fmt(order.reward)}</span></div>
     <div class="picker-list">${body || '<div class="empty-tip">目前没有满足条件的宝可梦。</div>'}</div>`
  );
}

function labExpModalHtml(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经被放生了。</p>');
  const s = sp(mon.dexId);
  const rows = L.EXPERIMENTS.map(
    (e) => `<div class="exp-row">
      <div class="exp-info"><b>${e.name}</b><small>${e.desc}</small></div>
      <div class="exp-cost">${e.cost ? `🪙 ${fmt(e.cost)}` : '免费'}</div>
      <button data-act="run-exp" data-uid="${mon.uid}" data-exp="${e.id}" ${S.gold < e.cost ? 'disabled' : ''}>执行</button>
    </div>`
  ).join('');
  return modalShell(
    `对 ${s.zh} 进行实验`,
    `<p class="hint" style="font-size:12px;color:var(--muted);margin-bottom:12px">
       实验的具体影响不会事先显示。耐受度归零，或不足以承受下一次实验时，实验对象会被放生。
     </p>
     <div class="exp-list">${rows}</div>`
  );
}

function labPickerModalHtml(slot) {
  const body = S.mons
    .filter((m) => !L.labContains(S, m.uid) && L.penIndex(S, m.uid) === -1)
    .map((m) => {
      const s = sp(m.dexId);
      return `<button class="pick" data-act="lab-confirm" data-slot="${slot}" data-uid="${m.uid}">
        <img src="${sprite(m.dexId)}"${imgFallback(m.dexId)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}</span>
        <span class="ps">Lv.${m.level} · ${eggGroupsZh(s.eggGroups)}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    `选择实验对象 → 实验台 ${slot + 1}`,
    `<div class="picker-list">${body || '<div class="empty-tip">没有空闲的宝可梦；培育栏里的需要先移出。</div>'}</div>`
  );
}

function labConfirmModalHtml(slot, uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经不在了。</p>');
  const s = sp(mon.dexId);
  return modalShell(
    '确认送入实验室？',
    `<p><b>${s.zh}</b> 一旦进入实验室就<b>无法取出</b>，只能反复实验，直到耐受度耗尽被放生。</p>
     <p style="color:var(--muted);font-size:12px;margin-top:8px">耐受度：${Math.round(mon.tolerance)} / ${L.CONFIG.toleranceBase}</p>
     <div class="actions">
       <button data-act="assign-lab" data-slot="${slot}" data-uid="${uid}" style="border-color:rgba(255,107,122,.5)">确认放入</button>
       <button class="ghost" data-act="close">取消</button>
     </div>`
  );
}

function releaseModalHtml(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经被放生了。</p>');
  return modalShell(
    '确认放生？',
    `<p><b>${sp(mon.dexId).zh}</b> 将被放生，之后无法找回；已有的研究进度会保留。</p>
     <div class="actions">
       <button data-act="confirm-release" data-uid="${uid}" style="border-color:rgba(255,107,122,.5);color:#ffb3ba">确认放生</button>
       <button class="ghost" data-act="close">取消</button>
     </div>`
  );
}

function dexModalHtml() {
  const cells = Object.values(DEX.species)
    .map((s) => {
      const done = L.isResearched(S, s.id);
      const progress = L.researchPercent(S, s.id);
      return `<div class="dex-cell ${done ? '' : 'unseen'}" title="${done ? `${s.zh} · ${s.genus} · ${eggGroupsZh(s.eggGroups)}` : `研究中 ${progress}%`}">
        <img src="${sprite(s.id)}"${imgFallback(s.id)} alt="" />
        <div class="dex-name">${done ? s.zh : '???'}</div>
        <div class="dex-bar"><i style="width:${done ? 100 : progress}%"></i></div>
        <div class="dex-pct">${done ? '完成' : `${progress}%`}</div>
      </div>`;
    })
    .join('');
  return modalShell(`图鉴 ${S.dex.length}/151 · 按研究完成度`, `<div class="dex-grid">${cells}</div>`);
}

function helpModalHtml() {
  return modalShell(
    '玩法说明',
    `<div class="help">
      <p>你是年轻的大木博士，被“请”进火箭队的地下基地：替他们管理与运营抢来的宝可梦，同时偷偷记录每一只的数据，为日后那部图鉴写下第一手说明。</p>
      <ul>
        <li><b>配种</b>：把一雄一雌、蛋组有交集的两只宝可梦放进同一栏位，就会产蛋（蛋组见卡片与详情）。</li>
        <li><b>孵化</b>：蛋在孵化器中倒计时，孵出的永远是该家族的<b>最初形态</b>（猫老大的蛋孵出喵喵）；孵化步数越高的宝可梦越慢，升级孵化器可加速并增加蛋位。</li>
        <li><b>养成</b>：栏位中的宝可梦会持续获得经验，喂树果可加速成长。</li>
        <li><b>实验室</b>：实验台可以研究宝可梦、推进该物种的图鉴条目。<b>放进去就取不出来了</b>，只能继续实验，直到耐受度耗尽被放生；实验具体影响不会事先显示，只标资金消耗。</li>
        <li><b>进化</b>：升级自动进化；石之进化与通信进化需要在详情页手动触发（消耗道具）。</li>
        <li><b>部门需求</b>：后勤部、研究部、警卫队、通讯部、走私组、外勤组会提出需求，分任意 / 属性 / 指定物种三类；按时交付可得资金与声望，过期扣声望。</li>
        <li><b>经营</b>：资金用于买蛋、树果、进化石与设施。每天市场会刷新，部门需求物种的蛋更容易出现。</li>
      </ul>
      <p><b>胜利条件</b>：151 个物种的图鉴研究全部完成。</p>
      <p style="color:var(--muted);font-size:12px">数据来自 PokeAPI。存档保存在浏览器本地。</p>
    </div>`
  );
}

function winModalHtml() {
  const st = S.stats || {};
  return modalShell(
    '🏆 图鉴完成',
    `<div class="help">
      <p>151 只宝可梦全部记录在案。你合上笔记本——这些数据，迟早会变成那部图鉴里的说明文字。</p>
      <div class="stats-grid" style="margin:12px 0">
        <div class="kv"><span class="k">达成天数</span><span class="v">第 ${S.wonDay ?? Math.floor(S.day)} 天</span></div>
        <div class="kv"><span class="k">累计收入</span><span class="v">🪙 ${fmt(st.earned || 0)}</span></div>
        <div class="kv"><span class="k">完成需求</span><span class="v">${st.delivered || 0} 单</span></div>
        <div class="kv"><span class="k">孵化</span><span class="v">${st.hatched || 0} 枚蛋</span></div>
        <div class="kv"><span class="k">配种</span><span class="v">${st.bred || 0} 次</span></div>
        <div class="kv"><span class="k">实验</span><span class="v">${st.experiments || 0} 次</span></div>
        <div class="kv"><span class="k">放生</span><span class="v">${st.released || 0} 只</span></div>
        <div class="kv"><span class="k">声望</span><span class="v">${Math.round(S.rep)}</span></div>
      </div>
      <div class="actions">
        <button data-act="close">继续经营</button>
      </div>
    </div>`
  );
}

function resetModalHtml() {
  return modalShell(
    '重新开始？',
    `<p>当前进度（第 ${Math.floor(S.day)} 天 · 🪙 ${fmt(S.gold)} · 图鉴 ${S.dex.length}）将被清空，无法恢复。</p>
     <div class="actions">
       <button data-act="confirm-reset" style="border-color:rgba(255,107,122,.5);color:#ffb3ba">确认重开</button>
       <button class="ghost" data-act="close">取消</button>
     </div>`
  );
}
