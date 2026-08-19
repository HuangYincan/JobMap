# 合并报告(2026-08-19)

## 结果总览
- 成功合并: w1/w2/w3/w5/w4 × 5
- 失败/遗留: 0(全部按 manifest 顺序合入 dev)

合并顺序遵循 README:1. w1 → 2. w2 → 3. w3 → 4. w5 → 5. w4(每分支门禁绿后 push origin dev)。

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | fix/sidebar-chrome-regress | `dcf944e` | ✅ 286 pass/0 fail;typecheck ✅;docs-check ✅;diff ✅ | 无 |
| w2 | fix/profile-identity | `74877a2` | ✅ 286 pass/0 fail;typecheck ✅;docs-check ✅;diff ✅ | 无 |
| w3 | fix/work-nomore | `05786f1` | ✅ 287 pass/0 fail;typecheck ✅;docs-check ✅;diff ✅ | 无 |
| w5 | fix/viewport-refresh | `1eb0044` | ✅ 288 pass/0 fail;typecheck ✅;docs-check ✅;diff ✅ | 2 文件(maph-shell.tsx、viewport-search.test.mjs) |
| w4 | fix/work-domain-leak | `6dfcf1e` | ✅ 296 pass/0 fail;typecheck ✅;docs-check ✅;diff ✅ | 1 文件(viewport-search.ts)+ 1 测试适配 |

门禁数字含 2 skipped(需 DATABASE_URL 的 DB 用例)。最终 dev 全量:`298 tests / 296 pass / 0 fail / 2 skipped`。

## 冲突解决清单

- **w5 · `server/src/components/map-shell.tsx`(work 视口分支)**:HEAD 侧(w3)仅有 noMore 复位,
  分支侧(w5)含「替换语义 + epoch+1 + pageOffset 归零 + skipFetch + noMore 复位」,为超集 →
  整体取 w5 侧(保留 w3 noMore 语义并叠加 w5 替换语义)。
- **w5 · `server/tests/viewport-search.test.mjs`**:w3 的「全部满页 noMore=false」与 w5 的
  「existing:[] 替换语义」两个测试都要保留 → 合并为两个独立 test 块,各带完整 try/finally;
  并将 w5 测试解构适配 w3 新返回签名(`const merged =` → `const { pois: merged } =`)。
- **w4 · `server/src/lib/viewport-search.ts`**:HEAD 侧(w3)`pageSize + let noMore` 与分支侧(w4)
  `existing.filter(isRecruitmentPoi)` kind 守卫都保留 → 合并为「pageSize 声明 + kind 守卫初始化
  merged + noMore 声明」。
- **w4 · `server/tests/viewport-search.test.mjs`**(自动合并后适配):w4 的「污染池清除 domain 行」
  测试解构适配 w3 返回签名(`const { pois: merged } =`)。

> 说明:w5/w4 测试原基于 w3 合入前旧返回签名(`loadWorkViewport` 直接返回 `POI[]`),w3 改为
> `{ pois, noMore }` 后需解构适配;语义断言不变。

## 遗留问题
- 主工作树存在**并发 boss 编排进程**的未暂存改动(`.claude/agents/*.md`、`.claude/skills/boss-agent/*`、
  `CLAUDE.md`、`agent.md`、`tech/04-workflow.md` 等,及未跟踪 `resume-boss.sh`)——与本次合并无关,
  未触碰、未提交,交由 boss/用户处理。
- 未跟踪会话工件目录(`parallel-sessions/20260819-*`、`quality-scans/`)保持未跟踪,符合约定。
- 遗留 worktree `domain-map-wt-hz-poi-local` 已在收尾时确认不存在(批前已被清理)。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未执行,留给用户。
- Playwright 视觉验证(侧控栏居中、邮箱截断、身份卡高度、下拉玻璃质感、收藏 pin 按模式、工作
  平移刷新)建议由带浏览器的会话/用户补做。

## 最终 dev 状态
- dev HEAD:`6dfcf1e`(与 origin/dev 同步,ahead/behind = 0)
- 合并链:`dcf944e`(w1)→ `74877a2`(w2)→ `05786f1`(w3)→ `1eb0044`(w5)→ `6dfcf1e`(w4)
- 全部分支已删除,全部 worktree 已清理(主工作树仅剩 dev)
- 未 push main、未 force-push

门禁: ALL_GREEN
结论: MERGED_ALL
