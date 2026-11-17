# 近亲惩罚方案（设计稿 · 未实施）

> 状态：**只写方案，不实施**
> 前置：血统数据已经落库（见下"数据现状"），判定与惩罚都还没接上
> 关联：[docs/breeding-plan.md](breeding-plan.md) 的 C 包、[docs/breeding-failures.md](breeding-failures.md)

---

## 1. 数据现状（已实现）

每枚蛋和每个个体都会带两个字段，由 `js/logic.mjs` 的 `lineageOf()` 生成：

| 字段 | 含义 | 来源 |
|---|---|---|
| `ancestors` | 祖先 uid 列表，**上限 8 个**（父母 + 祖父母 + 曾祖父母） | 繁育时取双亲的 `uid ∪ ancestors` 并集 |
| `gen` | 世代数：初始个体 / 市场蛋 = `0`，子代 = `max(亲代 gen) + 1` | 同上 |

```js
// 现状：createEgg 里只写不读
...lineageOf(parents),
```

- 市场买来的蛋：`ancestors: []`、`gen: 0`。
- 孵出时 `hatch()` 把蛋的两个字段原样传给个体。
- 目前**没有任何代码读取它们**，所以现在近亲配对完全没有惩罚。

### 数据能力的边界

- `ancestors` 只保留 8 条：五代以上的共同祖先会丢失，判定是"有限深度"的。
- 只存 uid，不存物种名：亲代被放生/出售后，uid 仍在祖先表里，**谱系判定不受影响**。
- 若将来要做家谱 UI，需要额外存 `{uid, dexId, no}` 快照，当前没有。

---

## 2. 判定函数（建议实现）

```js
// 判定两只个体是否为近亲（亲子 / 兄妹 / 更远的共同祖先）
export function isKin(a, b) {
  if (!a || !b) return false;
  const A = new Set(a.ancestors || []);
  const B = new Set(b.ancestors || []);
  if (A.has(b.uid) || B.has(a.uid)) return true; // 亲子
  for (const u of B) if (A.has(u)) return true;  // 共同祖先 = 兄妹或更远
  return false;
}
```

- 复杂度 O(8)，可以直接放进 `penStatus` / 结算路径，不需要缓存。
- 半同胞、全同胞、亲子、祖孙都能覆盖；表亲（共享曾祖父母）只在双方祖先表都还留着那 8 条以内时才成立。

---

## 3. 三档惩罚方案

### K1 · 只提示（最保守）

- 栏位与详情显示「近亲」标记；数值完全不变。
- 成本：UI 两处 + 1 条测试。
- 效果：先让玩家看见血统，不改经济与死亡率。
- 适合：想先观察玩家行为，再决定惩罚力度。

### K2 · 耐受 + 体质（推荐）

| 项目 | 规则 |
|---|---|
| 繁育成本 | 承担方耐受消耗 `32 → 48`（×1.5） |
| 后代体质 | `toleranceCap × 0.8`（向上取整），通过新增 `createMon` 选项 `toleranceFactor` 实现 |
| 提示 | 栏位显示「近亲」，产蛋文案追加一句「这一胎明显虚弱」 |

- 与现有耐受度系统天然咬合：近亲 = 更快耗尽母体，后代也更不耐折腾。
- 数值理由：Lv.1 雌性 100 耐受，正常可产 3 枚；近亲只能产 2 枚（100 / 48 ≈ 2.08）。
- 成本：`compatibility` 增加 `kin` 字段、`resolvePen` 分支、`createMon` 选项、UI 一处、约 10 条测试。
- 风险：低。近亲不会再"无痛"，但也不至于禁配。

### K3 · 直接禁配（最硬）

- `compatibility` 返回 `{ ok: false, code: 'kin', quiet: true }`，栏位置灰、不产蛋、不争斗。
- 优点：规则直白。
- 代价：玩家手里的兄妹个体直接报废；与"博士只能靠试"的设定冲突（禁配等于直接告诉你血缘）；且**同种自交是当前唯一能稳定刷同种的方式**，禁掉会影响图鉴补齐节奏。

> **推荐 K2**。K1 太轻（数据白存），K3 会把培育玩法砍掉一半。

---

## 4. 与现有系统的交互点

| 系统 | 影响 |
|---|---|
| 耐受度 | K2 只改承担方消耗系数，不动上限与升级补差逻辑 |
| 配对失败锁定 | 近亲**不写入** `failedPairs`（不是"配不上"，只是"配出来更差"），避免污染锁定表 |
| 蛋位 | 不变 |
| 蛋组知识 | 近亲繁育仍然揭示蛋组（知识照常获得） |
| 市场 | 市场蛋 `ancestors: []`，永远是"外血"，天然适合补救 |
| 订单/出售 | 近亲后代仍可正常出售/交付，只是更脆 |
| 存档 | 字段已在，**不需要升版本**（按项目约定也不做兼容） |

---

## 5. 实施清单（等到要做时照这个改）

1. `js/logic.mjs`
   - 新增 `isKin(a, b)`；
   - `compatibility(a, b)` 返回体加 `kin: true`（不改 `ok`，K2 仍然允许配）；
   - `resolvePen` 里：`const cost = comp.kin ? CONFIG.breedToleranceCost * 1.5 : CONFIG.breedToleranceCost`；
   - `createEgg(state, dexId, parents, source)` 增加 `toleranceFactor` 传递；
   - `createMon` 支持 `opts.toleranceFactor`，`tolerance = Math.round(toleranceCap(...) * factor)`。
2. `js/rules.mjs`：`CONFIG.kinBreedCostFactor = 1.5`、`CONFIG.kinToleranceFactor = 0.8`（集中在配置层，便于调参）。
3. `js/ui.mjs`：`penStatus` 增加 `kind: 'kin'`（仍允许繁育，只是标记）；栏位警示区显示「近亲」；详情页加一行「世代 / 近亲」。
4. `tools/test-logic.mjs`：兄妹判定、亲子判定、近亲成本、后代耐受 ×0.8、近亲不写入锁定。
5. `tools/test-ui.mjs`：近亲标记渲染。
6. `README.md`：§1 繁育补充一条近亲规则。

---

## 6. 备选：遗传层面的近亲效果（可选，与 K2 叠加）

如果只做耐受惩罚觉得不够"血统感"，可以再加一条**纯遗传**效果：

- 近亲后代的 IV 抖动区间从 `±5` 扩大到 `±10`（更容易出高值，也更容易出低值），体现"近亲放大性状"。
- 成本：`createEgg` 里一行 `const spread = parents.some(p => isKin(...)) ? 10 : 5`。
- 风险：会让近亲变成"刷极品"的手段，需要配合 K2 的耐受代价才有平衡。

> 这条**不建议首版就上**，容易变成最优解。等 K2 跑一段再看。
