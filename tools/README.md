# 开发工具

## 1. 图鉴数据与叫声（PokeAPI）

```powershell
node tools/fetch-gen1-flying.mjs          # 已有叫声则跳过
node tools/fetch-gen1-flying.mjs --force  # 强制重新下载
```

产出：`data/pokemon.json`（19 只第一世代飞行系的种族值/中文名/分档）、`assets/cries/{id}.ogg`。

## 2. 像素精灵（PMDCollab SpriteCollab）

```powershell
node tools/fetch-pmd-sprites.mjs          # 复用已下载帧条
node tools/fetch-pmd-sprites.mjs --force  # 全部重新下载
node tools/fetch-pmd-sprites.mjs --only=16
```

产出：`assets/pmd/{id}/{Anim}.png`（PMD 帧条：横向帧序列、纵向 8 方向）、`data/pmd.json`（帧宽高、帧数、方向行数、每帧时长与身体中心锚点）。

每只取四套：待机 `Float`/`Idle`、移动 `FlapAround`/`Walk`、开火 `Shoot`/`Attack`、受击 `Hurt`；`CopyOf` 会自动解析。

精灵来源：[PMDCollab/SpriteCollab](https://github.com/PMDCollab/SpriteCollab)，许可 **CC BY-NC 4.0**（署名、非商业），完整作者列表见仓库 `credit_names.txt`。Pokémon © Nintendo / Creatures / GAME FREAK。

## 3. 道具图标（PokeAPI/sprites）

```powershell
node tools/fetch-item-icons.mjs          # 已有图标则跳过
node tools/fetch-item-icons.mjs --force  # 强制重新下载
```n
产出：ssets/items/{skill_up,heal,new_skill,evolution_stone,stat_boost}.png（30×30 官方像素图标，游戏中按 20px 显示）。

## 本地预览

```powershell
node tools/dev-server.mjs        # 默认 http://127.0.0.1:8123/
node tools/dev-server.mjs 9000   # 指定端口
```

必须通过 HTTP 访问：ES Modules 与 `fetch('data/*.json')` 在 `file://` 下会被浏览器拦截。

## 调试入口

```js
window.__flyingShmup.stats()  // 已保存的统计数据（localStorage）
window.__flyingShmup.game()   // 当前 Game 实例
```
