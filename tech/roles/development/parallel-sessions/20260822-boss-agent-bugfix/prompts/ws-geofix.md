# WS-geofix — 基线坐标断言修复(geocode r4 遗留)(boss 派发,mini worker)

## 背景

ws-clearfix 门禁抽验发现 dev 基线 2 个测试失败(与 clearfix 无关,零漂移;失败由 geocode r4
批次 `3e6deb3` 的坐标数据更新引入,20260821-boss-address-first)。不修会卡死后续所有 merger 门禁。

涉及测试(已知):`server/tests/` 下 extract-embodied-jobs / geocode-dropfiles-coverage /
embodied-jobs-drops / qqdoc-jobs 中 2 项坐标断言失败:
1. **qqj 主站坐标未更新期望**(geocode r4 更新了坐标,测试期望过时);
2. **蔚来-site-绍兴落杭州框**(geocode 结果与测试框断言不符)。

**裁决原则**:数据质量优先——若数据错(geocode 结果真的错位),修数据源/重 geocode 属 Env-only,记 deferred,
只把测试改为「记录现状」或修测试框逻辑;若测试期望过时(坐标确实更新),更新期望。**任何修改必须带证据**:
用数据文件实际坐标 + geocode 工具链行为说明,不得猜测。

worktree: `/Users/acccan/dm-wt-agent-geofix`(分支 `fix/geocode-r4-tests`,已从 dev `7c16766` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-bugfix/reports/ws-geofix.md`

## 任务

1. 复现:`cd /Users/acccan/dm-wt-agent-geofix/server && npm test 2>&1 | grep -B2 -A8 "✖\|not ok\|failing"` 定位确切失败用例与断言;
2. 逐项判定:
   - 数据文件实际坐标(`server/data/` 或 crawler 产物,按测试引用路径查)vs 测试期望;
   - 测试期望过时 → 更新期望(commit 说明「期望对齐 r4 实际坐标」);
   - 数据疑似错位(如绍兴站点坐标落入杭州范围)→ 不改数据(Env-only,geocode 重跑留给用户),
     测试侧改为**事实断言**(不锁错框,如断言「站点在绍兴市范围内」或按实际数据更新,证据写清);
3. 目标:dev 基线 npm test **全绿**;不引入新数据改动;回归零漂移。
4. 若判定需用户决策(数据重跑/口径)→ 写进汇报「待 boss 裁决」,不自行改数据。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-geofix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-geofix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(test): ...` 或 `test(...): ...`);不 push/不切分支;只动测试文件(或证据充分时的数据文件,须在汇报注明)。

## 回报

写 `reports/ws-geofix.md`(失败用例/判定证据/改动/门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
