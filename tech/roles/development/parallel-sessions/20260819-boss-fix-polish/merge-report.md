# 合并报告(2026-08-19)

批次:`20260819-boss-fix-polish`(Bug1 视口空白 / Bug2 公司 icon / Profile 投递行可点击)

## 结果总览

- 成功合并: ws1/ws2/ws3/ws4 全部 4 个(按 manifest 顺序,门禁逐分支全绿)
- 失败/遗留: 无(0 红停)
- dev 已逐分支 push,最终 `a79c941`;4 个 worktree 与 4 个分支均已清理

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws1 | fix/work-viewport-blank | 49b586f(no-ff) | 376 pass / 0 fail(2 skip)/ ✓ / ✓ / ✓ | 无冲突 |
| ws2 | fix/marker-leak | 93e6da8(no-ff) | 385 pass / 0 fail(2 skip)/ ✓ / ✓ / ✓ | 无冲突(只动 marker 层+测试) |
| ws3 | fix/company-icons | eff0708(no-ff) | 397 pass / 0 fail(2 skip)/ ✓ / ✓ / ✓ | 无冲突(独立 logo 链路) |
| ws4 | feat/profile-applications-open | a79c941(no-ff) | 398 pass / 0 fail(2 skip)/ ✓ / ✓ / ✓ | map-shell.tsx / component-contracts 自动合并(ws1 视口段 vs ws4 接线段无重叠) |

门禁基线说明:每次 merge 后均在 dev 工作树完整重跑
(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`),
4 轮全绿,无红停。合并期间无任何冲突文件需手工取舍。

## 冲突解决清单

无 —— 4 个分支全部自动合并(ort 策略),无需按「不碰」取舍。

## 遗留问题

1. **ws2 worktree 强制移除**:worktree 内 untracked `tests/repro-marker-leak.mjs`(S1–S6 诊断脚本)
   随 worktree 删除而丢弃(沙箱禁止复制到主仓库,无法保留);其内容/场景已完整记录于
   `reports/ws2.md`,且已被已合并入 dev 的 `marker-leak.test.mjs`(9/9 契约用例)覆盖。无功能损失。
2. **ws3 worktree 强制移除**:untracked `server/tests/probe-favicon.test.mjs`(零断言探针)
   随 worktree 删除(内容见 `reports/ws3.md` + ADR-007);未进入 dev,无影响。
3. **Env-only 步骤未做**(按铁律留给用户):icon 存量修复需 `import:seed:apply`(写库)+ 缓存 bump;
   详见 deferred-notes.md。
4. **ws2 浏览器实机验证未执行**(worker 无浏览器工具):以 mock 契约测试承载不变式;
   如需实机截图留档,建议 boss 派带浏览器会话补跑(dev server :3000,杭州↔上海往返 ×2 后
   断言 marker 计数 == catalog 数)。
5. **seed-data.ts 52 个硬编码 google s2 logoUrl** 未动(超 ws3 边界):DB 读路径对已有值保留,
   浏览器端旧 URL 加载失败回退 seed emoji;换新服务 URL 需另开 WS(已记录,未越界)。
6. favicon.im 为国内 CDN 选型,上线后浏览器端抽查列为风险项(ADR-007 已记)。

## 最终 dev 状态

- dev tip:`a79c941`(已 push origin/dev;未 push main、未 force-push)
- 合并链:49b586f(ws1)→ 93e6da8(ws2)→ eff0708(ws3)→ a79c941(ws4)
- 主工作树干净,无残留 worktree / 分支

门禁: ALL_GREEN
结论: MERGED_ALL
