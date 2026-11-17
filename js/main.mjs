// 启动：加载数据、读取存档、驱动主循环
import { initDex, initExperiments, DEX } from './data.mjs';
import { initBaseResults } from './results.mjs';
import { CONFIG, RANKS } from './rules.mjs';
import { deserialize, loadRaw, persist, clearSave } from './save.mjs';
import * as L from './logic.mjs';
import * as UI from './ui.mjs';

async function boot() {
  // 数据：研究笔记 + 定制实验 + 基础行为结果；物种专属结果按需加载
  const [dexRes, expRes, resultRes] = await Promise.all([
    fetch('data/dex.json'),
    fetch('data/experiments.json'),
    fetch('data/results/base.json'),
  ]);
  if (!dexRes.ok) throw new Error(`无法加载 data/dex.json（HTTP ${dexRes.status}）`);
  if (!expRes.ok) throw new Error(`无法加载 data/experiments.json（HTTP ${expRes.status}）`);
  if (!resultRes.ok) throw new Error(`无法加载 data/results/base.json（HTTP ${resultRes.status}）`);
  initDex(await dexRes.json());
  initExperiments(await expRes.json());
  initBaseResults(await resultRes.json());

  // 读档：只认当前版本，旧版本存档 deserialize 直接返回 null（重新开档）
  let loaded = { raw: null, error: null };
  try {
    loaded = loadRaw(localStorage);
  } catch (err) {
    loaded.error = err;
  }
  if (loaded.error) console.warn('localStorage 不可用', loaded.error);

  let state = deserialize(loaded.raw);
  const fresh = !state;
  if (!state) state = L.newGame();

  const save = (silent = false) => {
    try {
      persist(localStorage, state);
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
        clearSave(localStorage);
      } catch {}
      state = L.newGame();
      UI.setState(state);
      save(true);
      UI.toast('火箭队地下基地重新运转', 'good');
    },
  });

  if (fresh) {
    UI.pushLog('你是年轻的大木博士，被火箭队“请”来管理他们抢来的宝可梦。', 'info');
    UI.pushLog('谁和谁能生出蛋，你一开始并不知道——确认之前，蛋组只会显示 ???。', 'info');
    UI.pushLog('栏位里放两只，繁育条就会走；条件不对的话，它们会打起来。', 'info');
    UI.pushLog('研究笔记不会因为获得而解锁：把宝可梦送进实验室做实验，积累物种研究进度。', 'info');
    UI.pushLog('耐受度只有在实验室里才看得见；归零就会被放生。', 'info');
    UI.pushLog('走到最高职级，或完成 151 份研究笔记，这一局就可以收束。想收手，随时可以离开火箭队。', 'info');
  }

  // 主循环：真实时间 → 游戏天数
  let last = performance.now();
  let renderAcc = 0;
  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    const spd = UI.getSpeed();
    if (spd > 0) {
      const realSeconds = dt / 1000;
      const events = L.tick(state, (realSeconds * spd) / CONFIG.secondsPerDay, realSeconds);
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
    /** 加经验糖果：__game.addCandies(50) */
    addCandies(n = 10) {
      state.candies += n;
      UI.render();
      return state.candies;
    },
    /** 加声望：__game.addRep(20) */
    addRep(n = 20) {
      state.rep = Math.min(100, state.rep + n);
      UI.render();
      return state.rep;
    },
    /** 直接设定职级（调试用）：__game.setRank(3) */
    setRank(n = 0) {
      state.rank = Math.max(0, Math.min(RANKS.length - 1, Math.round(n)));
      UI.render();
      return L.currentRank(state).name;
    },
    /** 认输：__game.quit() */
    quit() {
      const r = L.quitGame(state);
      UI.render();
      return r;
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
    saveKey: CONFIG.saveKey,
  };
  console.info('[火箭队模拟器] 调试接口已就绪：__game.fastForward(10) / __game.addGold(5000) / __game.give(25, 30) / __game.setRank(3)');
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
