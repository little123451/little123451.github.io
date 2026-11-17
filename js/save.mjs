// 存档层：序列化与浏览器存储读写。
// 只认当前版本；不写迁移、不做缺字段兜底——旧版本存档由 deserialize 判 null 丢弃。
import { CONFIG, SAVE_VERSION } from './rules.mjs';

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(raw) {
  try {
    const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!st || !Array.isArray(st.mons)) return null;
    if (st.v !== SAVE_VERSION) return null;
    return st;
  } catch {
    return null;
  }
}

// ---------- 浏览器存储 ----------
export function loadRaw(storage) {
  try {
    return { raw: storage.getItem(CONFIG.saveKey), error: null };
  } catch (error) {
    return { raw: null, error };
  }
}

export function persist(storage, state) {
  storage.setItem(CONFIG.saveKey, serialize(state));
}

export function clearSave(storage) {
  storage.removeItem(CONFIG.saveKey);
}
