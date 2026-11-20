// 视图层：增量渲染（结构变化才重建 DOM，其余只更新数值与进度条）
import * as L from './logic.mjs';
import { CONFIG, RANKS, UPGRADE_INFO, ITEM_PRICES, maxTolerance, rankById } from './rules.mjs';
import {
  DEX, sp, art, sprite, remoteSprite, typeZh, typeColor, calcStats, natureById, STAT_ZH,
  ITEM_ZH, STONE_ITEMS, itemIcon,
} from './data.mjs';

const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 耐受度 → 灰度：满耐受度彩色，≤1 完全黑白
function toleranceGray(mon) {
  if (!mon) return 0;
  if (mon.tolerance <= 1) return 1;
  const max = Math.max(1, maxTolerance(mon));
  return Math.max(0, Math.min(1, 1 - mon.tolerance / max));
}
const spriteFilter = (mon) => {
  const parts = [];
  const g = toleranceGray(mon);
  if (g > 0) parts.push(`grayscale(${g.toFixed(3)})`);
  if (mon?.shiny) parts.push('drop-shadow(0 0 6px rgba(255,215,106,.95))');
  return parts.length ? ` style="filter:${parts.join(' ')}"` : '';
};
const applyToleranceFilter = (img, mon) => {
  if (!img) return;
  const parts = [];
  const g = toleranceGray(mon);
  if (g > 0) parts.push(`grayscale(${g.toFixed(3)})`);
  if (mon?.shiny) parts.push('drop-shadow(0 0 6px rgba(255,215,106,.95))');
  img.style.filter = parts.join(' ');
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const monNo = (m) => (m?.no ? `#${String(m.no).padStart(4, '0')}` : '');
const monNoTag = (m) => (monNo(m) ? `<span class="mon-no">${monNo(m)}</span>` : '');
const researchedCls = (m) => (m && L.isResearched(S, m.dexId) ? ' researched' : '');
const pct = (v, max) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (v / max) * 100)));
const imgFallback = (id, shiny = false) => {
  // 闪光图加载失败时退回本地普通图；普通图失败时退回远程普通图。
  const fallback = shiny ? `data/sprites/${Number(id)}.png` : remoteSprite(Number(id));
  return ` onerror="this.onerror=null;this.src='${fallback}'"`;
};
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
let pendingExp = null;
let experimentLoading = true;
let loadingOverrideMs = null;

export function setExperimentLoading(enabled = true, overrideMs = null) {
  experimentLoading = !!enabled;
  loadingOverrideMs = overrideMs == null ? null : Number(overrideMs);
}

// 底部 TAB：培育 / 实验室 / 围栏 / 经营 / 研究笔记
const TABS = ['pens', 'lab', 'idle', 'market', 'dex'];
let activeTab = 'pens';
// 围栏分段开关：培育相关 / 其它
let idleSection = 'related';

// 结构签名：只有签名变化时才重建对应区域的 DOM，避免 hover 状态被反复重置
const sig = {
  pens: null,
  eggs: null,
  lab: null,
  idle: null,
  orders: null,
  shop: null,
  upgrades: null,
  log: null,
  dex: null,
  heroPens: null,
  heroLab: null,
  heroIdle: null,
};

export function mount(state, options) {
  S = state;
  hooks = options || {};
  seedLogs(state);
  resetSignatures();
  bind();
  render();
  renderTabs();
}

export function setState(next) {
  S = next;
  idleSection = 'related';
  resetSignatures();
  activeTab = 'pens';
  seedLogs(next);
  if (pendingExp?.timer) clearInterval(pendingExp.timer);
  pendingExp = null;
  closeModal();
  render();
  renderTabs();
}

function resetSignatures() {
  sig.pens = sig.eggs = sig.lab = sig.idle = sig.orders = sig.shop = sig.upgrades = sig.log = null;
  sig.dex = sig.heroPens = sig.heroLab = sig.heroIdle = null;
}

// ---------- TAB 切换 ----------
function renderTabs() {
  for (const t of TABS) {
    const page = el(`page-${t}`);
    const btn = el(`tab-${t}`);
    if (page) page.classList.toggle('active', t === activeTab);
    if (btn) {
      btn.classList.toggle('active', t === activeTab);
      btn.setAttribute('aria-selected', t === activeTab ? 'true' : 'false');
    }
  }
}

