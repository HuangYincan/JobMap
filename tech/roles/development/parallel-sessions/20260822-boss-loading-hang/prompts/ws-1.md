# WS-1 fix/amap-load-timeout —— AMap 脚本加载超时化 + 失败可重试

## 背景(boss 已定位)

BUG:首次进入网站卡死在 "Loading map..." 覆盖层(`map-shell.tsx:2254-2263`,`mapReady` 恒 false),
刷新即好。根因 C1:`server/src/lib/amap-api.ts` 的 `loadAMap()`(约 L66-99)是**全链路唯一没有
超时**的 await——中途卡死(DNS/TLS/CDN)Promise 永不落定;且 `amap-api.ts` 注释已自我承认:
「复用 existing 分支给一个已死标签挂监听,Promise 永不落定(直到整页刷新)」。对比
tencent-engine.ts(1.5s 就绪超时)/ baidu(2s 分类超时)均有界,AMap 是缺口。

## 任务(worktree: /Users/acccan/dm-wt-load-engine,分支 fix/amap-load-timeout,已从 dev 预建)

修改文件:**仅** `server/src/lib/amap-api.ts` + `server/tests/amap-api.test.mjs`。

1. `loadAMap()` 增加**超时兜底**(建议 8s;可调但 ≤10s):
   - 超时 → 移除 script 标签、清 `loadPromise = null`、`reject(new Error(..., { code: 'AMAP_LOAD_TIMEOUT' }))`
     (error 需携带可读 code,如 `err.code`:项目惯例见 map-engine 错误分类;若项目 error 无 code
     惯例,则用 `Object.assign(new Error(msg), { code: 'AMAP_LOAD_TIMEOUT' })`)。
   - onerror 路径保持现有语义(已清缓存 + remove + reject),错误信息不变。
   - **迟到 onload 必须无效**:超时后若脚本仍完成加载,不得再 resolve 已被 settle 的 promise;
     用 settled/竞态标志(或 remove 后 onload 不会触发——但不要依赖浏览器行为,显式防)。
   - `window.AMap` 已就绪短路、`loadPromise` 复用(同 URL 只注入一次)、key 缺失 reject 等
     现有语义**零改动**;`resetAMapLoader()` 不动。
2. 测试(`server/tests/amap-api.test.mjs`):现有用例保持绿;新增:
   - 超时 reject(断言 err.code === 'AMAP_LOAD_TIMEOUT',且超时后 loadPromise 已清空,
     再次调用可重新注入);
   - 迟到 onload 不 resolve(模拟超时后 onload 触发,断言 promise 仍 reject 态/不二次 resolve);
   - onerror 仍移除标签并清缓存(若已有类似用例则强化断言)。
   注入标签的测试手法沿用该文件现有 mock(jsdom/自定义 window/`document.head.appendChild` 等)。

## 不做(边界)

- 不碰 `amap-engine.ts` / `mount.ts` / `use-map-engine.ts`(ws-2 消费你的 reject 语义)。
- 不碰 `server/tests/map-engine-*.test.mjs` 等其他测试、不碰 tech/ 文档、server/docs/。
- 不 merge、不 push、不碰主树(/Users/acccan/domain-map 只读)。

## 门禁(在 worktree 内执行;cd server 运行)

- `npm test` 全绿(基线 978 pass / 2 skip,2026-08-22,worktree 基于 dev 相同)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- Conventional Commits(如 `fix(amap): loadAMap 超时兜底+失败可重试`),小步提交

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang/reports/ws-1.md`:
实际改动摘要(文件+行为)、门禁结果(四项逐条)、遇到的问题、测试前后计数。**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
