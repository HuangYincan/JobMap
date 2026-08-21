# Workstream — fix/icon-preflight-silent(预检噪音消除)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-icon2`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-f.md`(末两行 token,见文末)。

## 背景(boss 复验,2026-08-22)

ws-e 的 icon-preflight 已解决核心问题(TMap SDK 不再报「Image加载失败」刷屏、不再换默认 marker;POI 全部显示我们的徽章)。**剩余噪音**:预检用 `fetch(src, {mode:'cors'})` —— 每个失败的 favicon URL 在浏览器 console 报 2 行:
1. `Access to fetch at '...' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`
2. `Failed to load resource: net::ERR_FAILED`

实测首次进入 TMap:~94 个 URL × 2 = ~189 条一次性报错(每次刷新/切引擎重复)。boss 判定:核心刷屏已除,但每次进 TMap 的一波噪音仍影响体验,做两个小优化:

## 任务

### 1. 预检改 `new Image()`(报错减半)

`server/src/lib/map-engine/icon-preflight.ts` 的 `preflightRemoteIcon`:
- `fetch(src, {mode:'cors'})` → `new Image()` + `img.crossOrigin = 'anonymous'` + `referrerPolicy = 'no-referrer'`
- 语义一致:无 CORS 头 → onerror(与 WebGL 纹理加载结果等价);有 CORS 头 + 网络通 → onload
- 收益:失败只报 1 行 `Failed to load resource: net::ERR_FAILED`(fetch 报 2 行)
- 注意:Image 对象要在回调中保持引用(防 GC 中断 onload/onerror)

### 2. 失败清单 sessionStorage 持久化(噪音只在首次)

- 预检失败(fail)的 URL 记入 sessionStorage(如 key `domain-map:icon-preflight-fail`,JSON 数组/Set;防抖:单次写入合并,不要每 URL 一写)
- `remoteIconStatus` 查询时先查 sessionStorage(不在内存则回退 sessionStorage)
- 收益:同一会话内刷新/切引擎不再预检已知失败 URL → 噪音只在**首次会话**出现一次
- 注意:sessionStorage 读写要 try/catch(隐私模式可能禁用);data URL 不经过

### 3. 测试与文档

- `server/tests/icon-preflight.test.mjs`(或现有)追加:Image 预检路径断言(mock Image 类)、sessionStorage 失败持久化断言(失败后 status 从 sessionStorage 读回 fail)、隐私模式降级断言(try/catch 不抛)
- `tech/23-map-engines.md` 回填(仅追加):预检噪音消除记录
- 全量门禁见批次 README(基线 1359,合并后主树)

## 文件边界

- 只允许改:`server/src/lib/map-engine/icon-preflight.ts`、`server/tests/`(相关测试)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:map-markers.ts、各引擎、map-shell.tsx、其他组件、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-icon2/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-icon2 && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-f.md`:Image 预检改造、sessionStorage 持久化设计、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
