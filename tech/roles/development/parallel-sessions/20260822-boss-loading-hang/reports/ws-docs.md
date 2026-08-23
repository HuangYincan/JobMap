# ws-docs 汇报(2026-08-22)

WS-docs `fix/docs-loading-hang` — 首访卡死修复文档回填(纯文档,零代码改动)
worktree: `/Users/acccan/dm-wt-load-docs`,分支 `fix/docs-loading-hang`(自 dev 预建)

## 实际改动

### 1. `tech/16-bug-fixes.md`(commit `1d586e7`)

- 文首追加「2026-08-22: 首访卡死加载界面——三条无界/无出口链修复(loading-hang)」条目,
  与既有条目同构(症状/根因/修复/修改文件/验证):
  - C1 → `amap-api.ts`: `AMAP_LOAD_TIMEOUT_MS = 8_000`(:45)、超时清 loadPromise +
    remove 标签 + reject `code: 'AMAP_LOAD_TIMEOUT'`(:104-107)、onerror 同语义(:125)、
    settled 竞态守卫(:82-100);
  - C2 → `use-map-engine.ts`: `runMount`(:337)、`MapMountError`(:85-92)、
    `retryMount`(:438-441)、25s watchdog `MOUNT_TIMEOUT_MS`(:167);`mount.ts`
    最终错误携带 engineId(:96-101);
  - C3 → `map-shell.tsx` 覆盖层三态(:2290-2311)、i18n mapLoadFailed 系键
    (i18n.ts:202-213)、handleMountRetry(:327-333);
  - C2' → `viewport-search.ts`: `WORK_FULL_LOAD_MAX_PAGES=10_000`(:292)、
    `WORK_VIEWPORT_PAGE_TIMEOUT_MS=10_000`(:299)、
    `WORK_VIEWPORT_MAX_CONSECUTIVE_FAILURES=3`(:301-304)、withTimeout(:436)、
    失败页跳过 + 连续 3 页止损(:484-504);
  - 验证:合并后 1443 tests / 1441 pass / 2 skip / 0 fail(merge-report 数据)。

### 2. `tech/23-map-engines.md`(commit `5a2e649`)

- 文末追加「加载超时契约与挂载错误态回填(2026-08-22)」小节:
  - loadAMap 8s 超时契约(常量/超时+onerror 同语义/settled 守卫),与既有超时先例
    tencent 1.5s 就绪 / baidu 1.5s 就绪 + 2s 命名空间并列;
  - useMapEngine mountError/retryMount 错误态契约(runMount 统一链 / mountError
    三字段 / retryMount 幂等 / 25s watchdog 语义与代际作废 / 引擎总线与 map-shell
    消费方契约);
  - 验收表(单文件测试数 + 合并后全量 1441 pass / 2 skip)+ 遗留项(ws-8 偏好
    改写决策)。

### 3. `tech/12-bundle-notes.md` / `agent.md` — 未改动(核查结论:无矛盾)

- `12-bundle-notes.md` 仅描述打包机制(「高德脚本仍走 loadAMap(),不进 npm
  bundle」),与加载超时契约不冲突;
- `agent.md` 无加载/启动序列描述。按任务书「没有就不动」,避免发散。

## 门禁结果

- `make docs-check`:**通过**(Documentation policy check passed;纯 grep,不跑测试)
- `git diff --check`:通过(0 违例)
- npm test / typecheck:未跑(纯文档;docs-check 不依赖测试脚本)。验证数字
  (1441 pass / 2 skip)取自批次 merge-report 合并后全量实测,非编造。

## 遇到的问题

- **验证数字口径**:各 ws 汇报的测试计数互不一致(ws-1 981 / ws-2 1434 /
  ws-3 1428 / ws-4 1430,各自 worktree 基线不同),且与 prompt 的「1441 pass /
  2 skip」有出入。以批次 `merge-report.md` 的合并后全量实测为准
  (1443 tests / 1441 pass / 2 skip / 0 fail),与 prompt 一致,写入了两处文档。
- **file:line 精确性**:所有行号均从 dev HEAD(5165904)实际代码读出
  (amap-api.ts / use-map-engine.ts / mount.ts / map-shell.tsx / i18n.ts /
  viewport-search.ts),未编造。23-map-engines.md 末尾既有 ws-f r4 行的
  「1419 通过」为历史记录(该 ws 观测时点),未改动;新小节写当前总数。

## 证据

- commit:`1d586e7` docs(16) / `5a2e649` docs(23),工作树干净
  (`git status --short` 空)
- docs-check 输出:`Documentation policy check passed.` + `GATES-OK`
- 验证数字来源:`merge-report.md:20`(1443 tests / 1441 pass / 2 skip / 0 fail)

门禁: PASSED
结论: OK

---

## 合并准备回填(2026-08-22,merge dev 同步)

### 实际改动
- `tech/23-map-engines.md` → 唯一冲突文件,resolve 双方内容(见下);其余 dev 侧
  文件(baidu-engine.ts / map-engine-baidu.test.mjs / engine-polish-2 批次文档)
  全部 auto-merge 无冲突。

### 冲突与解决
- 冲突文件:`tech/23-map-engines.md` 末尾单一冲突区(1367-1480 行区间)。
- 性质:双方各在文件末尾追加独立小节 —— ours =「加载超时契约与挂载错误态回填」
  (loading-hang 批,12:08 提交),theirs =「ws-g r5 回填:SDK fixPosition 反绕」
  (12:05 提交),无交错覆盖。
- 解决:删 3 行冲突标记,两小节完整保留、顺序拼接(loading-hang 在前,r5 在后);
  不覆盖、不改写任何一行正文。
- `tech/16-bug-fixes.md`:无冲突(auto-merge,loading-hang 条目为唯一新增,dev
  无同文件改动)。
- 过程事故:首次 Edit 误删 ours 小节,用 `git checkout -m tech/23-map-engines.md`
  恢复冲突态后按「仅删标记」方式重解,二次校验 grep 无标记 + 关键术语
  (AMAP_LOAD_TIMEOUT_MS / MOUNT_TIMEOUT_MS / fixPosition / pointToOverlayPixelIn)
  双小节齐全。

### 门禁结果(合并后)
- `git diff --check`:通过(无空白错误)
- `make docs-check`(仓库根):`Documentation policy check passed.` 通过
- 工作树:干净(`git status --short` 空)

### 证据
- merge commit:`36583a8 Merge branch 'dev' into fix/docs-loading-hang`
- `git log --oneline -3`:
  ```
  36583a8 Merge branch 'dev' into fix/docs-loading-hang
  f32d3cc chore: 20260822 boss engine-polish-2 轮5入库(ws-g baidu-r5 merge-report + 汇报)
  5a2e649 docs(23): 引擎加载超时与挂载错误态契约回填
  ```
- 未 push、未 merge 回 dev;分支/worktree 留原地,交由 merger 收尾。

门禁: PASSED
结论: OK