function setTab(tab) {
  const next = TABS.includes(tab) ? tab : 'pens';
  if (next === activeTab) {
    renderTabs();
    return;
  }
  activeTab = next;
  renderTabs();
  const main = el('main');
  if (main && typeof main.scrollTo === 'function') main.scrollTo({ top: 0, behavior: 'smooth' });
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

// 日志：内存里只留最近 40 条用于渲染，同时写进 state.log 以便刷新后回播。
// state.log 里还有逻辑层写的内部记录（订单过期），回播时过滤掉。
const LOG_LIMIT = 40;
const LOG_STORE_LIMIT = 200;

function seedLogs(state) {
  const entries = Array.isArray(state?.log) ? state.log.filter((e) => e && e.type !== 'expire') : [];
  logs = entries.slice(-LOG_LIMIT);
}

export function pushLog(msg, type = 'info') {
  const entry = { day: Math.floor(S.day), msg, type };
  logs.push(entry);
  if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
  if (!Array.isArray(S.log)) S.log = [];
  S.log.push({ ...entry });
  if (S.log.length > LOG_STORE_LIMIT) S.log.splice(0, S.log.length - LOG_STORE_LIMIT);
}

export function handleEvents(events) {
  const warned = [];
  const rest = [];
  for (const e of events) {
    if (e.type === 'level' || e.type === 'expire') continue;
    pushLog(e.msg, e.type);
    if (e.type === 'win') {
      toast(e.msg, 'good');
      openModal('win');
      continue;
    }
    if (e.type === 'egg' && Number.isInteger(e.pen)) playPenLove(e.pen);
    if ((e.fight || e.exhausted) && Number.isInteger(e.pen)) playPenClash(e.pen);
    (e.type === 'warn' ? warned : rest).push(e);
  }
  // 坏消息优先占 toast 名额：同一 tick 里可能同时产蛋、孵化、死人
  let important = 0;
  for (const e of [...warned, ...rest]) {
    if (important >= 2) break;
    if (e.type !== 'warn' && e.type !== 'evolve' && e.type !== 'egg' && e.type !== 'research') continue;
    // 孵化只在“值得被看见”时弹：首次该物种 / 虚弱 / 不孕 / 闪光。其余只进日志。
    const hatchEvent = e.type === 'egg' && !Number.isInteger(e.pen);
    if (hatchEvent && !e.special) continue;
    toast(e.msg, e.type === 'warn' ? 'bad' : 'good');
    important++;
  }
}

// 蛋组知识的展示 key：知识变化时需要重建卡片
const knownKey = (dexId) => L.knownEggGroups(S, dexId).join(',');

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
    case 'quit':
      openModal(S.quit ? 'quitdone' : 'quit');
      break;
    case 'confirm-quit': {
      const r = L.quitGame(S);
      toast(r.msg, 'bad');
      openModal('quitdone');
      render();
      break;
    }
    case 'new-game':
      closeModal();
      hooks.onReset?.();
      break;
    case 'open-help':
      openModal('help');
      break;
    case 'open-menu':
      openModal('menu');
      break;
    case 'tab':
      setTab(d.tab);
      break;
    case 'open-dex':
      setTab('dex');
      break;
    case 'open-ranks':
      openModal('ranks');
      break;
    case 'promote': {
      const r = L.promote(S);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) {
        if (r.win) {
          handleEvents([r.win]);
        } else {
          openModal('ranks');
        }
      }
      render();
      break;
    }
    case 'close':
      closeModal();
      break;
    case 'open-mon':
      openModal('mon', { uid: d.uid });
      break;
    case 'open-species':
      openModal('species', { id: Number(d.id) });
      break;
    case 'open-picker':
      openModal('picker', { pen: Number(d.pen), slot: d.slot });
      break;
    case 'open-pen-lab':
      openModal('penlab', { uid: d.uid });
      break;
    case 'pen-to-lab': {
      const r = L.sendPenToLab(S, d.uid, Number(d.slot));
      toast(r.msg, r.ok ? 'good' : 'bad');
      closeModal();
      render();
      break;
    }
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
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'process-pen-corpse': {
      const r = L.processPenCorpse(S, Number(d.pen), d.slot);
      toast(r.msg, r.ok ? 'good' : 'bad');
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
    case 'assign-lab': {
      // 不再二次确认：选中即送入（选择弹窗里已写明不可取出）
      const r = L.assignLab(S, Number(d.slot), d.uid);
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
      render();
      break;
    }
    case 'open-exp':
      openExperimentFor(d.uid);
      break;
    case 'run-exp': {
      beginExperiment(d.uid, d.exp);
      break;
    }
    case 'idle-section': {
      const next = d.section === 'others' ? 'others' : 'related';
      if (next !== idleSection) {
        idleSection = next;
        sig.idle = null;
      }
      render();
      break;
    }
    case 'process-idle-corpse': {
      const r = L.processIdleCorpse(S, Number(d.index));
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'process-lab': {
      const r = L.processLabSlot(S, Number(d.slot));
      toast(r.msg, r.ok ? 'good' : 'bad');
      if (r.ok) closeModal();
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
    case 'reroll-market': {
      const r = L.rerollMarket(S);
      toast(r.msg, r.ok ? 'good' : 'bad');
      render();
      break;
    }
    case 'buy-candy': {
      const r = L.buyCandies(S, Number(d.qty));
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
    default:
      break;
  }
}

// ---------- 渲染入口 ----------
export function render() {
  if (!S) return;
  renderTop();
  ensureHeroes();
  patchHeroText();
  ensurePens();
  patchPens();
  ensureEggs();
  patchEggs();
  ensureLab();
  patchLab();
  ensureIdle();
  patchIdle();
  ensureOrders();
  patchOrders();
  ensureShop();
  patchShop();
  ensureUpgrades();
  patchUpgrades();
  ensureDexPage();
  patchDexHero();
  renderLog();
  patchLabExpModal();
}

function renderTop() {
  setText(el('gold'), fmt(S.gold));
  setText(el('candies'), String(S.candies));
  setText(el('rep'), String(Math.round(S.rep)));
  setText(el('rank'), L.currentRank(S).name);
  setText(el('dex'), `${S.dex.length}/151`);
  setText(el('day'), String(Math.floor(S.day)));
  document.querySelectorAll('#speeds button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === speed);
  });
  const banner = el('win-banner');
  if (banner) {
    banner.textContent =
      S.winKind === 'rank'
        ? `🏆 这条路走到这里：${L.currentRank(S).name}`
        : '🏆 这条路走到这里：研究笔记完成';
    banner.classList.toggle('hidden', !S.won);
  }
  const quitBanner = el('quit-banner');
  if (quitBanner) quitBanner.classList.toggle('hidden', !S.quit);
}

// ---------- 顶部美术：每页的角色/内容缩影 ----------
function uniqueHeroMons(mons) {
  const out = [];
  const seen = new Set();
  for (const m of mons) {
    if (!m || seen.has(m.dexId)) continue;
    seen.add(m.dexId);
    out.push(m);
  }
  return out;
}

function heroArtHtml(mons, emptyEmoji) {
  if (!mons.length) return `<span class="hero-empty">${emptyEmoji}</span>`;
  return mons
    .slice(0, 4)
    .map((m) => `<img src="${sprite(m.dexId, m.shiny)}"${imgFallback(m.dexId, m.shiny)} alt="" />`)
    .join('');
}

function ensureHeroes() {
  const penMons = uniqueHeroMons(L.penMons(S));
  const penSig = penMons.map((m) => `${m.dexId}:${m.shiny ? 1 : 0}`).join(',');
  if (penSig !== sig.heroPens) {
    sig.heroPens = penSig;
    const host = el('hero-art-pens');
    if (host) host.innerHTML = heroArtHtml(penMons, '🥚');
  }

  const labMons = uniqueHeroMons(S.lab.map((slot) => L.monByUid(S, slot.uid)).filter(Boolean));
  const labSig = labMons.map((m) => `${m.dexId}:${m.shiny ? 1 : 0}`).join(',');
  if (labSig !== sig.heroLab) {
    sig.heroLab = labSig;
    const host = el('hero-art-lab');
    if (host) host.innerHTML = heroArtHtml(labMons, '🧪');
  }

  const idleMons = uniqueHeroMons(L.idleMons(S));
  const idleSig = idleMons.slice(0, 4).map((m) => `${m.dexId}:${m.shiny ? 1 : 0}`).join(',') + `:${idleMons.length}`;
  if (idleSig !== sig.heroIdle) {
    sig.heroIdle = idleSig;
    const host = el('hero-art-idle');
    if (host) host.innerHTML = heroArtHtml(idleMons, '🏕');
  }
}

function patchHeroText() {
  const filled = L.labOccupied(S);
  const idleCount = L.idleMons(S).length;
  const conflicts = L.idleConflicts(S).length;
  setText(el('hero-sub-pens'), `${S.pens.length} 个栏位 · ${S.eggs.length}/${L.eggSlots(S)} 枚蛋`);
  setText(el('hero-sub-lab'), `${filled}/${S.lab.length} 个实验台`);
  setText(el('hero-sub-idle'), `${idleCount} 只闲置${conflicts ? ` · ${conflicts} 组霸凌` : ''}`);
  setText(el('hero-sub-market'), `${L.deliverableOrders(S).length} 单可交付`);
  setText(el('hero-sub-dex'), `已完成 ${S.dex.length}/${DEX.count}`);
}

function patchDexHero() {
  const pct = Math.round((S.dex.length / Math.max(1, DEX.count)) * 100);
  const ring = el('dex-ring');
  if (ring) {
    const bg = `conic-gradient(#f5c451 ${pct}%, rgba(31, 47, 74, 0.85) 0)`;
    if (ring.style.background !== bg) ring.style.background = bg;
  }
  setText(el('dex-ring-text'), `${S.dex.length}/${DEX.count}`);
}

function typeBadges(types) {
  return types.map((t) => `<span class="type" style="--c:${typeColor(t)}">${typeZh(t)}</span>`).join('');
}

function statRowHtml(key, value, unlocked, iv = null) {
  if (!unlocked) {
    return `<div class="stat-row locked"><span>${STAT_ZH[key]}</span><div class="bar"><i style="width:0%"></i></div><b>？？？</b></div>`;
  }
  const ivTag = iv == null ? '' : `<em class="iv">IV ${iv}</em>`;
  return `<div class="stat-row"><span>${STAT_ZH[key]}</span><div class="bar"><i style="width:${Math.min(100, (value / 220) * 100)}%"></i></div><b>${value}${ivTag}</b></div>`;
}

// ---------- 培育栏 ----------
function pensSignature() {
  // 卡片上不再显示蛋组知识，签名也就无需包含 knownKey
  const key = (m) => (m ? `${m.uid}:${m.dexId}` : '-');
  const corpseKey = (c) => (c ? `c${c.dexId}:${c.no ?? ''}` : '-');
  const fails = (S.failedPairs || []).join(',');
  return (
    S.pens
      .map((p) => `${key(L.monByUid(S, p.a))}|${key(L.monByUid(S, p.b))}|${corpseKey(p.aCorpse)}|${corpseKey(p.bCorpse)}`)
      .join(';') + '|' + fails
  );
}

function ensurePens() {
  const s = pensSignature();
  if (s === sig.pens) return;
  sig.pens = s;
  const slotHtml = (mon, corpse, pen, slot) => {
    if (corpse) return corpseSlotHtml(corpse, pen, slot);
    return mon ? monSlotHtml(mon, pen, slot) : emptySlotHtml(pen, slot);
  };
  $('#pens').innerHTML = S.pens
    .map((pen, i) => {
      const a = L.monByUid(S, pen.a);
      const b = L.monByUid(S, pen.b);
      return `<div class="pen" id="pen-${i}">
        <div class="pen-head"><span>栏位 ${i + 1}</span></div>
        <div class="slots">
          ${slotHtml(a, pen.aCorpse, i, 'a')}
          ${slotHtml(b, pen.bCorpse, i, 'b')}
        </div>
        <div class="pen-warn hidden" id="pen-${i}-warn"></div>
        <div class="breed" id="pen-${i}-breed" style="display:none">
          <span>繁育</span>
          <div class="bar"><i id="pen-${i}-breedbar" style="width:0%"></i></div>
          <span class="pct" id="pen-${i}-breedpct">0%</span>
        </div>
      </div>`;
    })
    .join('');
}

// 培育栏里的遗体：占住这个位置，处理掉才能放新的
function corpseSlotHtml(corpse, pen, slot) {
  const s = sp(corpse.dexId);
  const cost = CONFIG.penCorpseProcessCost;
  return `<div class="slot dead" id="pen-${pen}-${slot}">
    <div class="corpse-mark">💀</div>
    <div class="nm">${s.zh} 的遗体</div>
    <div class="sub">Lv.${corpse.level} ${L.genderZh(corpse.gender)}</div>
    <button class="mini" data-act="process-pen-corpse" data-pen="${pen}" data-slot="${slot}">处理 🪙 ${cost}</button>
  </div>`;
}

// 培育栏卡片只留“不做决定就会做错”的几项：立绘、物种、性别、等级、特殊标记。
// 蛋组只在“选谁放进栏位”时有用，因此移进选择器；属性徽章与经验条与繁育无关，删掉。
function monSlotHtml(mon, pen, slot) {
  const s = sp(mon.dexId);
  return `<div class="slot filled ${mon.shiny ? 'shiny' : ''}${researchedCls(mon)}" id="pen-${pen}-${slot}" data-act="open-mon" data-uid="${mon.uid}" title="查看详情">
    ${monNoTag(mon)}
    <img id="pen-${pen}-${slot}-img" src="${sprite(mon.dexId, mon.shiny)}"${imgFallback(mon.dexId, mon.shiny)}${spriteFilter(mon)} alt="${s.zh}" />
    <div class="nm">${s.zh}<span class="g">${L.genderZh(mon.gender)}</span>${mon.shiny ? '<span class="shiny-badge">✨</span>' : ''}</div>
    <div class="lv" id="pen-${pen}-${slot}-lv">Lv.${mon.level}</div>
    ${L.sterilityLabel(mon) ? `<div class="sterile-badge">${L.sterilityLabel(mon)}</div>` : ''}
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

    // 状态口径统一走 logic：只有「注定配不成」的情况才会提前说明；
    // 会争斗的配对一律显示为正常积累——博士只能靠试。
    const st = a && b ? L.penStatus(S, pen) : { kind: 'idle' };

    const warn = el(`pen-${i}-warn`);
    if (warn) {
      let text = '';
      if (st.kind === 'waiting-egg') {
        text = '孵化器已满，繁育暂停';
      } else if (st.kind === 'locked') {
        text = st.reason;
      } else if (st.kind === 'sterile' || st.kind === 'quiet') {
        text = st.reason;
      }
      const key = `${st.kind}|${text}`;
      if (warn.dataset.key !== key) {
        warn.dataset.key = key;
        warn.textContent = text;
      }
      warn.classList.toggle('hidden', !text);
    }

    const breed = el(`pen-${i}-breed`);
    if (breed) {
      const running = st.kind === 'breeding' || st.kind === 'waiting-egg';
      const paused = st.kind === 'locked' || st.kind === 'sterile' || st.kind === 'quiet';
      breed.style.display = running || paused ? 'flex' : 'none';
      breed.classList.toggle('paused', paused);
      if (running) {
        const p = st.kind === 'waiting-egg' ? 100 : pct(pen.breed, CONFIG.breedDays);
        setWidth(el(`pen-${i}-breedbar`), p);
        setText(el(`pen-${i}-breedpct`), `${p.toFixed(0)}%`);
      } else if (paused) {
        setWidth(el(`pen-${i}-breedbar`), 0);
        setText(el(`pen-${i}-breedpct`), '0%');
      }
    }
  });

  const maxPens = UPGRADE_INFO.pens.max;
  $('#pen-hint').textContent = `${S.pens.length}/${maxPens} 个栏位`;
}

function patchSlot(mon, pen, slot) {
  if (!mon) return;
  setText(el(`pen-${pen}-${slot}-lv`), `Lv.${mon.level}`);
  applyToleranceFilter(el(`pen-${pen}-${slot}-img`), mon);
  // 研究完成会改变卡片底色，这里实时切换，不再等结构签名变化
  const card = el(`pen-${pen}-${slot}`);
  if (card) card.classList.toggle('researched', L.isResearched(S, mon.dexId));
}

function playPenEffect(index, kind) {
  const pen = el(`pen-${index}`);
  if (!pen) return;
  pen.classList.remove('love');
  pen.classList.remove('clash');
  void pen.offsetWidth;
  pen.classList.add(kind);
  setTimeout(() => pen.classList.remove(kind), 1000);
}

function playPenLove(index) {
  playPenEffect(index, 'love');
}

function playPenClash(index) {
  playPenEffect(index, 'clash');
}

// ---------- 孵化器 ----------
function eggsSignature() {
  return S.eggs.map((e) => `${e.uid}:${e.dexId}:${e.total}:${knownKey(e.dexId)}`).join('|');
}

function ensureEggs() {
  const s = eggsSignature();
  if (s === sig.eggs) return;
  sig.eggs = s;
  const host = $('#eggs');
  if (!S.eggs.length) {
    host.innerHTML = `<div class="empty-tip">孵化器空闲。到蛋贩子那里买蛋，或把两只宝可梦放进同一栏位试试繁育。</div>`;
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
            <div class="egg-grp">蛋组 ${L.eggGroupsDisplay(S, egg.dexId)}</div>
            <div class="sub" id="egg-${egg.uid}-left">孵化中 · ${egg.daysLeft.toFixed(1)} 天</div>
          </div>
        </div>
        <div class="bar hatch"><i id="egg-${egg.uid}-bar" style="width:0%"></i></div>
      </div>`;
    })
    .join('');
}

