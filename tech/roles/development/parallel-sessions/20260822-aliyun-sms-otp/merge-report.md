# 合并报告(2026-08-22)

> 本批次为 **resume 续跑**:前一次 merger 因主树被并发流程(20260822-boss-agent-navi 二轮)占用而 BLOCKED,本次在并发流程结束后重跑,幂等规则下两分支均未并入 dev,直接接续完成。

## 结果总览
- 成功合并: aliyun-sms-send、aliyun-sms-docs(2/2)
- 失败/遗留: 0(Env-only 步骤按规则留给用户,见遗留问题)

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| aliyun-sms-send | feature/aliyun-sms-send(5466579) | `76eec04` merge: --no-ff | 全绿: npm test **1196 pass / 0 fail / 2 skip**、typecheck 通过、docs-check 通过、git diff --check 通过 | 2 文件冲突 → 取 dev 侧(见下) |
| aliyun-sms-docs | feature/aliyun-sms-docs(750472c) | `b595951` merge: --no-ff(无冲突自动提交) | 全绿: npm test **1202 pass / 0 fail / 2 skip**、typecheck 通过、docs-check 通过、git diff --check 通过 | 无(README 预判正确,冲突面为零) |

另含 1 个独立 commit(README「裁决补充」,boss 裁决执行):
- `5ce2f0f` docs(auth):D-04 状态 token `**CLOSED**` → `**DONE-记录**`(对齐账本图例行词表);tech/26 错误映射表 SMS_DAY_LIMITED 文案 `请明天再试` → `请稍后再试`(与 route.ts:117 实现一致;改后 docs-check / diff-check 复跑通过)

## 冲突解决清单
**merge 1(aliyun-sms-send)**,2 文件冲突,均为注释/断言 message 措辞差异,语义断言完全一致:

1. `server/tests/hooks-contracts.test.mjs`(21-33 行):dev HEAD 侧与分支侧断言同三行(`doesNotMatch` ×2 + `existsSync(file)==false`),仅注释与 message 文案不同。**取 dev 侧(ours)**。
2. `server/tests/saved-layer-sync.test.mjs`(118-122 行):同上,断言行一致,仅注释措辞不同。**取 dev 侧(ours)**。

裁决依据:两文件属 ws-1 汇报中标记的「越界顺修」(fix(saved-layer) 5466579,因 dev 基线 06bc302 删 `lib/saved-camera-sync.ts` 致 ENOENT 全红)。合并时发现 **dev 已被并发流程(saved-overlay-wipe 等)带入等价修复**(断言内容逐字一致),分支修复冗余 → 取 ours,合并结果对该两文件**净变更 0**;分支 commit 链仍完整保留在合并历史中。npm test 全绿(1196)证明修复到位,无残留。

## 遗留问题
- **Env-only(留给用户,已登记 deferred-notes.md + 账本 D-29)**:用户配置真实 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE` 后真实冒烟;未配置时路由 503 优雅降级(`SMS_NOT_CONFIGURED`)。迁移 apply / import:seed:apply / AMap geocode 均未执行。
- 主树白名单外干净;白名单文件(蓬莱.json、next-env.d.ts、其他批次台账)为并发流程在途产物,未触碰。

## 最终 dev 状态
- dev HEAD = `5ce2f0f`(76eec04 ← b595951 ← 5ce2f0f 本批次 3 提交链)
- 已 push `origin dev`(`9af00b3..5ce2f0f`)
- worktree `/Users/acccan/dm-wt-aliyun-sms-send`、`/Users/acccan/dm-wt-aliyun-sms-docs` 已 remove;分支 `feature/aliyun-sms-send`、`feature/aliyun-sms-docs` 已 -d 删除
- 未 push main、未 force-push、未动任何 Env-only 步骤

门禁: ALL_GREEN
结论: MERGED_ALL
