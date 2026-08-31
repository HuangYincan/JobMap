# WS-docs fix/docs-loading-hang —— 首访卡死修复文档回填

## 背景

代码已入库 dev(HEAD 5165904,merge commits f5c3d17/6c780dc/8e05d2d/5165904)。按 CLAUDE.md
「代码变更同步 tech/ 文档」契约,需回填本次 bug 的根因与修复。**纯文档工作,不改任何代码。**

## 已修复内容(dev 已含,供你读代码核对事实)

BUG:首次进入网站必定卡死在 "Loading map..." 覆盖层,刷新即好。三根因三修复:

1. **C1 → fix/amap-load-timeout**:`server/src/lib/amap-api.ts` `loadAMap()` 原为全链路唯一
   无超时 await,CDN/DNS 卡死则 Promise 永不落定 → `mapReady` 恒 false。修复:8s 超时
   (`AMAP_LOAD_TIMEOUT_MS`,L45)超时清 `loadPromise` + remove script + reject
   (`code: 'AMAP_LOAD_TIMEOUT'`,L104-107);onerror 同语义;迟到 onload 无效。
2. **C2 → fix/mount-retry**:`server/src/hooks/use-map-engine.ts` 挂载链提取 `runMount`
   (首挂载/retryMount 共用),失败(含引擎回退全败)置 `mountError`(`MapMountError`:
   engine/code/message),暴露 `retryMount()`(挂载中/已有 view 时 no-op),25s watchdog
   (`MOUNT_TIMEOUT`);`server/src/lib/map-engine/mount.ts` 最终错误携带 engineId。
   之前失败仅 console.warn,无任何出口。
3. **C3 → fix/loading-error-ui**:`server/src/components/map-shell.tsx` 覆盖层三态:
   加载中(现状零改动)/ 失败态(`mapLoadFailed`/`mapLoadRetry`/`mapLoadRetrying` i18n
   zh+en,重试按钮走 retryMount,错误小字 code·message)/ 配置缺失(现状)。
4. **C2' → fix/first-load-bounded**:`server/src/lib/viewport-search.ts` 首访全量加载
   (`WORK_FULL_LOAD_MAX_PAGES=10_000`)逐页 `withTimeout(10s)` + 失败页跳过 + 连续 3 页
   止损;刷新走 useModeCacheRestore 短路的对称问题不再有无限 await。

## 任务(worktree: /Users/acccan/dm-wt-load-docs,分支 fix/docs-loading-hang)

修改文件:**仅以下文档**(可读 dev 代码核对后如实写,不允许编造 file:line):

1. `tech/16-bug-fixes.md`:追加「首访卡死加载界面(2026-08-22)」条目——症状、根因(三链
   无界/无出口)、修复(file:line 精确)、验证(1441 pass / 2 skip)。
2. `tech/23-map-engines.md`(引擎文档):回填 `loadAMap` 8s 超时契约 + `useMapEngine`
   mountError/retryMount 错误态契约 + 25s watchdog(在合适小节,与既有超时先例
   tencent 1.5s / baidu 2s 并列)。
3. 若 `tech/12-bundle-notes.md` 或 `agent.md` 中有「加载/启动序列」相关描述与之矛盾,
   小改对齐;没有就不动(避免发散)。

**不得修改任何 src/ 代码、不得改其他 tech/ 文档内容**。

## 门禁(worktree 内;cd server 运行)

- `make docs-check` 通过(仓库根)
- `git diff --check` 通过
- Conventional Commits(`docs(16): 首访卡死根因与修复回填` 之类,1-2 个 commit)
- 不需要跑 npm test(纯文档;如 docs-check 依赖脚本跑测试则照跑,如实报数字)

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang/reports/ws-docs.md`:
改动清单(每文档一节 + file:line)、docs-check 结果、遇到的问题。**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
