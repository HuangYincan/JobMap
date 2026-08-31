# Workstream c — feature/baidu-ready-signal(百度就绪信号修正 + 全链路验证)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-pc`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-c.md`(末两行 token,见文末)。

## 背景(boss 真实验证 2026-08-22,Playwright)

用户已修复百度浏览器端 AK(有效)。实测:**getscript 加载成功、无「APP不存在」弹窗、无 document.write 错误** —— 加载器正常。但 `baidu-engine.ts:341-399` 的就绪等待**从未触发**:`setMapReadyCallback` 优先 + `tilesloaded` 兜底,两者都未 fire → 1.5s 超时抛「BMapGL 地图就绪超时」→ switch 回滚(回滚机制本身工作正常,console: `switchEngine 目标创建失败,已回滚旧引擎视图`)。

**核心疑问**:BMapGL v1.0(`getscript?type=webgl&v=1.0`)的正确就绪信号是什么?`setMapReadyCallback` 很可能是 **BMapGL 2.0 API**,v1.0 的事件集不同(候选:`loadend`、`mapReady`、`tilesloaded`、`complete`;或轮询 `map.getMapType()`/`map._mapClass`/tile 状态)。

用户说「百度地图已恢复,但还是失败」—— 地图可能实际渲染了(瓦片加载),只是就绪信号选型错误导致超时回滚。**若核实 v1.0 就绪信号后地图仍未渲染,需继续排查**(referer 白名单?瓦片 403?)。

## 任务

### 1. 就绪信号选型核实与修正(`server/src/lib/map-engine/baidu/baidu-engine.ts` 就绪等待段)

- **核实方法**(可做尽做):
  - 读已加载的 getscript SDK 源码(browser evaluate `Object.keys(map)`、`map.addEventListener` 支持的事件表、`typeof map.setMapReadyCallback`、`BMapGL.__init__`/命名空间导出)—— 主仓库 dev server 在跑,用 Node/Playwright 或直接审查 SDK 文件(console 里 getscript URL 可抓)
  - 若环境允许:在浏览器 console 手动 `new BMapGL.Map(container)` + 检查 map 实例的事件注册/触发,确认 v1.0 真实事件名
  - 官方文档核实(https://lbsyun.baidu.com GL JSAPI 文档):v1.0 的 Map 事件表
- **修复**:waitForReady 改为 v1.0 正确信号(多信号并联:核实到的事件 + 轮询兜底 `setTimeout(BAIDU_READY_POLL_MS)` 检查 map 就绪状态如 `map.getZoom() > 0`/`map.isLoaded`/tile 计数);超时文案保留「BMapGL 地图就绪超时」
- **保持**:超时常量 1500ms 不变;switch.ts 零改动(回滚契约已就绪);setMapReadyCallback 若存在仍优先
- 若核实发现 v1.0 根本不 fire 任何就绪事件(不可靠):改为**短轮询探测**(poll 间隔 ~100ms,检查 map 状态可读 + 首次瓦片加载,最多 1.5s)—— 在汇报中给出选型依据

### 2. 真实渲染验证(尽量做)

- 环境:主仓库 `/Users/acccan/domain-map` dev server 在跑(`server/.env.local` 已含有效 AK);worktree 无 .env.local —— 代码验证以 mock 为准;**真实验证可委托 boss**(汇报注明「真实验证待 boss 合并后 Playwright」)
- 离线验收:mock 断言就绪信号注册(事件名 + 轮询)、超时抛错、正常触发路径

### 3. 测试

- `server/tests/map-engine-baidu.test.mjs` 更新:就绪信号(新事件名/轮询)断言;超时路径断言不变
- 全量门禁见批次 README

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(就绪等待段)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:腾讯/高德引擎、`switch.ts`、`use-map-engine.ts`、`map-markers.ts`、`map-shell.tsx`、`map-shell.module.css`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-pc/server && npm test`(基线 1128 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-pc/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-pc && make docs-check`、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/reports/ws-c.md`:就绪信号核实过程与结论(SDK 事件表/轮询证据)、修复实现、测试用例、真实验证状态。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