function patchEggs() {
  const full = S.eggs.length >= L.eggSlots(S);
  $('#egg-hint').textContent = `${S.eggs.length}/${L.eggSlots(S)} 枚蛋${full ? ' · 已满，繁育会暂停' : ''}`;
  for (const egg of S.eggs) {
    setText(el(`egg-${egg.uid}-left`), `孵化中 · ${Math.max(0, egg.daysLeft).toFixed(1)} 天`);
    setWidth(el(`egg-${egg.uid}-bar`), pct(egg.total - egg.daysLeft, egg.total));
  }
}

// ---------- 实验室 ----------
function labSignature() {
  const key = (slot) => {
    if (slot.uid) {
      const m = L.monByUid(S, slot.uid);
      return m ? `m:${m.uid}:${m.dexId}:${knownKey(m.dexId)}` : 'm:?';
    }
    if (slot.corpse) return `c:${slot.corpse.dexId}:${slot.corpse.level}:${slot.corpse.day}`;
    return '-';
  };
  return `${S.lab.length}:` + S.lab.map(key).join('|');
}

function ensureLab() {
  const s = labSignature();
  if (s === sig.lab) return;
  sig.lab = s;
  const host = $('#lab');
  host.innerHTML = S.lab
    .map((slot, i) => {
      if (slot.corpse) {
        const c = slot.corpse;
        const spc = sp(c.dexId);
        return `<div class="lab-card dead" id="lab-${i}">
          <div class="lab-head">
            <img src="${sprite(c.dexId)}"${imgFallback(c.dexId)} style="filter:grayscale(1) brightness(0.45)" alt="${spc.zh}" />
            <div>
              <div class="nm">${spc.zh}</div>
              <div class="lv">Lv.${c.level} · 已死亡</div>
            </div>
          </div>
          <div class="lab-note dead">实验对象已死亡，遗体占用实验台；处理后可重新使用。</div>
          <div class="lab-actions">
            <button class="ghost danger" data-act="process-lab" data-slot="${i}" id="lab-${i}-process">处理 🪙 ${L.labProcessCost(S, i)}</button>
          </div>
        </div>`;
      }
      const mon = L.monByUid(S, slot.uid);
      if (!mon) {
        return `<button class="slot empty lab-empty" data-act="open-lab-picker" data-slot="${i}">＋<br />放入实验对象</button>`;
      }
      const spc = sp(mon.dexId);
      const done = L.isResearched(S, mon.dexId);
      return `<div class="lab-card ${mon.shiny ? 'shiny' : ''}${researchedCls(mon)}" id="lab-${i}">
        ${monNoTag(mon)}
        <div class="lab-head">
          <img id="lab-${i}-img" src="${sprite(mon.dexId, mon.shiny)}"${imgFallback(mon.dexId, mon.shiny)}${spriteFilter(mon)} alt="${spc.zh}" />
          <div>
            <div class="nm">${spc.zh}${mon.shiny ? '<span class="shiny-badge">✨</span>' : ''}</div>
            <div class="lv">Lv.${mon.level} · ${L.eggGroupsDisplay(S, mon.dexId)}${L.sterilityLabel(mon) ? ` · ${L.sterilityLabel(mon)}` : ''}</div>
          </div>
        </div>
        <div class="lab-stat"><span>耐受度</span><b id="lab-${i}-tol">${Math.round(mon.tolerance)} / ${maxTolerance(mon)}</b></div>
        <div class="bar hap" style="width:100%"><i id="lab-${i}-tolbar" style="width:0%"></i></div>
        <div class="lab-stat"><span>研究进度</span><b id="lab-${i}-res">${L.researchPercent(S, mon.dexId)}%</b></div>
        <div class="bar study" style="width:100%"><i id="lab-${i}-resbar" style="width:0%"></i></div>
        ${done ? '<div class="lab-note">研究已完成 · 只剩最伤身的那种实验</div>' : ''}
        <div class="lab-actions">
          <button class="mini" data-act="open-exp" data-uid="${mon.uid}">实验</button>
          <button class="ghost danger" data-act="process-lab" data-slot="${i}" id="lab-${i}-process" title="处理（不可撤销，费用随剩余耐受度变化）">处理 🪙 ${L.labProcessCost(S, i)}</button>
        </div>
      </div>`;
    })
    .join('');
}

function patchLab() {
  const filled = L.labOccupied(S);
  $('#lab-hint').textContent = `${filled}/${S.lab.length} 个实验台`;
  S.lab.forEach((slot, i) => {
    const processBtn = el(`lab-${i}-process`);
    if (processBtn) setText(processBtn, `处理 🪙 ${L.labProcessCost(S, i)}`);
    const mon = L.monByUid(S, slot.uid);
    if (!mon) return;
    const max = Math.max(1, maxTolerance(mon));
    const tol = Math.max(0, Math.round(mon.tolerance));
    setText(el(`lab-${i}-tol`), `${tol} / ${max}`);
    setWidth(el(`lab-${i}-tolbar`), Math.max(0, Math.min(100, (tol / max) * 100)));
    const pctRes = L.researchPercent(S, mon.dexId);
    setText(el(`lab-${i}-res`), `${pctRes}%`);
    setWidth(el(`lab-${i}-resbar`), pctRes);
    applyToleranceFilter(el(`lab-${i}-img`), mon);
    const card = el(`lab-${i}`);
    if (card) card.classList.toggle('researched', L.isResearched(S, mon.dexId));
  });
}

function experimentDuration(exp) {
  if (loadingOverrideMs != null) return Math.max(1, loadingOverrideMs);
  if (exp.id === 'measure') return 900;
  if (exp.id === 'sample') return 1400;
  if (exp.id === 'battle') return 2000;
  if (exp.tier === 'harsh') return 2000;
  if (exp.tier === 'standard') return 1400;
  return 900;
}

function openExperimentFor(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return toast('找不到宝可梦', 'bad');
  openModal('labexp', { uid });
}

function beginExperiment(uid, expId) {
  if (pendingExp) return;
  const mon = L.monByUid(S, uid);
  if (!mon) return toast('找不到宝可梦', 'bad');
  const exp = L.experimentsFor(mon.dexId).find((e) => e.id === expId);
  if (!exp) return toast('没有这个实验', 'bad');
  const snapshot = { no: mon.no, dexId: mon.dexId, level: mon.level, name: sp(mon.dexId).zh };
  if (!experimentLoading) {
    completeExperiment(uid, expId, snapshot, exp);
    return;
  }
  pendingExp = {
    uid,
    expId,
    expName: exp.name,
    desc: exp.desc,
    duration: experimentDuration(exp),
    start: Date.now(),
    snapshot,
    timer: null,
  };
  openModal('labexp', { uid });
  pendingExp.timer = setInterval(updateExperimentLoading, 50);
  updateExperimentLoading();
}

function updateExperimentLoading() {
  if (!pendingExp) return;
  const pct = Math.min(100, ((Date.now() - pendingExp.start) / pendingExp.duration) * 100);
  setWidth(el('exp-progress'), pct);
  if (pct >= 100) {
    const { uid, expId, snapshot } = pendingExp;
    const mon = L.monByUid(S, uid);
    const exp = mon ? L.experimentsFor(mon.dexId).find((e) => e.id === expId) : null;
    clearInterval(pendingExp.timer);
    pendingExp = null;
    if (!exp) {
      toast('实验对象已不在实验室', 'bad');
      render();
      openModal('labexp', { uid });
      return;
    }
    completeExperiment(uid, expId, snapshot, exp);
  }
}

function completeExperiment(uid, expId, snapshot, exp) {
  if (pendingExp?.timer) clearInterval(pendingExp.timer);
  pendingExp = null;
  const r = L.startExperiment(S, uid, expId);
  if (!r.ok) {
    toast(r.msg, 'bad');
    openModal('labexp', { uid });
    render();
    return;
  }
  if (r.events) handleEvents(r.events);
  const won = r.events?.some((e) => e.type === 'win');
  if (!r.released) playLabHit(uid, r.intensity);
  render();
  if (won) return;
  if (!r.released) {
    closeModal();
    toast(r.msg, 'good');
    return;
  }
  openModal('expresult', {
    uid,
    expId,
    expName: exp.name,
    mon: snapshot,
    result: r.result,
    corpseSlot: r.corpseSlot,
  });
}

function playLabHit(uid, intensity = 0.5) {
  const idx = S.lab.findIndex((slot) => slot.uid === uid);
  if (idx < 0) return;
  const card = el(`lab-${idx}`);
  if (!card) return;
  const v = Math.max(0.15, Math.min(1, Number(intensity) || 0.5));
  if (card.style?.setProperty) card.style.setProperty('--hit', v.toFixed(2));
  else if (card.style) card.style['--hit'] = v.toFixed(2);
  card.classList.remove('experiment-hit');
  void card.offsetWidth;
  card.classList.add('experiment-hit');
  setTimeout(() => card.classList.remove('experiment-hit'), 1000);
}

