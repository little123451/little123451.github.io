# 待实施队列（Backlog）

> 类型：decision tracker（**已定未实施**）｜ 更新：2026-11-24
> 只放**已经定案**的改动。讨论中的想法留在 `design/*.md` 的待定项；实施完成后删除本行、在 `impl-log.md` 追加登记、同步 `spec.md`。

## 状态机

```
讨论中 ──定案──> 已定待实施 ──实施──> 已实施（转 impl-log，本表删行）
   │                  │
   └─ 未定，留在        └─ 被推翻 → 作废（保留一行，注明 Superseded by #N）
     spec §15 / 卷内待定
```

- **「讨论中」不进本表**，否则会退化成愿望清单。
- **作废不删除**：留一行 `Superseded by #N`，保留决策轨迹。

## 条目

| # | 状态 | 批次 | 改动 | 涉及文件 | 验收 | 来源 |
|---|---|---|---|---|---|---|
| 1 | 已定待实施 | B1 | 畸形体立绘按**个体 uid** 独立生成：seed、位移量、频率、色相/饱和度/对比度全部派生自 uid，同一只稳定、彼此不同 | `js/ui.mjs`、`tools/test-ui.mjs`、`docs/spec.md` §3、`docs/design/breeding.md` §20.3 | 两个畸形体的 `style.filter` 不同；同一只多次渲染一致；`npm test` 全绿 | 2026-11-24 讨论（原方案按父母物种对生成，同胞同脸） |
| 2 | 已定待实施 | B2 | 清理已移除「争斗」机制的残留：死因文案 `fight`、`playPenClash` 的 `e.fight` 分支、四处过期注释、`stats.fights` 字段、`test-logic` 的 `fights === 0` 断言、`test-ui` 的合成 `fight` 事件 | `js/logic.mjs`、`js/ui.mjs`、`js/rules.mjs`、`tools/test-logic.mjs`、`tools/test-ui.mjs`、`docs/spec.md` | `js/` 内不再出现与「争斗」相关的代码与注释（霸凌用的 `fighting` 类名另议）；`npm test` 全绿 | `impl-log.md` §25.3 |
| 3 | 已定待实施 | B3 | 近亲信息改为**亲属称呼**，并**记录父方/母方**：`fatherUid`/`motherUid` 写入蛋与个体；称呼区分堂/表、伯/叔、侄/甥，全同胞与表亲分长幼；只在配对选择器显示；删除详情页「血缘」行；百变怪 / 无性别一侧退化为粗称呼 | `js/logic.mjs`（`createEgg`/`createMon` 字段）、`js/rules.mjs`（`SAVE_VERSION`）、`js/ui.mjs`（选择器称呼、详情页删行）、`tools/test-*.mjs`、`docs/spec.md` §16、`docs/design/breeding.md` §13.13 | 堂/表、伯/叔、侄/甥判定正确；百变怪配对退化粗称呼；选择器不带数字；详情页无血缘行；三代以外不标；`npm test` 全绿 | 2026-11-24 讨论（§13.13） |

## 批次

| 批次 | 主题 | 含条目 | 前置 | 状态 |
|---|---|---|---|---|
| B1 | 畸形体独立形态 | #1 | — | 待实施 |
| B2 | 争斗残留清理 | #2 | — | 待实施 |
| B3 | 近亲称呼 | #3 | — | 待实施 |

一个批次 = 一次实施 = 一个提交：代码 + 测试 + `spec.md` + `impl-log.md` 同时落地。

## 流程

1. **讨论**：只分析、算数值、给方案，不动代码。
2. **定案**：往本表追加一行（状态 `已定待实施`），并在对应 `design/*.md` 加状态注（`Accepted, not implemented`）。
3. **实施**：你说「实施 Bn」，我按批次一次做完四件事——改代码、补测试、同步 `spec.md`、追加 `impl-log.md` §。
4. **收尾**：从本表删行、`NOW.md` 更新指向下一条。
