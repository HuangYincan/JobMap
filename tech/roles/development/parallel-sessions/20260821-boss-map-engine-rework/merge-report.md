# 合并报告(2026-08-22)— 轮 2:ws-2/ws-3/ws-4

> 轮 1(ws-1 feature/poi-contract)已于 2026-08-21 完成并入 dev(527e631,已 push);本报告为轮 2。

## 结果总览

- 成功合并: ws-2 feature/poi-controller、ws-3 feature/engine-switch-lifecycle、ws-4 feature/engine-zindex(3 个分支,按序)
- 失败/遗留: 无(ws-5 未派发,跳过;三个分支门禁全绿)
- **push: 未完成,被权限系统拦截**(见「遗留问题」;本地 dev 已含全部 3 个 merge commit,tip 8abb1f9,origin/dev 仍为 527e631)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| 2 | feature/poi-controller | 无冲突(ort 干净,merge a028d44) | test ✅ 1075 tests / 1073 pass / 2 skip / 0 fail;typecheck ✅ 0 error;docs-check ⚠️ 基线红(非本批);diff --check ✅ | 无冲突。合并 6 文件:map-markers.ts + amap-mock.mjs + 4 测试文件(含 map-engine-switch.test.mjs 白名单外 mock 契约化,仅测试、switch.ts 零改动,boss 已裁决) |
| 3 | feature/engine-switch-lifecycle | 无冲突(ort 干净,merge a787bc2;map-engine-switch.test.mjs 自动合并双方) | test ✅ 1083 tests / 1081 pass / 2 skip / 0 fail;typecheck ✅ 0 error;docs-check ⚠️ 基线红(非本批);diff --check ✅ | 无冲突。map-engine-switch.test.mjs 为 ws-2/ws-3 共享文件,ort 自动合并**保留双方**(已核实:ws-2 契约 wrapper mock `contractCalls`/`raw` 与 ws-3 rollback/abort/重入用例并存,switch.ts 源码零改动)。合并 5 文件:switch.ts + use-map-engine.ts + map-shell.tsx + 2 测试文件 |
| 4 | feature/engine-zindex | 无冲突(ort 干净,merge 8abb1f9) | test ✅ 1088 tests / 1086 pass / 2 skip / 0 fail;typecheck ✅ 0 error;docs-check ⚠️ 基线红(非本批);diff --check ✅ | 无冲突。合并 6 文件:map-shell.module.css + tencent-engine.ts + baidu-engine.ts + 3 测试文件,与 ws-2/ws-3 文件零重叠 |

## 冲突解决清单

三 merge 全部 ort 干净合并,零手动冲突解决。唯一共享文件 `server/tests/map-engine-switch.test.mjs`(ws-2 契约化 + ws-3 编排断言)自动合并成功,双方内容均保留(已 grep 核实);「保留双方测试 + 契约 wrapper mock 形态」与任务书裁决一致。

## docs-check 基线红说明(非本批引入)

`make docs-check` 退出码 1,失败来源全部为其他会话批次目录的自匹配文件(复述 grep 正则本身),dev HEAD 基线上即可复现:`20260821-boss-agent-thinkfix/merge-report.md:20`、`20260821-boss-tencent-geocode/merge-report.md:17`、`20260821-boss-address-first/reports/w1.md`、`20260821-boss-map-engine/reports/fix-tencent-markers.md`、`20260821-candcat-list/merge-report.md` 等。本批 `git diff 527e631..HEAD --name-only` **零 `.md` 文件、零 `server/data/**`、零 `tech/01-architecture.md`/`03-plugin-system.md`/`06-decisions.md`/`agent.md`**(冲突防护已验证)。待 boss 派 docs 修复批次或 docs-check 排除 `parallel-sessions/`。

## 遗留问题

1. **`git push origin dev` 未完成**:
   - 第一次尝试:`SSL_ERROR_SYSCALL`(github.com:443 网络错误,非拒绝)。
   - 重试:被 Claude Code auto mode classifier 拒绝(Out of Place Publication —— 将合并后的 dev 推送到公开远端,需用户级授权)。未以任何形式绕过;dev 本地 tip `8abb1f9` 已含全部 3 个 merge(本地 commit a028d44 / a787bc2 / 8abb1f9),**origin/dev 仍停在 527e631**。
   - 待用户授权后执行 `git push origin dev` 即可完成收尾(merge 与门禁全部已完成,无需重跑)。