// ---------- 围栏（不在培育栏、也不在实验室的闲置宝可梦） ----------
// 用开关在「培育相关」与「其它」之间切换；遗体单独一栏，始终显示。
function idleSignature() {
  const mons = L.idleMons(S)
    .map((m) => `${m.uid}:${m.dexId}:${knownKey(m.dexId)}`)
    .join('|');
  const corpses = (S.idleCorpses || []).map((c, i) => `${i}:${c.no}:${c.dexId}:${c.level}`).join(',');
  const related = [...L.idleSections(S).relatedIds].sort((a, b) => a - b).join(',');
  return `${mons}|c:${corpses}|r:${related}|s:${idleSection}`;
}

function idleMonCard(m, bullyUids) {
  const spc = sp(m.dexId);
  const fighting = bullyUids.has(m.uid);
  return `<div class="idle-mon${fighting ? ' fighting' : ''}${m.shiny ? ' shiny' : ''}${researchedCls(m)}" id="idle-${m.uid}" data-act="open-mon" data-uid="${m.uid}" title="查看详情">
    ${monNoTag(m)}
    <img id="idle-${m.uid}-img" src="${sprite(m.dexId, m.shiny)}"${imgFallback(m.dexId, m.shiny)}${spriteFilter(m)} alt="${spc.zh}" />
    <div class="n">${spc.zh}<span class="g">${L.genderZh(m.gender)}</span>${m.shiny ? '<span class="shiny-badge">✨</span>' : ''}</div>
    <div class="lv" id="idle-${m.uid}-lv">Lv.${m.level}</div>
    <div class="egg-grp">${L.eggGroupsDisplay(S, m.dexId)}</div>
    ${L.sterilityLabel(m) ? `<div class="sterile-badge">${L.sterilityLabel(m)}</div>` : ''}
  </div>`;
}

function ensureIdle() {
  const s = idleSignature();
  if (s === sig.idle) return;
  sig.idle = s;
  const host = $('#idle');
  if (!host) return;
  const { related, others } = L.idleSections(S);
  const corpses = S.idleCorpses || [];
  const bullyUids = new Set(L.idleConflicts(S).map((c) => c.weakestUid));
  if (!related.length && !others.length && !corpses.length) {
    host.innerHTML = '<div class="empty-tip">围栏是空的——所有宝可梦都在培育栏或实验室里。</div>';
    return;
  }
  const sec = (key, list) =>
    `<div class="idle-sec${idleSection === key ? '' : ' hidden'}" data-sec="${key}">${
      list.length ? list.map((m) => idleMonCard(m, bullyUids)).join('') : '<div class="empty-tip">这一段还没有宝可梦。</div>'
    }</div>`;
  const corpseHtml = corpses
    .map((c, i) => {
      const spc = sp(c.dexId);
      return `<div class="idle-mon dead" id="idle-corpse-${i}">
        ${monNoTag(c)}
        <img src="${sprite(c.dexId)}"${imgFallback(c.dexId)} style="filter:grayscale(1) brightness(0.45)" alt="${spc.zh}" />
        <div class="n">${spc.zh}<span class="g">${L.genderZh(c.gender)}</span></div>
        <div class="lv">Lv.${c.level} · 已死亡</div>
        <div class="egg-grp">被同类霸凌致死，遗体待处理</div>
        <button class="ghost danger" data-act="process-idle-corpse" data-index="${i}">处理 🪙 ${CONFIG.idleCorpseProcessCost}</button>
      </div>`;
    })
    .join('');
  host.innerHTML =
    sec('related', related) +
    sec('others', others) +
    (corpses.length
      ? `<div class="idle-sec" data-sec="corpse"><div class="idle-sec-title">遗体<span>${corpses.length} 具待处理</span></div>${corpseHtml}</div>`
      : '');
}

function patchIdle() {
  const { related, others } = L.idleSections(S);
  const corpses = S.idleCorpses || [];
  const conflicts = L.idleConflicts(S);

  const tabRelated = el('idle-tab-related');
  if (tabRelated) {
    setText(tabRelated, `培育相关（${related.length}）`);
    tabRelated.classList.toggle('on', idleSection === 'related');
  }
  const tabOthers = el('idle-tab-others');
  if (tabOthers) {
    setText(tabOthers, `其它（${others.length}）`);
    tabOthers.classList.toggle('on', idleSection === 'others');
  }

  const hint = $('#idle-hint');
  if (hint) {
    const extra = conflicts.length ? ` · ${conflicts.length} 组霸凌` : ' · 不参与繁育与研究';
    hint.textContent = `${related.length + others.length} 只闲置${corpses.length ? ` · 遗体 ${corpses.length} 具` : ''}${extra}`;
  }
  const bullyUids = new Set(conflicts.map((c) => c.weakestUid));
  for (const m of [...related, ...others]) {
    setText(el(`idle-${m.uid}-lv`), `Lv.${m.level}`);
    applyToleranceFilter(el(`idle-${m.uid}-img`), m);
    const card = el(`idle-${m.uid}`);
    if (card) {
      card.classList.toggle('fighting', bullyUids.has(m.uid));
      card.classList.toggle('researched', L.isResearched(S, m.dexId));
    }
  }

  // 同种同性达到 4 只后，最弱的那只会被霸凌
  const alert = el('idle-alert');
  if (alert) {
    const shown = conflicts
      .slice(0, 4)
      .map((c) => `${sp(c.dexId).zh}${L.genderZh(c.gender)}×${c.count}`)
      .join('、');
    const more = conflicts.length > 4 ? ` 等 ${conflicts.length} 组` : '';
    const text = conflicts.length
      ? `⚠️ 同种同性超过 3 只，最弱的个体正在被霸凌，耐受度持续下降：${shown}${more}（移走一只即可停止）`
      : '';
    setText(alert, text);
    alert.classList.toggle('hidden', !text);
  }

  // 底栏“围栏”红点：正在被霸凌的个体数
  const badge = el('badge-idle');
  if (badge) {
    const bullied = conflicts.length;
    badge.textContent = String(bullied);
    badge.classList.toggle('hidden', bullied === 0);
  }
}

// ---------- 订单 ----------
function ordersSignature() {
  return S.orders
    .map(
      (o) =>
        `${o.id}:${o.dept}:${o.kind}:${o.dexId}:${o.type}:${o.minLevel}:${o.needNature}:${o.reward}:${o.repGain ?? 4}:${o.repLoss ?? 2}`
    )
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
      const isBoard = o.dept === 'board';
      return `<div class="order ${isBoard ? 'board' : ''}" id="order-${o.id}">
        ${isBoard ? '<div class="board-banner"><span class="board-crown">♛</span><span>总裁办直令</span><span class="board-important">重要</span></div>' : ''}
        <div class="order-top">
          <span class="dept ${isBoard ? 'board' : ''}">${L.deptName(o.dept)}</span>
          <span class="kind ${kindClass}">${kindLabel}</span>
          <span class="reward">🪙 ${fmt(o.reward)}</span>
        </div>
        <div class="req">${L.orderRequirementText(o)}
          <span class="rep-delta">声望 +${o.repGain ?? 4}</span>
        </div>
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
  const decay = L.repDecay(S);
  const decayNode = el('rep-decay');
  if (decayNode) {
    const show = decay.active && S.rep > 0 && !S.quit;
    decayNode.classList.toggle('hidden', !show);
    if (show) {
      decayNode.textContent = `⏳ 已 ${decay.idleDays.toFixed(1)} 天没有完成部门需求，声望正在流失 -${decay.rate.toFixed(1)}/天`;
    }
  }
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

  // 底栏“经营”红点：有多少单现在就能交
  const badge = el('badge-market');
  if (badge) {
    const ready = L.deliverableOrders(S).length;
    badge.textContent = String(ready);
    badge.classList.toggle('hidden', ready === 0);
  }
}

// ---------- 蛋贩子 ----------
function shopSignature() {
  return S.market.map((o) => `${o.dexId}:${o.price}:${o.source || ''}:${knownKey(o.dexId)}`).join('|');
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
          <div class="m-sub">蛋组 ${L.eggGroupsDisplay(S, offer.dexId)}</div>
          <div class="m-sub">来源：${offer.source || '来路不明'}</div>
        </div>
        <button id="buy-egg-${idx}" data-act="buy-egg" data-idx="${idx}">🪙 ${fmt(offer.price)}</button>
      </div>`;
    })
    .join('');

  const itemsHtml = [...STONE_ITEMS, 'trade-cable']
    .map((item) => {
      const price = ITEM_PRICES[item];
      return `<span class="item-chip">
        ${itemIcon(item, 18)}
        <span class="i-name">${ITEM_ZH[item]}</span>
        <b id="inv-${item}">×0</b>
        <button id="buy-item-${item}" data-act="buy-item" data-item="${item}">🪙 ${fmt(price)}</button>
      </span>`;
    })
    .join('');

  host.innerHTML = `
    <div class="shop-row">
      <span class="lab">🍬 经验糖果</span>
      <span class="val" id="candy-price" style="color:var(--green)">—</span>
      <span class="store" id="candy-stock">持有 0</span>
      <span style="margin-left:auto"></span>
      <button id="buy-candy-1" data-act="buy-candy" data-qty="1">买 1</button>
      <button id="buy-candy-5" data-act="buy-candy" data-qty="5">买 5</button>
    </div>
    <div class="section-title" style="margin:2px 0 4px">蛋贩子</div>
    <div class="market-list">${marketHtml || '<div class="empty-tip">蛋贩子手上暂时没货了，花钱让他再跑一趟。</div>'}</div>
    <div class="market-reroll">
      <span class="hint">每两周（14 天）自动换货；换一批费用会逐次上涨，等待会回落。</span>
      <button id="reroll-market" data-act="reroll-market">换一批 🪙 ${fmt(L.marketRerollCost(S))}</button>
    </div>
    <div class="section-title" style="margin:10px 0 4px">进化道具</div>
    <div class="items">${itemsHtml}</div>`;
}

