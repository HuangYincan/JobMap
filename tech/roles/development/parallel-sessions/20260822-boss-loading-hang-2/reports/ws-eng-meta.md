# ws-eng-meta 汇报(2026-08-22)

## 实际改动

- `server/src/lib/map-engine/mount.ts` → 最终错误 engineId 透传补齐:
  - 原有 Error 路径(`lastError.engineId ??= lastEngineId`)核实字段名 = `engineId`,
    与 hook 侧 `classified.engineId` 映射一致,无需改名;
  - **补齐缺口**:最后一个失败**不是 Error 实例**时,原兜底 `throw new Error('[map-engine]
    所有已配置引擎挂载失败')` 不携带 engineId → hook 侧回退偏好引擎(语义错)。
    现兜底 Error 同样附着 `engineId = lastEngineId`(最后失败引擎)。签名/返回契约未动。
- `server/src/hooks/use-map-engine.ts` → mountError.engine 语义归一:
  - `setMountError` 取值 `engine: classified.engineId ?? classified.engine ?? resolved.id`
    (原 `classified.engineId ?? resolved.id`,无 err.engine 兜底);
  - **分类诊断日志 `engine: resolved.id` 硬编码 → `classified.engineId ?? resolved.id`**
    (与 mountError.engine 同口径——REPRO R4 观测到的「engine=amap 而 message=baidu」
    实际源自该诊断日志与 hook 注释,而非显示层:map-shell.tsx 小字只拼 `code · message`,
    不显示 engine,ws-3 显示层零改动);
  - MapMountError 契约注释 + catch 注释更新:engine = 实际最后失败引擎,message =
    对应引擎失败详情;watchdog 超时(无 engineId/engine)→ 偏好引擎 resolved.id
    (整链超时无法定位单引擎,诚实近似,保留)。
- `server/tests/map-engine-mount.test.mjs` → 断言更新 + 新增用例:
  - hook 契约断言更新为 `engine: classified.engineId ?? classified.engine ?? resolved.id`,
    并新增诊断日志 engine 同口径断言;
  - 新增行为用例「最后一个失败不是 Error 实例 → 兜底错误仍携带 engineId(最后失败引擎)」。

## engineId 透传链路验证(错误对象 → mountError.engine)

1. mount.ts `for` 循环 catch:`lastEngineId = engine.id`(每次失败更新,循环结束 =
   最后一个尝试/失败引擎);
2. Error 错误:`lastError.engineId ??= lastEngineId`(`??=` 不覆盖引擎自带值;三引擎失败
   错误均 `new Error` 同构,无自带 engineId 冲突);
3. 非 Error 错误:兜底 Error 携带 `engineId = lastEngineId`(新增);
4. hook catch:`classified.engineId ?? classified.engine ?? resolved.id` → MapMountError.engine。
   字段名全程 `engineId`,一致;行为测试(既有 tencent 用例 + 新增非 Error 用例)实证。

## 门禁结果

- npm test: 1460 测试,1458 通过 / 2 skip / 0 失败(新增 2 用例含在内,
  「全部候选失败 → 最终错误携带 engineId」与「非 Error 兜底 engineId」均 ✔)
- npm run typecheck: 通过(tsc --noEmit 零错误)
- make docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过(exit 0)

## 遇到的问题

1. **REPRO R4「engine=amap」观测来源澄清**:R4 截图(`page-9-ERROR_UI-2s.png`)小字为
   `script-load-failed · [map-engine] baidu load 失败…`,不含 engine 字段(map-shell 小字
   仅拼 code · message);三引擎失败错误均为 `new Error`(failBaidu/failAmap/failTencent),
   原 mount.ts Error 路径已附着 engineId → 修前 Error 场景 mountError.engine 实为 baidu。
   标注的「amap」来自 hook catch 分类诊断日志 `engine: resolved.id` 硬编码(console 输出)。
   本轮已将诊断日志与 mountError.engine 同口径修正,并收紧注释口径(不再写入
   与代码事实不符的「修前恒为 amap」表述)。
2. **临时验证脚本清理失败**:worktree 根遗留未跟踪文件 `verify-mount-engineid.mjs`
   (挂载链 engineId 行为验证脚本,rm/unlink 被本会话沙箱拒绝)。**未提交、无任何 commit
   引用**,merge 不影响主树;建议 boss 或后续会话顺手删除。
3. MOUNT_TIMEOUT 路径语义保留:watchdog 超时错误无 engineId/engine → 偏好引擎
   resolved.id(注释明示为诚实近似),任务边界确认保留。

## 证据

- 测试输出:1460 tests / 1458 pass / 2 skip / 0 fail(duration ~6.3s);
- 新增用例输出:
  `✔ 全部候选失败 → 最终错误携带 engineId(最后一个失败引擎;hook 错误态定位用)`
  `✔ 最后一个失败不是 Error 实例 → 兜底错误仍携带 engineId(最后失败引擎;mountError.engine 语义一致)`
- 提交:fa75b64(源)+ 9bb0869(测试),分支 fix/mount-error-engine,未 merge/push。

门禁: PASSED
结论: OK
