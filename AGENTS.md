# AGENTS.md

这个仓库是《火箭队模拟器》静态网页游戏（纯前端、无构建）。文档比代码更容易腐坏，所以加载顺序有硬规定。

## 开始任何讨论或改动之前

1. 读 [`docs/NOW.md`](docs/NOW.md)——当前焦点、上次结论、下一步（约 10 行）。
2. 读 [`docs/spec.md`](docs/spec.md)——现行规则，唯一事实源（约 270 行）。
3. 读 [`docs/backlog.md`](docs/backlog.md)——已定未实施的批次（约 40 行）。

要求逐条依据时，再按需读 `docs/design/<主题>.md`；**不要整份读** `docs/design/`、`docs/archive/`、`docs/impl-log.md`，按节号用 grep 定位后只读那一节。

## 规则

- **不考虑兼容**：旧存档、旧版本、旧字段一律不兼容——直接改、直接升 `SAVE_VERSION`，不做迁移层。方案、评审、讨论里都不要以「兼容」为理由，也不要分析旧存档会怎样。
- **讨论不改代码**：讨论与定案阶段只写文档；已定的改动进 `docs/backlog.md`；只有明确说「实施 Bn」才动代码。
- **一次实施 = 一个批次**：代码 + 测试 + `docs/spec.md` + `docs/impl-log.md` 同一次提交，完成后从 backlog 删行。
- **规则只改一处**：现行规则写 `docs/spec.md`，数值真值在 `js/rules.mjs`；两者必须在同一次提交里对齐。
- **历史不许改写**：被推翻的结论标 `Superseded by §x`，原文留在 `docs/design/*.md` 原处。
- **实施必登记**：每次实施提交后，在 `docs/impl-log.md` 追加一节「实施登记 · `<hash>`」，格式见其 §21.4。
- **讨论结论不新建文件**：按主题追加到 `docs/design/<主题>.md`；新主题才建新卷，并在 `docs/spec.md` 第 14 节登记。
- 玩家可见的规则说明只有游戏内「玩法说明」；README 不写玩法。

## 验证

改动后跑 `npm test`（五个脚本全绿）；规则相关的改动还要确认 `docs/spec.md` 里对应条目已同步。