function patchShop() {
  setText(el('candy-price'), `${S.candyPrice.toFixed(1)} 资金`);
  setText(el('candy-stock'), `持有 ${S.candies}`);
  const b1 = el('buy-candy-1');
  const b5 = el('buy-candy-5');
  if (b1) b1.disabled = S.gold < S.candyPrice;
  if (b5) b5.disabled = S.gold < S.candyPrice * 5;
  S.market.forEach((offer, idx) => {
    const btn = el(`buy-egg-${idx}`);
    // 蛋位满了买回去也没处放，直接禁用
    if (btn) btn.disabled = S.gold < offer.price || S.eggs.length >= L.eggSlots(S);
  });
  const reroll = el('reroll-market');
  if (reroll) {
    const rerollCost = L.marketRerollCost(S);
    reroll.disabled = S.gold < rerollCost;
    setText(reroll, `换一批 🪙 ${fmt(rerollCost)}`);
  }
  for (const item of [...STONE_ITEMS, 'trade-cable']) {
    setText(el(`inv-${item}`), `×${S.inventory[item] || 0}`);
    const btn = el(`buy-item-${item}`);
    if (btn) btn.disabled = S.gold < ITEM_PRICES[item];
  }
  $('#market-hint').textContent = `经验糖果 ${S.candyPrice.toFixed(1)} 资金`;
}

// ---------- 设施 ----------
function upgradesSignature() {
  return [
    S.pens.length,
    S.lab.length,
    S.rank ?? 0,
    S.upgrades.incubator,
    S.upgrades.advertising,
    S.upgrades.training,
  ].join(':');
}

function ensureUpgrades() {
  const s = upgradesSignature();
  if (s === sig.upgrades) return;
  sig.upgrades = s;
  $('#upgrades').innerHTML = Object.entries(UPGRADE_INFO)
    .map(([key, info]) => {
      const lvl = key === 'pens' ? S.pens.length : key === 'lab' ? S.lab.length : S.upgrades[key];
      const cost = L.upgradeCost(S, key);
      const maxed = cost == null;
      const needRank = L.upgradeRankReq(S, key);
      const rankLocked = (S.rank ?? 0) < needRank;
      const label = maxed ? '已满级' : rankLocked ? `需 ${rankById(needRank).name}` : `升级 🪙 ${fmt(cost)}`;
      return `<div class="upgrade ${rankLocked ? 'locked' : ''}">
        <div class="u-name">${info.name}<small>Lv.${lvl}/${info.max}</small></div>
        <button id="upg-${key}" data-act="upgrade" data-key="${key}" ${maxed || rankLocked ? 'disabled' : ''}>${label}</button>
        <div class="u-desc">${info.desc}${rankLocked ? ` · 需职级 ${rankById(needRank).name}` : ''}</div>
      </div>`;
    })
    .join('');
}

function patchUpgrades() {
  for (const key of Object.keys(UPGRADE_INFO)) {
    const btn = el(`upg-${key}`);
    const cost = L.upgradeCost(S, key);
    const rankLocked = (S.rank ?? 0) < L.upgradeRankReq(S, key);
    if (btn) btn.disabled = cost == null || rankLocked || S.gold < cost;
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
  if (pendingExp) return;
  modal = null;
  const root = $('#modal');
  if (!root) return;
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
  else if (modal.type === 'species') root.innerHTML = speciesModalHtml(modal.id);
  else if (modal.type === 'picker') root.innerHTML = pickerModalHtml(modal.pen, modal.slot);
  else if (modal.type === 'penlab') root.innerHTML = penLabPickerModalHtml(modal.uid);
  else if (modal.type === 'deliver') root.innerHTML = deliverModalHtml(modal.orderId);
  else if (modal.type === 'labexp') root.innerHTML = labExpModalHtml(modal.uid);
  else if (modal.type === 'expresult') root.innerHTML = expResultModalHtml();
  else if (modal.type === 'labpicker') root.innerHTML = labPickerModalHtml(modal.slot);
  else if (modal.type === 'ranks') root.innerHTML = ranksModalHtml();
  else if (modal.type === 'menu') root.innerHTML = menuModalHtml();
  else if (modal.type === 'help') root.innerHTML = helpModalHtml();
  else if (modal.type === 'win') root.innerHTML = winModalHtml();
  else if (modal.type === 'quit') root.innerHTML = quitModalHtml();
  else if (modal.type === 'quitdone') root.innerHTML = quitDoneModalHtml();
}

function monModalHtml(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经被交付或卖出。</p>');
  const s = sp(mon.dexId);
  const nat = natureById(mon.nature);
  const need = L.expNeeded(mon.level, s.growthRate);
  const st = calcStats(mon);
  const revealed = new Set(L.revealedStats(S, mon.dexId));
  // 研究 100% 之后，天赋不再需要猜——直接给出六项个体值
  const known = L.isResearched(S, mon.dexId);
  const statRows = Object.keys(STAT_ZH)
    .map((k) => statRowHtml(k, st[k], revealed.has(k), known ? mon.ivs?.[k] ?? 0 : null))
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
              ? `${itemIcon(p.item, 13)} ${ITEM_ZH[p.item] || p.item}（库存 ${S.inventory[p.item] || 0}）`
              : `${itemIcon('trade-cable', 13)} 通信电缆（库存 ${S.inventory['trade-cable'] || 0}）`;
          return `<div class="kv" style="align-items:center">
            <span class="k">→ ${target.zh}</span>
            <span class="v" style="font-weight:500;color:var(--muted);display:flex;align-items:center;gap:4px">${cond}</span>
            ${p.kind === 'level'
              ? `<span class="tag ${p.ready ? 'ok' : 'no'}" style="margin-left:auto">${p.ready ? '已满足' : `还差 ${Math.max(0, p.minLevel - mon.level)} 级`}</span>`
              : `<button class="mini" style="margin-left:auto" data-act="evolve" data-uid="${mon.uid}" data-to="${p.toId}" ${p.ready ? '' : 'disabled'}>进化</button>`}
          </div>`;
        })
        .join('')
    : '<div class="kv"><span class="k">—</span><span class="v">已达最终形态</span></div>';

  const inPen = L.penIndex(S, mon.uid);
  const inLab = L.labContains(S, mon.uid);
  // 围栏里的个体不再给“放入栏位”快捷按钮：统一从培育栏空位的「放入宝可梦」进入
  const penButtons =
    !inLab && inPen >= 0
      ? `<button class="ghost" data-act="open-pen-lab" data-uid="${mon.uid}">放入实验室</button>
         <button class="ghost" data-act="unassign" data-uid="${mon.uid}">扔回围栏</button>`
      : '';
  const idleHint =
    !inLab && inPen < 0
      ? '<div class="hint-line">要放进培育栏：点培育栏空位的「放入宝可梦」。</div>'
      : '';

  // 耐受度只在进实验室后才展示
  const tolMax = Math.max(1, maxTolerance(mon));
  const tolNow = Math.max(0, Math.round(mon.tolerance));
  const labMeta = inLab
    ? `<div class="kv"><span class="k">耐受度</span><span class="v">${tolNow} / ${tolMax}</span></div>
       <div class="bar hap" style="max-width:230px"><i style="width:${Math.max(0, Math.min(100, (tolNow / tolMax) * 100))}%"></i></div>
       <div class="kv"><span class="k">研究进度</span><span class="v">${L.researchPercent(S, mon.dexId)}%</span></div>
       <div class="bar study" style="max-width:230px"><i style="width:${L.researchPercent(S, mon.dexId)}%"></i></div>
       <div class="kv"><span class="k">状态</span><span class="v" style="color:#ffb3ba">实验中（只能处理）</span></div>`
    : '';

  const labIdx = inLab ? S.lab.findIndex((slot) => slot.uid === mon.uid) : -1;
  const labCost = inLab ? L.labProcessCost(S, labIdx) : 0;
  const actionButtons = inLab
    ? `<button data-act="open-exp" data-uid="${mon.uid}">进行实验</button>
       <button class="ghost danger" data-act="process-lab" data-slot="${labIdx}" title="处理（不可撤销，费用随剩余耐受度变化）">处理 🪙 ${fmt(labCost)}</button>`
    : `<button data-act="feed" data-uid="${mon.uid}" ${S.candies <= 0 ? 'disabled' : ''}>喂经验糖果（余 ${S.candies}）</button>
       ${penButtons}
       <button class="ghost danger" data-act="sell" data-uid="${mon.uid}">出售 🪙 ${fmt(L.sellPrice(mon))}</button>`;

  return modalShell(
    s.zh,
    `
    <div class="detail">
      <div class="detail-art"><img src="${art(mon.dexId, mon.shiny)}"${imgFallback(mon.dexId, mon.shiny)}${spriteFilter(mon)} alt="${s.zh}" /></div>
      <div class="detail-meta">
        <div class="kv"><span class="k">编号</span><span class="v" style="font-variant-numeric:tabular-nums">${monNo(mon) || '未编号'}</span></div>
        <div class="kv"><span class="k">属性</span><span class="v">${typeBadges(s.types)}</span></div>
        <div class="kv"><span class="k">等级</span><span class="v">Lv.${mon.level} <span style="color:var(--muted);font-weight:400">(${fmt(mon.exp)}/${fmt(need)} 经验)</span></span></div>
        <div class="bar exp" style="max-width:230px"><i style="width:${pct(mon.exp, need)}%"></i></div>
        <div class="kv"><span class="k">性别</span><span class="v">${L.genderZh(mon.gender)}　性格 ${nat.zh}</span></div>
        ${mon.shiny ? '<div class="kv"><span class="k">闪光</span><span class="v" style="color:#ffd76a">✨ 是</span></div>' : ''}
        ${L.sterilityLabel(mon) ? `<div class="kv"><span class="k">生育</span><span class="v" style="color:#ffb3ba">${L.sterilityLabel(mon)}</span></div>` : ''}
        <div class="kv"><span class="k">蛋组</span><span class="v">${L.eggGroupsDisplay(S, mon.dexId)}</span></div>
        ${mon.inbred ? `<div class="kv"><span class="k">血缘</span><span class="v" style="color:#ffb3ba">近亲后代 · 第 ${mon.gen} 代</span></div>` : ''}
        ${labMeta}
      </div>
    </div>

    <div class="section-title">能力值</div>
    <div class="stats-grid">${statRows}</div>

    <div class="section-title">进化路线</div>
    ${evoHtml}

    <div class="actions">
      ${actionButtons}
    </div>
    ${idleHint}`,
    `<span class="hint" style="font-size:11px;color:var(--muted)">${s.zh} #${String(mon.dexId).padStart(3, '0')}</span>`
  );
}

