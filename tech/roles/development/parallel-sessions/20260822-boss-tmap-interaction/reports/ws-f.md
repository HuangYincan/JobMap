# ws-f 汇报(2026-08-22,fix/icon-preflight-silent)

## 实际改动

- `server/src/lib/map-engine/icon-preflight.ts` → 预检 `fetch(src, {mode:'cors'})` 改为 `new Image()`:
  - `img.crossOrigin='anonymous'` + `referrerPolicy='no-referrer'`,onload=ok(图像可解码)/ onerror=fail(无 ACAO 头、网络错、不可解码)——语义与 WebGL 纹理加载同源,console 噪音从 2 行/URL 减到 1 行(`net::ERR_FAILED`);
  - **防 GC**:`pending` 从 `Set<string>` 改为 `Map<string, HTMLImageElement>`,回调触发前持有 Image 引用;
  - 失败 URL 防抖合并写入 sessionStorage(key `domain-map:icon-preflight-fail`,JSON 字符串数组):失败先入模块级缓冲,`queueMicrotask` 批次内合并为**一次** setItem(读改写合并既有清单);
  - `remoteIconStatus` 内存未命中 → 回退 sessionStorage 失败清单(命中即 'fail' 并回写内存缓存);`preflightRemoteIcon` 对已知失败 URL 直接记 fail 不发起网络 → 同会话刷新/切引擎零重复噪音,只在首次会话出现一次;
  - sessionStorage 读写全 try/catch:隐私模式禁用 / 内容损坏(JSON 解析失败、非数组)→ 静默降级「无记忆」,绝不抛错;data: URI 不经过;
  - `new Image()` 构造与 `src` 赋值纳入 try/catch(极端环境放弃本次预检,保持 unknown);无全局 Image 时 no-op;
  - `resetIconPreflightCache` 追加清失败缓冲与防抖标记(测试钩子,不碰 sessionStorage)。
- `server/tests/icon-preflight.test.mjs` → fetch mock 全量替换为 **Image mock**(onload/onerror 异步触发、deferred 可控),新增:
  - Image 预检路径断言(onload→ok、onerror→fail、404 不可解码→fail、`crossOrigin='anonymous'`、`referrerPolicy='no-referrer'`、pending 去重、无 Image no-op);
  - sessionStorage 失败持久化:失败后写入、reset 后 `remoteIconStatus` 从 sessionStorage 读回 fail、已知失败零新预检;
  - 防抖合并:同批次 3 失败 → 1 次 setItem;跨批次合并不覆盖(第 2 次写入清单变 4 项);
  - 隐私模式(get/set 抛 SecurityError)→ 不抛错、内存记忆照常、持久化放弃;
  - 损坏内容(JSON 解析失败、非数组)→ 按无记忆处理不抛。
  - 共 18 项(原 13 项保留语义 + 新增 5 项),控制器级 5 项 TMap 构造断言同步改 Image mock。
- `server/tests/map-engine-baidu.test.mjs` → ws-e 两项 icon 防御测试的 fetch mock 改 Image mock(断言同步:`crossOrigin='anonymous'`、fail 记忆化次数)。
- `tech/23-map-engines.md` → 仅追加 `## ws-f 回填:预检噪音消除(fetch → Image + sessionStorage 失败记忆)` 一节(+46 行)。

## 门禁结果

- npm test: 1364 通过 / 0 失败 / 2 skip(共 1366)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

1. **Node ≥22 暴露实验性全局 sessionStorage(真实存储)**:预检失败防抖写入会写进 Node 真实 sessionStorage,测试用例间互相污染(前一用例的 flush 让后一用例把已知失败 URL 当 fail 短路)。→ 测试 `beforeEach` 增加 `sessionStorage.removeItem(FAIL_KEY)` 隔离;防抖 flush 从 `setTimeout(0)` 改为 `queueMicrotask`(与 onerror 同批次执行,测试时序确定,浏览器语义不变)。已记入 tech/23 回填节,供其他 ws 注意。
2. **baidu 两项 ws-e 测试依赖 fetch mock**:预检改 Image 后 fetch mock 失效(status 恒 unknown)。→ 属「相关测试」边界内,同步改 Image mock。

## 证据

- `fix/icon-preflight-silent` 分支 3 个小步 commit(均在 worktree `/Users/acccan/dm-wt-icon2`,未 merge/push):
  - `9353f2c` fix(icon-preflight): 预检 fetch → new Image() 匿名 CORS,失败记 sessionStorage 降噪
  - `5a6c622` docs(engine): tech/23 回填预检噪音消除(fetch→Image + sessionStorage 失败记忆)
  - `114cfee` refactor(icon-preflight): Image 构造纳入 try/catch,移除冗余 pending 预置
- npm test 输出摘要:`tests 1366 / pass 1364 / fail 0 / skipped 2`;typecheck / docs-check / diff-check 全绿。
- 文件边界:只动 4 个拥有文件;`map-markers.ts`、各引擎、`map-shell.tsx`、`server/data/**`、agent.md 零改动。

门禁: PASSED
结论: OK
