// 启动：加载数据、读取存档、驱动主循环
import { initDex, DEX } from './data.mjs';
import * as L from './logic.mjs';
import * as UI from './ui.mjs';

const SAVE_KEY = L.CONFIG.saveKey;

async function boot() {
  const res = await fetch('data/dex.json');
  if (!res.ok) throw new Error(`无法加载 data/dex.json（HTTP ${res.status}）`);
  initDex(await res.json());

  let savedRaw = null;
  try {
    savedRaw = localStorage.getItem(SAVE_KEY);
  } catch (err) {
    console.warn('localStorage 不可用', err);
  }

  let state = L.deserialize(savedRaw);
  const fresh = !state;
  if (!state) state = L.newGame();

  const save = (silent = false) => {
    try {
      localStorage.setItem(SAVE_KEY, L.serialize(state));
      if (!silent) UI.toast('进度已保存', 'good');
      return true;
    } catch (err) {
      console.warn('保存失败', err);
      if (!silent) UI.toast('保存失败：浏览器存储不可用', 'bad');
      return false;
    }
  };

  UI.mount(state, {
    onSave: () => save(false),
    onReset: () => {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
      state = L.newGame();
      UI.setState(state);
      save(true);
      UI.toast('火箭队地下基地重新运转', 'good');
    },
  });

  if (fresh) {
    UI.pushLog('你是年轻的大木博士，被火箭队“请”来管理他们抢来的宝可梦。', 'info');
    UI.pushLog('一雄一雌、蛋组有交集就能配种；孵出的永远是家族最初形态。', 'info');
    UI.pushLog('图鉴不会因为获得而解锁：把宝可梦送进实验室做实验，积累物种研究进度。', 'info');
    UI.pushLog('实验室是个单向门——进去就只能实验到放生为止。', 'info');
    UI.pushLog('集齐 151 个物种的图鉴研究即为胜利。', 'info');
  }

  // 主循环：真实时间 → 游戏天数
  let last = performance.now();
  let renderAcc = 0;
  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    const spd = UI.getSpeed();
    if (spd > 0) {
      const events = L.tick(state, ((dt / 1000) * spd) / L.CONFIG.secondsPerDay);
      if (events.length) UI.handleEvents(events);
    }
    renderAcc += dt;
    if (renderAcc >= 120) {
      UI.render();
      renderAcc = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(() => save(true), 12000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true);
  });
  window.addEventListener('beforeunload', () => save(true));

  // 调试出口：在浏览器控制台使用 __game.*
  window.__game = {
    L,
    UI,
    get state() {
      return state;
    },
    save,
    /** 快进天数，返回事件列表：__game.fastForward(10) */
    fastForward(days = 1) {
      const events = L.tick(state, Math.max(0, Math.min(30, days)));
      UI.handleEvents(events);
      UI.render();
      return events;
    },
    /** 加资金：__game.addGold(5000) */
    addGold(n = 1000) {
      state.gold += n;
      UI.render();
      return state.gold;
    },
    /** 加树果：__game.addBerries(50) */
    addBerries(n = 10) {
      state.berries += n;
      UI.render();
      return state.berries;
    },
    /** 直接生成一只宝可梦：__game.give(149, 30) */
    give(dexId, level = 20) {
      const mon = L.createMon(state, Number(dexId), level, { origin: 'debug' });
      state.mons.push(mon);
      const freePen = state.pens.find((p) => !p.a || !p.b);
      if (freePen) {
        if (!freePen.a) freePen.a = mon.uid;
        else freePen.b = mon.uid;
      }
      UI.render();
      return mon;
    },
    /** 把所有物种研究拉满：__game.unlockAll() */
    unlockAll() {
      for (const id of Object.keys(DEX.species)) {
        const numId = Number(id);
        state.research[numId] = L.researchRequirement(numId);
        if (!state.dex.includes(numId)) state.dex.push(numId);
      }
      UI.render();
      return state.dex.length;
    },
    /** 把某只宝可梦送进实验室：__game.toLab(0, uid) */
    toLab(slot, uid) {
      const r = L.assignLab(state, slot, uid);
      UI.render();
      return r;
    },
    /** 查看存档用的 key */
    saveKey: SAVE_KEY,
  };
  console.info('[火箭队模拟器] 调试接口已就绪：__game.fastForward(10) / __game.addGold(5000) / __game.give(25, 30)');
}

boot().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = `<div class="panel" style="margin:40px auto;max-width:560px;text-align:center">
      <h2 style="margin-bottom:10px">启动失败</h2>
      <p style="color:#8ea3c0">${String(err.message || err)}</p>
      <p style="color:#8ea3c0;font-size:12px;margin-top:10px">请通过 HTTP 服务访问（例如 <code>python -m http.server</code>），不要直接双击 index.html。</p>
    </div>`;
  }
});
