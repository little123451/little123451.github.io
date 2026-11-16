// 存档层：序列化、版本迁移与浏览器存储读写。
// 只依赖 rules.mjs 里的配置/版本号，不依赖游戏行为，也方便单独测试迁移逻辑。
import { CONFIG, SAVE_VERSION, toleranceCap } from './rules.mjs';

export function serialize(state) {
  return JSON.stringify(state);
}

const defaultUpgrades = () => ({ incubator: 0, feeder: 0, advertising: 0, training: 0 });

function normalizeState(st) {
  st.v = SAVE_VERSION;
  st.pens = st.pens || [];
  st.lab = (st.lab || []).map((slot) => {
    const s = slot && typeof slot === 'object' ? slot : { uid: null };
    return { uid: s.uid ?? null, ...(s.corpse ? { corpse: s.corpse } : {}) };
  });
  st.eggs = st.eggs || [];
  st.orders = st.orders || [];
  st.market = st.market || [];
  st.marketDay = st.marketDay ?? Math.floor(st.day ?? 1);
  st.marketRerollCost = Math.max(
    CONFIG.marketRefreshCost,
    Math.min(CONFIG.marketRefreshMax, Number(st.marketRerollCost) || CONFIG.marketRefreshCost)
  );
  st.inventory = st.inventory || {};
  st.research = st.research || {};
  st.researchLoss = st.researchLoss || {};
  st.breedFails = st.breedFails || [];
  st.failedPairs = st.failedPairs || [];
  st.dex = st.dex || [];
  st.stats = st.stats || {};
  st.eggKnown = st.eggKnown || {};
  st.dexRecords = st.dexRecords || {};
  st.expLog = st.expLog || {};
  st.expCd = st.expCd || {};
  st.rep = st.rep ?? 0;
  st.rank = st.rank ?? 0;
  st.lastTaskDay = st.lastTaskDay ?? st.day;
  st.candies = st.candies ?? 0;
  st.candyPrice = st.candyPrice ?? CONFIG.candyBasePrice;
  st.feederTimer = st.feederTimer || 0;
  st.upgrades = { ...defaultUpgrades(), pens: st.pens.length, lab: st.lab.length, ...(st.upgrades || {}) };
  st.mons.forEach((m) => {
    const cap = toleranceCap(m.level, m.gender);
    if (m.tolerance == null) m.tolerance = cap;
    if (m.tolerance > cap) m.tolerance = cap;
    m.shiny = !!m.shiny;
    m.sterile = !!m.sterile;
  });
  let nextMonNo = 1;
  st.mons.forEach((m) => {
    if (!m.no) m.no = nextMonNo;
    nextMonNo = Math.max(nextMonNo, Number(m.no) + 1 || 1);
  });
  st.nextMonNo = Math.max(Number(st.nextMonNo) || 1, nextMonNo);
  st.expJournal = st.expJournal || [];
  st.won = !!st.won;
  st.wonDay = st.wonDay ?? null;
  st.quit = !!st.quit;
  st.quitDay = st.quitDay ?? null;
  return st;
}

export function deserialize(raw) {
  try {
    const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!st || !Array.isArray(st.mons)) return null;
    if (st.v === 2) {
      // v2 → v3：树果改称经验糖果，并补上新字段
      st.candies = st.berries ?? 0;
      delete st.berries;
      st.candyPrice = st.candyPrice ?? st.berryPrice ?? CONFIG.candyBasePrice;
      delete st.berryPrice;
      st.rank = 0;
    } else if (st.v !== SAVE_VERSION) {
      return null;
    }
    return normalizeState(st);
  } catch {
    return null;
  }
}

// ---------- 浏览器存储 ----------
// 读档：优先当前 key，找不到再回退旧 key（返回 migrated 供写回时清理）
export function loadRaw(storage) {
  try {
    let raw = storage.getItem(CONFIG.saveKey);
    let migrated = false;
    if (!raw && CONFIG.legacySaveKey) {
      const legacy = storage.getItem(CONFIG.legacySaveKey);
      if (legacy) {
        raw = legacy;
        migrated = true;
      }
    }
    return { raw, migrated, error: null };
  } catch (error) {
    return { raw: null, migrated: false, error };
  }
}

export function persist(storage, state, migrated = false) {
  storage.setItem(CONFIG.saveKey, serialize(state));
  if (migrated && CONFIG.legacySaveKey) storage.removeItem(CONFIG.legacySaveKey);
}

export function clearSave(storage) {
  storage.removeItem(CONFIG.saveKey);
}
