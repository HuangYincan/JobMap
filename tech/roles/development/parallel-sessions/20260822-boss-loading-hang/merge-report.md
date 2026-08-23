# 合并报告(2026-08-22)

> 批次:boss-loading-hang —— 修复「首次进入必定卡死在加载界面」bug(C1/C2/C3 三条启动链有界化+可重试+错误出口 UI)

## 结果总览

- 成功合并: ws-1/ws-2/ws-3/ws-4/ws-docs 共 5 个。ws-1..4 按依赖序串行,已于前一轮并入 dev(`5165904`,本 resume 幂等跳过);本轮收尾 ws-docs(`7b515e6`)。
- 失败/遗留: 无。5 次 merge 零冲突(文件边界互不相交,跨 WS 契约在 dev 汇合后 typecheck 验证兼容)。
- dev 已 push(`origin/dev` @ `7b515e6`);全部 5 个 worktree 已移除、5 个分支已删除。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-1 | fix/amap-load-timeout | `f5c3d17`(no-ff) | ✅ 全绿(npm test exit 0;typecheck 0;docs-check passed;diff-check 0) | 无冲突 |
| ws-2 | fix/mount-retry | `6c780dc`(no-ff) | ✅ 全绿(同上) | 无冲突 |
| ws-3 | fix/loading-error-ui | `8e05d2d`(no-ff) | ✅ 全绿(同上;ws-2 契约并入后 typecheck 兼容确认) | 无冲突 |
| ws-4 | fix/first-load-bounded | `5165904`(no-ff) | ✅ 全绿(同上) | 无冲突 |
| ws-docs | fix/docs-loading-hang | `7b515e6`(no-ff) | ✅ 全绿(合并后全量 1448 tests / 1446 pass / 2 skip / 0 fail;typecheck 0;docs-check passed;diff-check 0) | 无冲突(见下) |

- 合并后全量测试(最终 dev @ `7b515e6`):**1448 tests / 1446 pass / 2 skip / 0 fail**。其中 +5 来自 engine-polish-2 baidu-r5(`76d496c`,非本批);本批 5 分支无测试增量(ws-docs 纯文档)。
- 依赖序核对:ws-2 消费 ws-1 的 reject 语义(超时 code `AMAP_LOAD_TIMEOUT`)、ws-3 消费 ws-2 的 `mountError`/`retryMount` 契约、ws-docs 引用 ws-1..4 最终代码回填文档 —— 均按序合并,无逆向依赖。

## 冲突解决清单

- 无冲突(各 WS 文件边界互不相交;唯一共享语义点 i18n.ts 按 manifest 约定仅 ws-3 追加 key,未与其他分支交集)。
- 附:ws-docs 在其 worktree 内 `git merge dev` 时,`tech/23-map-engines.md` 出现过单一冲突区(loading-hang 回填 vs ws-g r5 回填两个追加小节),已于 merge commit `36583a8` 内「仅删 3 行冲突标记」解决,双方内容完整保留、顺序拼接;本次并入 dev(相对 base `f32d3cc`)自动合并,无冲突。

## 遗留问题

- Env-only 步骤(迁移 apply / `import:seed:apply` / AMap geocode)按铁律未执行,留给用户。
- 未做浏览器级视觉验证(无 Playwright);ws-3 失败态 UI 经契约测试 + 逐行代码审查验证,建议用户上线前人工刷新验证一次首访/断网失败态。
- ws-3 以「可选属性交叠超集」消费 ws-2 契约,dev 汇合后 typecheck 已确认兼容(ws-2 必填字段 ⊂ ws-3 超集断言方向合法)。
- ws-docs 文档(tech/16+23)内引用的「1443 tests / 1441 pass / 2 skip」为 `5165904` 时点(ws-1..4 合并后)merge-report 数据,当时准确;最终 dev @ `7b515e6` 全量 1448/1446(+5 来自 baidu-r5)。
- `boss-state.md` 中 ws-docs 行仍记为 RUNNING,终态更新由 boss 收尾。

## 最终 dev 状态

- `origin/dev` @ `7b515e6`(已 push,与本地一致)
- 5 个 fix 分支全部已删(`fix/amap-load-timeout` / `fix/mount-retry` / `fix/loading-error-ui` / `fix/first-load-bounded` / `fix/docs-loading-hang`),对应 5 个 worktree 已移除
- 未 push main、未 force-push;主树无已跟踪残留(仅其他批次的未跟踪目录)

门禁: ALL_GREEN
结论: MERGED_ALL
