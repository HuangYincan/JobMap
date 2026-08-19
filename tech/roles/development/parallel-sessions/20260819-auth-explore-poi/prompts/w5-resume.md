# WS w5 续作(resume)—— 完成「最近点击回实体」

> 批次:20260819-auth-explore-poi | worktree: `/Users/acccan/dm-wt-w5`(同一 worktree/分支 `feat/recent-entity`)

## 发生了什么

你(w5 前一个 worker 会话)在 **$3 预算耗尽时被中断**,没有提交任何 commit。worktree 有**未提交修改**(10 个文件,`git status`/`git diff` 查看):search-history route、map-shell.tsx、recent-panel.tsx、account-store.ts、account.ts、guest-search-history.ts、i18n.ts、session-store.ts、account.test.mjs、guest-search-history.test.mjs。

## 续作步骤

1. **先盘点,不重做**:`git status` + `git diff` 审阅已有改动。方向正确就继续,不要回退。**先跑 `cd server && npm run typecheck` 与 `cd server && npm test` 看破损面**,把不一致处补齐(可能处于重构中间态)。
2. **对照原任务清单逐项确认完成度**(原 prompt:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-auth-explore-poi/prompts/w5.md`,务必读):
   - (1) SearchHistoryEntry 实体引用字段(account.ts)。
   - (2) 记录路径:guest localStorage + 登录用户 /api/me/search-history POST,旧数据兼容。
   - (3) 点击回实体:handlePickRecent 有 entity → fly + 开详情(照 handlePickSaved 模式),失败/无 entity → 回退搜索回放。
   - (4) DB 迁移 `db/migrations/00X_recent_entity.sql`(未 apply,Env-only);**迁移未 apply 时 /api/me/search-history 读路径不能崩**。
   - (5) recent-panel 展示(可选小改)。
   - (6) 测试:guest-search-history.test.mjs 实体持久化/旧数据兼容;点击分支纯函数测试;component-contracts 保持绿。
   - 缺什么补什么。
3. **提交**(小而清晰,Conventional Commits;既有未提交改动按主题归入合理 commit)。
4. **门禁全绿**:
   ```bash
   cd /Users/acccan/dm-wt-w5/server && npm test && npm run typecheck
   cd /Users/acccan/dm-wt-w5 && make docs-check && git diff --check
   ```
   测试红就修,不绕过。
5. **写汇报** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-auth-explore-poi/reports/w5.md`:模型设计、记录点、点击流程(file:line)、迁移方案、测试;遇到的问题(若有)。末两行精确 token:
   ```
   门禁: PASSED | FAILED
   结论: OK | BLOCKED: <一句话问题>
   ```

## 文件边界(同原 prompt)

只动 w5 拥有的区域(handlePickRecent、suggestion 选中记录路径、recent-panel、guest-search-history、search-history route/store 区域、account.ts 的 SearchHistoryEntry);不碰 map-shell 的 Scale/load/搜索框/openMobileAccount 区域(其他 WS 拥有)。

不要 merge / push / 建分支;不碰主工作树。
