# 开发工具

## 重新生成图鉴数据与素材

```powershell
node tools/fetch-gen1-flying.mjs          # 已有素材则跳过
node tools/fetch-gen1-flying.mjs --force  # 强制重新下载
```

产出：`data/pokemon.json`（19 只第一世代飞行属性）、`assets/sprites/{id}.png`（512px 立绘）、`assets/cries/{id}.ogg`。

数据来源：[PokeAPI](https://pokeapi.co/)（`/type/flying`、`/pokemon/{id}`、`/pokemon-species/{id}` 的 `zh-hans` 名称）与 [PokeAPI/sprites](https://github.com/PokeAPI/sprites)。

## 本地预览

```powershell
node tools/dev-server.mjs        # 默认 http://127.0.0.1:8123/
node tools/dev-server.mjs 9000   # 指定端口
```

必须通过 HTTP 访问：ES Modules 与 `fetch('data/pokemon.json')` 在 `file://` 下会被浏览器拦截。

## 调试入口

游戏运行后可在控制台调用：

```js
window.__flyingShmup.stats()  // 读取已保存的统计数据（localStorage）
window.__flyingShmup.game()   // 当前 Game 实例
```
