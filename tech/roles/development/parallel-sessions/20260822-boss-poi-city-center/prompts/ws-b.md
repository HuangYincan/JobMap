# Workstream ws-b — fix/data-contract-r4-sync(r4 数据契约测试对齐 + zz-w9 重命名)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree 内开发,不 merge、不 push、不碰主树。**
汇报写入批次目录 reports/ws-b.md(末两行 token,见文末)。

## 背景

geocode r4 数据(commit `3e6deb3`, 2026-08-22)已入库 dev(288 站落真实坐标,上海 376→347),
但**对应的数据契约测试更新散在两个未合并分支上**:

- `fix/geocode-r4-tests`(worktree /Users/acccan/dm-wt-agent-geofix):`ae214aa`(qqj-临界点主站
  坐标期望对齐 r4 实际值)、`fadafd8`(杭州框清扫豁免真实 geocode 坐标——邻市办公点)
- `fix/geocode-grader-relax`(worktree /Users/acccan/dm-wt-grader):`6193ba1`(r4 坐标修正后
  数据契约更新:邻市真实 geocode 豁免 + 临界点主站真实坐标)

另:遗留项 `server/tests/zz-w9-analysis.test.mjs`(20260821-boss-address-first 批次的永久
数据契约测试,文件名 zz- 前缀因当时会话沙箱限制无法删除临时文件而遗留)需要重命名为语义名。

## 任务

1. **对齐 r4 数据契约测试**:读两个未合并分支的测试 diff(参考命令见下),把这些「r4 坐标
   修正后的数据契约更新」落地到本 worktree:
   - 杭州框清扫豁免:真实 geocode 坐标(邻市办公点)不应被误判为「应清扫」
   - qqj-临界点主站坐标期望对齐 r4 实际值
   - 其他 r4 相关契约断言
   **落地方式**:参考分支 diff,按 dev 当前代码重新实现(不要 cherry-pick/merge);若 dev
   现状已含等价更新,如实报告「无需改动」。
2. **zz-w9 重命名**:`server/tests/zz-w9-analysis.test.mjs` → `server/tests/city-center-pins.test.mjs`
   (git mv 保留历史;文件内注释同步更新,去掉 zz-w9 字样,补一句「城市中心钉点数据契约:
   中心钉点站语义与数据一致,只钉不变式不钉会漂移的计数」)。
3. **验证中心钉点数据契约仍绿**:该测试逐站断言「中心钉点站 城市名地址→留在中心 /
   非城市名地址→可重跑」——r4 数据(3e6deb3)入库后此测试必须仍 pass(它只钉不变式)。
   若 r4 后有断言空洞/误报,按「只钉不变式」原则修正并记录。

## 参考命令(只读)

```bash
git diff dev..fix/geocode-r4-tests --stat
git diff dev..fix/geocode-r4-tests -- server/tests/
git diff dev..fix/geocode-grader-relax --stat   # 只看测试文件部分(该分支还含无关的 engine-polish-2 文件删除,忽略)
git diff dev..fix/geocode-grader-relax -- server/tests/
```

注意:fix/geocode-grader-relax 分支还删了一批 `20260822-boss-engine-polish-2/prompts|reports`
文件,与本次无关,**忽略那部分**;只取测试文件相关改动。

## 文件边界

- 只改:`server/tests/` 下的数据契约测试(zz-w9 重命名 + r4 契约对齐)
- 不碰:site-geocode.ts / geocode 脚本 / 数据文件 / 前端 / 文档

## 门禁(全部通过才算 OK)

```bash
cd /Users/acccan/dm-wt-pcc-b/server && npm test
cd /Users/acccan/dm-wt-pcc-b/server && npm run typecheck
cd /Users/acccan/dm-wt-pcc-b && make docs-check
git diff --check
```

参考基线(主树 2026-08-22 实测):全量测试 ~1360+ pass / 0 fail / 2 skip。频繁小步 commit
(Conventional Commits: `test(data): …` / `test(geocode): …`)。

## 回报(写入 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/reports/ws-b.md)

- 两个未合并分支的测试 diff 清单(每条:分支 commit → 落地方式:已落地/已含等价/dev 不需)
- zz-w9 重命名确认 + 文件内注释更新点
- 门禁结果 + 遇到的问题 + 证据(测试摘要行、commit 列表)
- 末两行 token(必须精确):
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

**不要 merge、不要 push、不要碰主树。worktree 已预建。**