// 研究笔记物种详情：研究笔记描述只在研究完成后揭晓（描述是研究产出的“条目”）
function speciesModalHtml(dexId) {
  const s = sp(dexId);
  if (!s) return modalShell('未知物种', '<div class="empty-tip">没有这个物种的数据。</div>');
  const known = L.researchProgress(S, dexId) > 0;
  const done = L.isResearched(S, dexId);
  const percent = L.researchPercent(S, dexId);
  const rec = L.dexRecord(S, dexId);
  const lost = rec?.lost ?? L.researchLostCount(S, dexId);
  const flavor = typeof s.flavor === 'string' ? s.flavor.trim() : '';
  const name = known ? esc(s.zh) : '???';
  const revealed = new Set(L.revealedStats(S, dexId));
  const statRows = Object.keys(STAT_ZH)
    .map((k) => statRowHtml(k, s.stats?.[k] ?? 0, revealed.has(k)))
    .join('');
  const spend = S.speciesSpend?.[dexId] || { exp: 0, corpse: 0 };
  return modalShell(
    `${name} <span style="color:var(--muted);font-size:12px">#${String(dexId).padStart(3, '0')}</span>`,
    `<div class="species-card">
      <div class="species-art ${done ? '' : 'gray'}"><img src="${art(dexId)}"${imgFallback(dexId)} alt="" /></div>
      <div class="species-meta">
        <div class="kv"><span class="k">属性</span><span class="v">${known ? typeBadges(s.types) : '???'}</span></div>
        <div class="kv"><span class="k">研究进度</span><span class="v">${done ? '完成' : `${percent}%`}</span></div>
        <div class="bar study" style="max-width:230px"><i style="width:${done ? 100 : percent}%"></i></div>
        <div class="kv"><span class="k">研究损耗</span><span class="v">${lost} 只</span></div>
        <div class="kv"><span class="k">研究成本</span><span class="v">🪙 ${fmt(spend.exp + spend.corpse)}</span></div>
        ${done && rec ? `<div class="kv"><span class="k">完成于</span><span class="v">第 ${rec.day} 天</span></div>` : ''}
      </div>
    </div>
    <div class="kv" style="margin-top:6px"><span class="k">蛋组</span><span class="v">${L.eggGroupsDisplay(S, dexId)}</span></div>
    <div class="section-title">种族值</div>
    <div class="stats-grid">${statRows}</div>
    <div class="section-title">研究笔记描述</div>
    ${
      done
        ? `<p class="flavor">${esc(flavor || '（这条研究笔记还没有留下描述。）')}</p>`
        : `<p class="flavor locked">完成「${name}」的研究后，这里会补上你写下的描述。</p>`
    }
    <div class="section-title">实验日志</div>
    <div class="exp-journal">${expJournalRowsHtml(dexId, 10)}</div>`,
    `<span class="hint" style="font-size:11px;color:var(--muted)">研究笔记 #${String(dexId).padStart(3, '0')}</span>`
  );
}

// 实验日志：同一个体（编号）的多条记录在视觉上合并成一组，
// 组头只出现一次编号/物种/等级；组内同一天的连续实验只显示一次日期。
function expJournalRowsHtml(dexId = null, limit = 50) {
  const entries = (S.expJournal || []).filter((e) => dexId == null || e.dexId === dexId).slice(0, limit);
  if (!entries.length) return '<div class="empty-tip">还没有实验日志。</div>';

  const groups = [];
  const byNo = new Map();
  for (const e of entries) {
    const key = e.no == null ? 'none' : String(e.no);
    let g = byNo.get(key);
    if (!g) {
      g = { no: e.no, dexId: e.dexId, level: e.level, rows: [] };
      byNo.set(key, g);
      groups.push(g);
    }
    g.rows.push(e);
  }

  const rowHtml = (e, showDate) => {
    const name = sp(e.dexId)?.zh || e.dexId;
    const exp = L.experimentsFor(e.dexId).find((x) => x.id === e.expId);
    const act = e.expId === 'process' || e.cause === 'processed'
      ? '实验对象被「处理」了'
      : exp?.desc
        ? esc(exp.desc)
        : esc(e.expName);
    return `<div class="exp-journal-row ${e.survived ? 'alive' : 'dead'}${e.completed ? ' completed' : ''}">
      <span class="d">${showDate ? `D${e.day}` : ''}</span>
      <span class="act">${act}</span>
      ${!e.survived && !['process', 'lab-death', 'bully-death'].includes(e.expId) ? '<span class="exp-journal-death">实验结束后对象死亡</span>' : ''}
      ${e.completed ? `<span class="complete">对${name}的研究完成了</span>` : ''}
    </div>`;
  };

  return groups
    .map((g) => {
      const name = sp(g.dexId)?.zh || g.dexId;
      const noText = g.no == null ? '未编号' : `#${String(g.no).padStart(4, '0')}`;
      return `<div class="exp-journal-group">
        <div class="exp-journal-head">
          <span class="no">${noText}</span>
          <span class="nm">${name}</span>
          <span class="lv">Lv.${g.level}</span>
          <span class="cnt">${g.rows.length} 次</span>
        </div>
        ${g.rows
          .map((e, i) => rowHtml(e, i === 0 || g.rows[i - 1].day !== e.day))
          .join('')}
      </div>`;
    })
    .join('');
}

function pickerModalHtml(penIdx, slot) {
  const pen = S.pens[penIdx];
  const other = L.monByUid(S, slot === 'a' ? pen?.b : pen?.a);
  const blocked = other ? L.failedPartners(S, other.dexId) : new Set();
  const body = S.mons
    .filter((m) => !L.labContains(S, m.uid) && L.penIndex(S, m.uid) === -1)
    .map((m) => {
      const s = sp(m.dexId);
      const isBlocked = !!other && m.dexId !== other.dexId && blocked.has(m.dexId);
      // 近亲：血统层面的提示；蛋组高亮：只用“已识别”的蛋组，不揭示未知
      const kin = !!other && L.isKin(other, m);
      const eggMatch = !!other && L.sharesKnownEggGroup(S, other.dexId, m.dexId);
      const card = `<button class="pick${isBlocked ? ' blocked' : ''}${researchedCls(m)}${eggMatch ? ' egg-match' : ''}" data-act="assign" data-pen="${penIdx}" data-slot="${slot}" data-uid="${m.uid}" ${isBlocked ? 'disabled' : ''}>
        ${monNoTag(m)}
        <img src="${sprite(m.dexId, m.shiny)}"${imgFallback(m.dexId, m.shiny)}${spriteFilter(m)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}${m.shiny ? ' ✨' : ''}${kin ? '<span class="kin-badge">近亲</span>' : ''}</span>
        <span class="ps">Lv.${m.level} · ${L.eggGroupsDisplay(S, m.dexId)}${L.sterilityLabel(m) ? ` · ${L.sterilityLabel(m)}` : ''}</span>
      </button>`;
      return card;
    })
    .join('');
  return modalShell(
    `选择宝可梦 → 栏位 ${penIdx + 1}${other ? `（与 ${sp(other.dexId).zh} 配对）` : ''}`,
    `<div class="picker-list">${body || '<div class="empty-tip">没有空闲的宝可梦；实验室里的和已在其他栏位的都不能放入。</div>'}</div>`
  );
}

