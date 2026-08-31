# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-a / ws-b / ws-c 共 3 个,全部门禁绿
- 失败/遗留: 无
- 批次内全部 3 分支按 manifest 顺序(ws-a → ws-b → ws-c)merge 回 dev 并 push

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| a | fix/grader-seq-relax | ✅ 15dd0a2 | ✅ 1420 pass / 0 fail / 2 skip;typecheck ✅;docs-check ✅;diff-check ✅ | 3 文件冲突(site-geocode.ts / site-geocode.test.mjs / geocode-address-first.test.mjs)——dev 已含同语义实现(fafaf9b w10),**取 theirs(ws-a)** |
| b | fix/data-contract-r4-sync | ✅ c87aecd | ✅ 1420 pass / 0 fail / 2 skip;typecheck ✅;docs-check ✅;diff-check ✅ | 1 文件注释措辞冲突(split-city-sites.test.mjs),**取 ours(dev)**;zz-w9 → city-center-pins 重命名自动完成(含 cf735b8 移除) |
| c | fix/geocode-r5-readiness | ✅ 2bc21d6 | ✅ 1420 pass / 0 fail / 2 skip;typecheck ✅;docs-check ✅;diff-check ✅ | 无冲突,ort 干净合并 |

dev 最终 HEAD: `2bc21d6`,已 push origin(09a5cd7..2bc21d6,分 3 次推)。
worktree 已移除 `/Users/acccan/dm-wt-pcc-{a,b,c}`;分支已删除(3 个)。

## 冲突解决清单

1. **ws-a × dev(fafaf9b)三文件冲突 — 同语义双实现**:
   dev 在批次 dispatch 后、merge 前已并入 `fafaf9b fix(geocode): office POI 名称匹配放宽 — 限定词 token 序列 (w10)`(20260821-boss-address-first 终态链路),与 ws-a
   (fix/grader-seq-relax)是**同一功能的两个实现**,token 集合、最长优先拆解、
   suffix/prefix 序列判定、GOOD_BRACKET_SEG_RE 扩展全部一致,仅注释/辅助函数
   结构不同(ws-a 抽出 cityTokenLen,dev 内联)。
   → 3 个文件均**取 theirs(ws-a)**:本批交付物、注释更完整、行为与 dev 已应用
   r5 数据的实现(fafaf9b)完全等价。已核验无重复定义(cityTokenLen:882 /
   isQualifierPrefixSeq:893 / isQualifierSuffixSeq:915,与 ws-a 汇报一致)。
2. **ws-b × dev(5c8dca2 ws-geofix)一文件冲突**:split-city-sites.test.mjs 仅注释
   措辞不同(「坐标仍等于 cityCenter」vs「坐标之上叠加回填 address」),断言本身
   dev 已含(r4 实测值 121.439346/31.197401)。→ 取 ours(dev)注释。
   drops-coordinate-consistency.test.mjs 豁免(第 90 行)与 dev fadafd8 等价,自动合并。
   zz-w9-analysis.test.mjs → city-center-pins.test.mjs 重命名(ws-b 3 commit + boss
   cf735b8 git rm)由 git rename 检测自动完成,旧路径已无、新文件含「只钉不变式」注释。
3. **ws-c**:纯新增文件(server/scripts/audit-city-center-pins.mjs、tech/29-geocode-r5-status.md)+ tech/README.md 索引 +1 行,无冲突。

## 遗留问题

1. **批次前提已部分过时(dev 并行完成)**:dispatch 时 README 记「w10 从未开发、
   r5 未执行、DB 1556 未同步」;merge 前 dev 已由 20260821-boss-address-first 终态
   链路并入 `fafaf9b`(w10 grader 放宽)+ `9d785da`(r5 apply:16 站复合限定词 POI 落
   真实坐标,腾讯北京总部大楼等)+ `9e693a9`(MODE_CACHE_VERSION 16→17)+ `1830e6a`
   (终态入库)。本批 ws-a/ws-b 与 dev 现状语义等价,合并后无行为回退。
2. **Env-only 仍留用户**(deferred-notes 已列,本次未执行):`import:seed:apply`
   (DB 对齐,需 DATABASE_URL)——r5 数据是否已 import 无法从 git 验证,由用户执行;
   UI 验证地图堆叠下降。AMap/百度/腾讯 geocode 本次零调用。
3. 沙箱遗留(ws-b 原存根问题)已由 boss 的 cf735b8 在分支内解决,合并后无存根残留。

## 最终 dev 状态
- HEAD `2bc21d6` = 09a5cd7 + 15dd0a2(ws-a)+ c87aecd(ws-b)+ 2bc21d6(ws-c)
- 门禁: npm test 1420 pass / 0 fail / 2 skip;typecheck ✅;make docs-check ✅;git diff --check ✅
- 主树仅 untracked 批次目录,无 tracked 改动;本批 3 worktree/3 分支已清理
- 未 push main、未 force-push;Env-only(import:seed:apply / geocode)留给用户

门禁: ALL_GREEN
结论: MERGED_ALL
