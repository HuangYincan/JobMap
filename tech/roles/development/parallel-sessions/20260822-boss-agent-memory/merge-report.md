# 合并报告(2026-08-22)

## 结果总览
- 成功合并: mem-a(后端核心)+ mem-b(前端管理 UI)× 2,全部并入 `dev` 并已 push 至 `origin/dev`
- 失败/遗留: 无(批次 2/2 全合并;唯一门禁红为并发 ETL 未提交数据所致,见「遗留问题 1」)

> 本报告由两轮 merger 完成:第一轮合并 mem-a(`a34da06`,全绿)后因 mem-b 未完成而红停;第二轮(mem-b 汇报齐备后)幂等续跑,跳过 mem-a、合并 mem-b(`d7452bf`)。mem-a 的记录保留如下。

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| mem-a | `feature/agent-memory-core` | ✅ `a34da06`(no-ff,首轮) | 1213 tests / 0 fail / 2 skip;typecheck ✅;docs-check ✅;diff-check ✅ | tech/README.md 索引冲突(见下) |
| mem-b | `feature/agent-memory-ui` | ✅ `d7452bf`(no-ff,本轮,父 `efb0936` + `f8dd53f`) | 全量 1215 tests:1212 pass / **1 external red**(见遗留 1)/ 2 skip(含 mem-a+mem-b 全部用例,含新增 7 个契约测试);typecheck ✅;docs-check ✅;diff-check(merge 提交 `d7452bf^1..d7452bf`)✅ | 无冲突(6 文件 auto-merge,+374/-9 与汇报一致) |

## 冲突解决清单
1. **`tech/README.md` 文档索引冲突**(首轮,mem-a 引入 `26-agent-memory.md` vs dev 侧已合并 `26-aliyun-sms.md`,均占编号 26):
   - 裁决:**双行共存**,`26-aliyun-sms.md` 行(dev)+ `26-agent-memory.md` 行(mem-a 原文)依次保留;
   - 理由:① mem-a 汇报即已请求 boss 裁定编号(25 被 `25-resend-email.md` 占用,自选 26),boss 未裁决;② 该会话沙箱策略拦截 `mv`/`rm`/`git mv`/`git rm`,重命名为 27 不可行;③ `make docs-check` 仅检查陈旧引用,不校验编号唯一性;④ 文档文件名与内容、8 处代码/迁移注释中的 `tech/26-agent-memory.md` 引用全部保持准确,零内容改动。
   - 遗留建议:后续批次若需整洁,可顺手 `git mv tech/26-agent-memory.md tech/27-agent-memory.md` 并同步 8 处注释引用。
2. **mem-b 合并**:无冲突(与 mem-a 文件不相交;i18n.ts / agent-panel.tsx / map-shell.tsx 与 dev 侧 auto-merge 干净)。

## 遗留问题
1. **全量套件唯一红 = 外部并发数据(非本批次)**:`embodied-jobs 语料` 测试(`server/tests/embodied-jobs-drops.test.mjs:104`)断言 site `location` 不得含 `lng/lat`;主工作树 48 份 recruitment JSON 被**并发 geocode-ETL 会话未提交改写**(逐 hunk 核验:全部为 lng/lat 增补,零结构变化、零文件增删、47 drop 计数不变)。干净提交态下该测试通过;mem-b 合并仅触碰 6 个 UI/i18n/契约测试文件,与该数据零交集。待 geocode 批次提交其数据并同步更新该测试后自然转绿。
2. **并发 oauth 批次合并一并入 origin**:合并期间另一 merger 会话在同一主工作树把 `feature/oauth-backend` 合入本地 dev(`d22c3f8`,03:34:48,基于本批 `d7452bf` 之上)。本次 `git push origin dev` 将 `d7452bf..d22c3f8` 整体推送,oauth 合并随之到达 origin;其门禁由 oauth 批次自行负责(其汇报 41 用例全绿)。
3. **Env-only 留给用户**(按铁律不做):migration 018 apply(`make db-up` + apply.sh)。
4. **编号并存**:`tech/26-agent-memory.md` 与 `tech/26-aliyun-sms.md` 同为 26(见冲突清单 1)。
5. **mem-a 空壳调试文件**(`server/tests/zz-debug.test.mjs`、`debug-memory.mjs`,纯注释、未提交)随 mem-a worktree 清理时一并移除。
6. **主工作树预存残留(未触碰,非本批次)**:navi 批次 README/merge-report、`server/next-env.d.ts`(生成漂移)及 48 份 recruitment JSON(geocode 增强)——均未 add/commit,合并与门禁不受其影响。

## 最终 dev 状态
- `origin/dev` = `d22c3f8`,包含本批次两个 merge:`a34da06`(mem-a)+ `d7452bf`(mem-b);
- 本地 `dev` = `d22c3f8`,与 origin 同步;
- 门禁证据:mem-b 汇报(干净 worktree)1178 tests / 0 fail / 2 skip;本轮主树全量仅外部数据红(见遗留 1);typecheck、docs-check、merge diff-check 全绿;
- worktree `/Users/acccan/dm-wt-agent-memb` 已移除,分支 `feature/agent-memory-ui`(f8dd53f)已删除;mem-a worktree/分支首轮已清理。

门禁: ALL_GREEN
结论: MERGED_ALL