// 从培育栏直接送进实验室：只列实验台（空位可选，占用/遗体禁用）
function penLabPickerModalHtml(uid) {
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经被交付或卖出。</p>');
  const rows = S.lab
    .map((slot, i) => {
      const occupant = L.monByUid(S, slot.uid);
      const busy = !!slot.uid || !!slot.corpse;
      const label = occupant
        ? `已被 ${sp(occupant.dexId).zh} 占用`
        : slot.corpse
          ? `有遗体（${sp(slot.corpse.dexId).zh}），需先处理`
          : '空位';
      return `<button class="ghost slot-row" data-act="pen-to-lab" data-uid="${uid}" data-slot="${i}" ${busy ? 'disabled' : ''}>
        <b>实验台 ${i + 1}</b><span>${label}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    `把 ${sp(mon.dexId).zh} 送进实验室`,
    `<p class="hint" style="font-size:12px;color:#ffb3ba;margin-bottom:10px">进去后就取不出来了，只能实验或处理。</p>
     <div class="slot-list">${rows}</div>`
  );
}

function deliverModalHtml(orderId) {
  const order = S.orders.find((o) => o.id === orderId);
  if (!order) return modalShell('需求已失效', '<p>这个需求可能已经过期了。</p>');
  const cands = L.deliverableMons(S, order);
  const body = cands
    .map((m) => {
      const s = sp(m.dexId);
      return `<button class="pick${researchedCls(m)}" data-act="deliver" data-order="${order.id}" data-uid="${m.uid}">
        ${monNoTag(m)}
        <img src="${sprite(m.dexId, m.shiny)}"${imgFallback(m.dexId, m.shiny)}${spriteFilter(m)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}${m.shiny ? ' ✨' : ''}</span>
        <span class="ps">Lv.${m.level} · ${typeZh(s.types[0])} · ${L.eggGroupsDisplay(S, m.dexId)}${L.sterilityLabel(m) ? ` · ${L.sterilityLabel(m)}` : ''}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    '选择交付的宝可梦',
    `<div class="req" style="margin-bottom:10px">${L.orderRequirementText(order)}
       <span style="margin-left:auto;display:flex;align-items:center;gap:10px">
         <span style="color:var(--violet)">声望 +${order.repGain ?? 4}</span>
         <span style="color:var(--gold)">🪙 ${fmt(order.reward)}</span>
       </span>
     </div>
     <div class="picker-list">${body || '<div class="empty-tip">目前没有满足条件的宝可梦。</div>'}</div>`
  );
}

function labExpModalHtml(uid) {
  if (pendingExp && pendingExp.uid === uid) {
    return `<div class="modal-card">
      <div class="modal-head"><h3>正在 ${pendingExp.expName}……</h3></div>
      <div class="exp-loading">
        <div class="exp-loading-icon">🧪</div>
        <p class="exp-loading-desc">${esc(pendingExp.desc)}</p>
        <div class="bar exp-loadbar"><i id="exp-progress" style="width:0%"></i></div>
      </div>
    </div>`;
  }
  const mon = L.monByUid(S, uid);
  if (!mon) return modalShell('找不到宝可梦', '<p>它可能已经不在了。</p>');
  const s = sp(mon.dexId);
  const options = L.experimentOptions(S, mon);
  const locked = options.some((e) => e.locked);
  const expLog = S.expLog?.[mon.dexId] || {};
  const isRecorded = (id) => (expLog[id] || 0) > 0;
  const rows = options
    .map((e) => {
      const cd = L.experimentCooldownFor(S, mon, e.id);
      const disabled = e.locked || S.gold < e.cost || cd > 0;
      const label = e.locked ? '不可用' : cd > 0 ? '冷却中' : '执行';
      const recorded = isRecorded(e.id);
      const cls = [e.locked ? 'locked' : '', cd > 0 ? 'cooling' : '', recorded ? 'recorded' : ''].filter(Boolean).join(' ');
      return `<div class="exp-row ${cls}" id="exp-row-${e.id}">
        <div class="exp-info"><b>${e.name}</b>${recorded ? '<span class="exp-recorded-tag">已记录</span>' : ''}</div>
        <div class="exp-cost">
          <span>${e.cost ? `🪙 ${fmt(e.cost)}` : '免费'}</span>
          <span class="exp-cd" id="exp-cd-${e.id}">${cd > 0 ? `冷却 ${Math.ceil(cd)} 秒` : ''}</span>
        </div>
        <button id="exp-run-${e.id}" data-act="run-exp" data-uid="${mon.uid}" data-exp="${e.id}" ${disabled ? 'disabled' : ''}>${label}</button>
      </div>`;
    })
    .join('');
  const progressHint = locked
    ? ''
    : `<p class="hint">研究进度 ${L.researchPercent(S, mon.dexId)}%</p>`;
  const note = locked
    ? `<p class="hint" style="font-size:12px;color:#ffb3ba;margin-bottom:10px">该物种的研究已经完成。现在只有最伤身的那一种实验还能记录到新数据，其余行为不再可用；<b>也不再受冷却限制</b>。</p>`
    : `<p class="hint" style="font-size:12px;color:var(--muted);margin-bottom:12px">
        实验的具体影响不会事先显示。耐受度归零，或不足以承受下一次实验时，实验对象会死亡并留下遗体，占用实验台；处理遗体需要花金币。每种实验都有冷却，越深入冷却越久。
      </p>`;
  return modalShell(`对 ${s.zh} 进行实验`, `${progressHint}${note}<div class="exp-list">${rows}</div>`);
}

function expResultModalHtml() {
  const survived = modal.result?.survived !== false;
  const mon = modal.mon || {};
  const slot = modal.corpseSlot;
  const corpseCost = !survived && Number.isInteger(slot) ? L.labProcessCost(S, slot) : 0;
  return modalShell(
    '实验结束',
    `<div class="exp-result ${survived ? 'alive' : 'dead'}">
      <div class="exp-result-meta">#${String(mon.no ?? '—').padStart(4, '0')} ${esc(mon.name || '实验对象')} Lv.${mon.level ?? '—'} · ${esc(modal.expName || '实验')}</div>
      ${!survived ? '<div class="exp-result-death">实验结束后对象死亡。</div>' : ''}
      ${!survived && Number.isInteger(slot) ? `<div class="exp-result-note">遗体仍占用实验台，处理后才能放入新的实验对象。</div>` : ''}
      ${
        !survived && Number.isInteger(slot)
          ? `<div class="actions"><button class="ghost danger" data-act="process-lab" data-slot="${slot}">处理遗体 🪙 ${fmt(corpseCost)}</button></div>`
          : ''
      }
    </div>`
  );
}

// 实验弹窗里的冷却倒计时只做局部更新，不重建整个弹窗（避免按钮 hover 被打断）
function patchLabExpModal() {
  if (!modal || modal.type !== 'labexp' || !S || pendingExp) return;
  const mon = L.monByUid(S, modal.uid);
  if (!mon) return;
  const expLog = S.expLog?.[mon.dexId] || {};
  for (const e of L.experimentOptions(S, mon)) {
    const cd = L.experimentCooldownFor(S, mon, e.id);
    const cdNode = el(`exp-cd-${e.id}`);
    if (cdNode) setText(cdNode, cd > 0 ? `冷却 ${Math.ceil(cd)} 秒` : '');
    const btn = el(`exp-run-${e.id}`);
    if (btn) {
      btn.disabled = e.locked || S.gold < e.cost || cd > 0;
      setText(btn, e.locked ? '不可用' : cd > 0 ? '冷却中' : '执行');
    }
    const row = el(`exp-row-${e.id}`);
    if (row) {
      row.classList.toggle('cooling', cd > 0);
      row.classList.toggle('recorded', (expLog[e.id] || 0) > 0);
    }
  }
}

function labPickerModalHtml(slot) {
  const body = S.mons
    .filter((m) => !L.labContains(S, m.uid) && L.penIndex(S, m.uid) === -1)
    .map((m) => {
      const s = sp(m.dexId);
      return `<button class="pick${researchedCls(m)}" data-act="assign-lab" data-slot="${slot}" data-uid="${m.uid}">
        ${monNoTag(m)}
        <img src="${sprite(m.dexId, m.shiny)}"${imgFallback(m.dexId, m.shiny)}${spriteFilter(m)} alt="" />
        <span class="pn">${s.zh} ${L.genderZh(m.gender)}${m.shiny ? ' ✨' : ''}</span>
        <span class="ps">Lv.${m.level} · ${L.eggGroupsDisplay(S, m.dexId)}${L.sterilityLabel(m) ? ` · ${L.sterilityLabel(m)}` : ''}</span>
      </button>`;
    })
    .join('');
  return modalShell(
    `选择实验对象 → 实验台 ${slot + 1}`,
    `<p class="hint" style="font-size:12px;color:#ffb3ba;margin-bottom:10px">选中即送入实验室。进去后就取不出来了，只能实验或处理；处理需要花金币，死亡个体也会占位。</p>
     <div class="picker-list">${body || '<div class="empty-tip">没有空闲的宝可梦；培育栏里的个体可以在它的详情页点「放入实验室」。</div>'}</div>`
  );
}

function dexCellsHtml() {
  return Object.values(DEX.species)
    .map((s) => {
      const done = L.isResearched(S, s.id);
      const progress = L.researchPercent(S, s.id);
      const rec = done ? L.dexRecord(S, s.id) : null;
      const lost = done ? rec?.lost ?? L.researchLostCount(S, s.id) : L.researchLostCount(S, s.id);
      // 用原始进度判断“研究过没有”，避免稀有物种 1 点进度被四舍五入成 0%
      const known = L.researchProgress(S, s.id) > 0;
      const stateClass = done ? 'done' : known ? 'partial' : 'unseen';
      const bits = [];
      if (!known) {
        bits.push('尚未研究');
      } else {
        bits.push(`${s.zh} · 研究 ${progress}%`);
        if (done && rec) bits.push(`完成于第 ${rec.day} 天`);
      }
      const title = bits.join(' · ');
      const attrs = known ? ` data-act="open-species" data-id="${s.id}" role="button" tabindex="0"` : '';
      return `<div class="dex-cell ${stateClass}"${attrs} title="${title}">
        <img src="${sprite(s.id)}"${imgFallback(s.id)} alt="" loading="lazy" decoding="async" />
        <div class="dex-name">${known ? s.zh : '???'}</div>
        <div class="dex-bar"><i style="width:${done ? 100 : progress}%"></i></div>
        <div class="dex-pct">${done ? '完成' : `${progress}%`}${known && lost ? ` · 损${lost}` : ''}</div>
      </div>`;
    })
    .join('');
}

function dexPageSignature() {
  const research = Object.keys(S.research || {})
    .map((k) => `${k}=${S.research[k]}`)
    .join(',');
  const losses = Object.keys(S.researchLoss || {})
    .map((k) => `${k}:${S.researchLoss[k]}`)
    .join(',');
  const recs = Object.keys(S.dexRecords || {})
    .map((k) => `${k}:${S.dexRecords[k]?.day ?? ''}:${S.dexRecords[k]?.lost ?? ''}`)
    .join(',');
  const costSig = `${S.stats?.experimentSpent || 0}:${S.stats?.corpseSpent || 0}`;
  return `${S.dex.join(',')}|${research}|${losses}|${recs}|${costSig}`;
}

function ensureDexPage() {
  const s = dexPageSignature();
  if (s === sig.dex) return;
  sig.dex = s;
  const host = el('dex-page');
  if (!host) return;
  const totalLost = Object.keys(S.dexRecords || {}).reduce((sum, id) => sum + (S.dexRecords[id]?.lost || 0), 0);
  const experimentCost = Math.max(0, Number(S.stats?.experimentSpent) || 0);
  const corpseCost = Math.max(0, Number(S.stats?.corpseSpent) || 0);
  host.innerHTML = `<div class="dex-summary">
      <div class="kv"><span class="k">实验总成本</span><span class="v">🪙 ${fmt(experimentCost + corpseCost)}</span></div>
      <div class="kv"><span class="k">累计损耗</span><span class="v">${totalLost} 只</span></div>
    </div>
    <div class="dex-grid">${dexCellsHtml()}</div>`;
}

function ranksModalHtml() {
  const cur = L.currentRank(S);
  const next = L.nextRank(S);
  const rows = RANKS.map((r) => {
    const owned = (S.rank ?? 0) >= r.id;
    const isNext = (S.rank ?? 0) + 1 === r.id;
    const repOk = S.rep >= r.rep;
    const goldOk = S.gold >= r.cost;
    const cls = owned ? 'owned' : isNext ? 'next' : 'locked';
    const right = owned
      ? '<span class="tag ok">已获得</span>'
      : isNext
      ? `<button class="mini" data-act="promote" ${repOk && goldOk ? '' : 'disabled'}>
           ${repOk ? (goldOk ? `晋升 🪙 ${fmt(r.cost)}` : '资金不足') : `声望需 ${r.rep}`}
         </button>`
      : `<span class="tag no">未解锁</span>`;
    return `<div class="rank-row ${cls}">
      <div class="rank-name">${r.name}<small>声望 ${r.rep} · 🪙 ${fmt(r.cost)}</small></div>
      <div class="rank-desc">${r.desc}</div>
      <div class="rank-act">${right}</div>
    </div>`;
  }).join('');
  const tip = next
    ? `晋升到 ${next.name} 需要声望 ${next.rep}（当前 ${Math.round(S.rep)}）与 ${fmt(next.cost)} 资金。`
    : '你已经在火箭队的顶端了。';
  return modalShell(
    `职级 · ${cur.name}`,
    `<p class="hint" style="font-size:12px;color:var(--muted);margin-bottom:10px">职级决定设施能升到多高。${tip}</p>
     <div class="rank-list">${rows}</div>`
  );
}

function menuModalHtml() {
  return modalShell(
    '菜单',
    `<div class="menu-list">
      <button data-act="open-help">📖 玩法说明</button>
      <button data-act="open-ranks">🎖 职级 · ${L.currentRank(S).name}</button>
      <button data-act="save">💾 保存进度</button>
      <button class="danger" data-act="quit">${S.quit ? '🚪 本局已结束（查看结算）' : '🚪 离开火箭队'}</button>
    </div>`
  );
}

function helpModalHtml() {
  return modalShell(
    '玩法说明',
    `<div class="help">
      <p>你是年轻的大木博士，被“请”进火箭队的地下基地：替他们管理与运营抢来的宝可梦，同时偷偷记录每一只的数据，为日后那本研究笔记写下第一手说明。</p>
      <ul>
        <li><b>繁育</b>：栏位里放两只就会积累繁育条。条满时如果条件正常（一雄一雌、蛋组交叠）就会产蛋，母体因此损耗耐受度（低等级母体大约撑 4 只后代，等级越高越耐用；<b>最后一胎仍会产下，然后力竭而死</b>）；没有雌性时由<b>百变怪</b>承担损耗，雄性不掉耐受度。条件不正常，两只就会争斗——<b>较弱的那只阵亡</b>，另一只受伤；只有同性、蛋组不匹配会真的打起来，文案会点明原因。<b>两只百变怪</b>与<b>未发现蛋组的物种</b>放不进同一栏；<b>无性别</b>的宝可梦不会跟任何配对打起来，只会静默地配不上。争斗与力竭死亡会在培育栏留下<b>遗体</b>，要花金币处理才能放新的。新个体有 <b>1/4096</b> 概率闪光，<b>2/4096</b> 概率不孕（♀）/不育（♂）；不孕不育无法配种，但不会因此争斗。只有异性且蛋组不匹配导致的配对失败会永久锁定物种组合，选择列表中显示为不可用；同性争斗、力竭等其他失败不记录，也不锁定。</li>
        <li><b>近亲</b>：双亲共享祖先就是近亲。近亲后代更<b>脆</b>——耐受度上限逐代降低，也更容易在繁育中产下没有成型的死胎。<b>引入外血</b>（与没有血缘的个体配对）能把体质拉回来。</li>
        <li><b>蛋组</b>：博士一开始并不知道任何宝可梦的蛋组，界面上只显示 ???。只有亲手繁育出蛋，才会确认两边交汇的那个蛋组。</li>
        <li><b>孵化</b>：蛋在孵化器中倒计时，孵出的永远是该家族的<b>最初形态</b>；孵化步数越高越慢，升级孵化器可加速并增加蛋位。孵出后默认进<b>围栏</b>，要自己放进培育栏。蛋位满了繁育会暂停，培育栏会提示原因。</li>
        <li><b>养成</b>：栏位中的宝可梦会持续获得经验，喂<b>经验糖果</b>可加速成长；不在栏位也不在实验室的会待在<b>围栏</b>里。围栏顶部用开关在「培育相关」（培育栏物种及其进化链）与「其它」之间切换，一次只显示一段；霸凌致死留下的遗体单独放在「遗体」栏。围栏里同种同性达到 4 只后，最弱的那只会被持续霸凌、耐受度下降；移走一只即可停止；<b>百变怪不会被霸凌</b>。霸凌致死会留下遗体，需要花金币处理。</li>
        <li><b>实验室</b>：实验台可以研究宝可梦、推进该物种的研究笔记条目，<b>没有免费的实验</b>。每种实验都有冷却，越深入的实验冷却越久（最长 30 秒）；该物种研究完成后冷却取消。<b>放进去就取不出来了</b>，只能继续实验，直到耐受度耗尽死亡，或花金币处理；死亡的实验对象会留下遗体，同样占用实验台，必须付费处理才能空出；实验具体影响不会事先显示。已执行过的行为会标“已记录”。每次实验会先播放加载条，结束后只显示实验状态与实验日志，不展示结果文案；手动处理活体会记入日志和损耗。<b>该物种研究 100% 之后不再记录任何实验日志</b>，死亡后的遗体处理也不重复记录。</li>
        <li><b>耐受度</b>：上限随等级提高（Lv.1 为 100，每级 +2），<b>雄性再乘 1.25</b>；出厂即满，但只有进了实验室才能在界面上看到。繁育、争斗、霸凌、实验都会消耗它，归零即死亡：实验室个体留下遗体占位，围栏里被霸凌致死的个体留下遗体等待处理，培育栏里死亡的个体也会留下遗体（需付费处理），其他情况离队。物种研究完成后，只剩最伤身的那种实验还能用。</li>
        <li><b>能力值</b>：刚接触的物种看不全能力值。随着该物种的研究进度，能力项会按种族值从高到低逐项披露。</li>
        <li><b>研究笔记</b>：研究过的物种会显示灰度图标和进度，100% 完成后才变成彩色；已完成条目会记录完成日期与损耗掉的个体数，物种详情和研究笔记页还会显示最近的实验日志（含处理记录）。</li>
        <li><b>进化</b>：升级自动进化；石之进化与通信进化需要在详情页手动触发（消耗道具）。</li>
        <li><b>部门需求</b>：六个部门加上<b>总裁办</b>会提出需求，分任意 / 属性 / 指定物种三类；按时交付可得资金与声望，普通部门金币已大幅下调。过期或主动放弃不再扣声望，但长时间不完成需求会让声望逐日流失，闲置越久流失越快。总裁办的单子又少又难，报酬远高于普通部门，框体带金色专属标识。</li>
        <li><b>经营与职级</b>：资金用于买蛋、经验糖果、进化石与设施。声望达标后花资金晋升职级，职级决定设施能升到多高。</li>
      </ul>
      <p><b>走到这里</b>：达到最高职级，或完成 151 个物种的研究笔记，这一局就可以收束。这里没有战胜谁，也不是传统意义的通关，只是游戏承认你在这条路上付出的努力。</p>
      <p class="hint" style="color:var(--muted);font-size:12px">传闻：偶尔会有正义之士摸进基地营救宝可梦，造成声望、资金、宝可梦与蛋的损失——这条还没实装。</p>
      <p style="color:var(--muted);font-size:12px">数据来自 PokeAPI。存档保存在浏览器本地。</p>
    </div>`
  );
}

function winModalHtml() {
  const st = S.stats || {};
  const rankWin = S.winKind === 'rank';
  return modalShell(
    '🏆 这条路走到这里',
    `<div class="help">
      <p>${
        rankWin
          ? `你坐到了${L.currentRank(S).name}的位置。这不是战胜了谁，也不是击败了谁——只是你在这条路上走到了自己认可的终点，游戏承认了你的努力。`
          : '151 份研究笔记全部补完。这不是战胜了谁，只是你选择把这条研究的路走到了尽头，游戏承认了你的努力。'
      }</p>
      <p style="color:var(--muted);font-size:12px;margin-top:8px">你仍然可以继续经营；这里只是一个可以收束本局的地方。</p>
      <div class="stats-grid" style="margin:12px 0">
        <div class="kv"><span class="k">达成天数</span><span class="v">第 ${S.wonDay ?? Math.floor(S.day)} 天</span></div>
        <div class="kv"><span class="k">累计收入</span><span class="v">🪙 ${fmt(st.earned || 0)}</span></div>
        <div class="kv"><span class="k">完成需求</span><span class="v">${st.delivered || 0} 单</span></div>
        <div class="kv"><span class="k">孵化</span><span class="v">${st.hatched || 0} 枚蛋</span></div>
        <div class="kv"><span class="k">配种</span><span class="v">${st.bred || 0} 次</span></div>
        <div class="kv"><span class="k">争斗</span><span class="v">${st.fights || 0} 次</span></div>
        <div class="kv"><span class="k">实验</span><span class="v">${st.experiments || 0} 次</span></div>
        <div class="kv"><span class="k">损失</span><span class="v">${st.released || 0} 只</span></div>
        <div class="kv"><span class="k">职级</span><span class="v">${L.currentRank(S).name}</span></div>
        <div class="kv"><span class="k">声望</span><span class="v">${Math.round(S.rep)}</span></div>
      </div>
      <div class="actions">
        <button data-act="close">继续经营</button>
      </div>
    </div>`
  );
}

function quitModalHtml() {
  return modalShell(
    '离开火箭队？',
    `<p>你可以就此离开这座地下基地：不再管理培育栏，也不再替他们补数据。</p>
     <p style="color:var(--muted);font-size:12px;margin-top:8px">本局会立即结束（无法继续推进时间），当前进度仍会留在存档里。这是认输，不是重开。</p>
     <div class="actions">
       <button data-act="confirm-quit" style="border-color:rgba(255,107,122,.5);color:#ffb3ba">确认离开</button>
       <button class="ghost" data-act="close">再想想</button>
     </div>`
  );
}

function quitDoneModalHtml() {
  const st = S.stats || {};
  return modalShell(
    '你离开了火箭队',
    `<div class="help">
      <p>你把笔记本塞进外套，走过培育栏，没有回头。基地的灯还亮着——但那些数据已经不属于他们了。</p>
      <div class="stats-grid" style="margin:12px 0">
        <div class="kv"><span class="k">坚持到</span><span class="v">第 ${S.quitDay ?? Math.floor(S.day)} 天</span></div>
        <div class="kv"><span class="k">研究笔记</span><span class="v">${S.dex.length}/151</span></div>
        <div class="kv"><span class="k">累计收入</span><span class="v">🪙 ${fmt(st.earned || 0)}</span></div>
        <div class="kv"><span class="k">完成需求</span><span class="v">${st.delivered || 0} 单</span></div>
        <div class="kv"><span class="k">孵化</span><span class="v">${st.hatched || 0} 枚蛋</span></div>
        <div class="kv"><span class="k">职级</span><span class="v">${L.currentRank(S).name}</span></div>
      </div>
      <div class="actions">
        <button data-act="new-game">重新入职（新游戏）</button>
        <button class="ghost" data-act="close">留在这里看看</button>
      </div>
    </div>`
  );
}