2. docs-check 基线红(见上),待 boss 派 docs 修复批次。
3. TMap 全局版(MultiMarker)content 降级、TMap/BMapGL DOM 类名浏览器实测复核 —— 均为 ws 汇报中已记的 deferred 项(boss deferred-notes)。

## 最终 dev 状态

- dev tip: `8abb1f9`(merge: feature/engine-zindex),含轮 2 全部 3 个 merge;本地已含,origin 未同步(见遗留问题 1)
- 清理已完成:`git worktree remove` rw2/rw3/rw4 成功;`git branch -d feature/poi-controller feature/engine-switch-lifecycle feature/engine-zindex` 成功(`git branch --merged dev` 确认)
- 未 push main、未 force-push;Env-only 步骤未做(无)

门禁: ALL_GREEN
结论: MERGED_ALL

---

# 合并报告 — 轮 3(2026-08-22):ws-5 收尾

> 轮 1/轮 2 明细见上文;本段为轮 3(本批最后一轮)。

## 结果总览

- 成功合并: ws-5 feature/engine-search-cleanup(1 个分支,merge `95a102d`,ort 无冲突)
- 失败/遗留: 无(本批轮 1-5 全部 5 个分支已按序并入本地 dev)
- **push: 未完成,被权限系统拦截**(与轮 2 同因:Create Public Surface,推送公开远端需用户级授权;本地 dev 已含轮 2+3 全部 4 个 merge commit,tip `95a102d`,**origin/dev 仍停在 `527e631`**,待用户授权一次 push 完成收尾)

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| 5 | feature/engine-search-cleanup | 无冲突(ort 干净,merge 95a102d) | test ✅ 1098 tests / 1096 pass / 2 skip / 0 fail;typecheck ✅ 0 error;docs-check ⚠️ 基线红(非本批,来源同上段,本批零 .md 违例);diff --check ✅ | 无冲突。合并 5 文件:poi-service.ts(关键词回退走活跃引擎 provider)+ map-shell.tsx(徽章摘除按能力分派)+ 新增 map-engine-lifecycle.test.mjs + poi-service.test.mjs 追加 + tech/23-map-engines.md 追加(ws-5 收尾回填) |

## 冲突解决清单

ort 干净合并,零手动冲突解决。本批累计 4 个 merge(轮 2 三个 + 轮 3 一个)全部无冲突;`git diff --check` 通过。

## docs-check 基线红说明(非本批引入)

同轮 2:失败唯一来源为其他会话批次目录(parallel-sessions/)自匹配文件(复述 grep 正则本身),dev HEAD 基线上即可复现,本批 merge 零 .md 违例(tech/23-map-engines.md 追加段已核)。待 boss 派 docs 修复批次或 docs-check 排除 `parallel-sessions/`。

## 遗留问题

1. **`git push origin dev` 未完成**(轮 2 + 轮 3 同因):被 Claude Code auto mode classifier 拒绝(Create Public Surface —— 推送公开远端需用户级授权)。未绕过;本地 dev tip `95a102d` 已含本批全部 4 个 merge(轮 2:a028d44/a787bc2/8abb1f9;轮 3:95a102d),**origin/dev 仍停在 527e631**。待用户授权后 `git push origin dev` 一次即可收尾,无需重跑门禁。
2. docs-check 基线红(见上),待 boss 派 docs 修复批次。
3. ws-5 deferred(tech/23 已记):map-shell distance overlay(距离圈/手柄)仍持 `.raw` 直调 AMap 专属 API,腾讯/百度引擎下同款风险(当前 UI 无入口,风险面小,建议后续 fix WS 契约化);TMap/BMapGL 真机呈现复核需 key + 浏览器(headless 无法执行)。

## 最终 dev 状态

- dev tip: `95a102d`(merge: feature/engine-search-cleanup),本地已含本批全部 5 个分支;origin 未同步(见遗留问题 1)
- 清理已完成:`git worktree remove /Users/acccan/dm-wt-rw5` 成功;`git branch -d feature/engine-search-cleanup` 成功;轮 2 的 rw2/rw3/rw4 + 分支清理上轮已完成
- 未 push main、未 force-push;Env-only 步骤未做(无)

门禁: ALL_GREEN
结论: MERGED_ALL
