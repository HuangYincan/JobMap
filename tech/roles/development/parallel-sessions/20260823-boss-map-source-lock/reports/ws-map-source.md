# ws-map-source 汇报(2026-08-23)

## 实际改动

- `server/src/lib/map-engine/engine-registry.ts:16-22` → `ENGINE_PRIORITY` 由 `['amap','tencent','baidu']` 改为 `['amap']`,注释升级为 2026-08-23 用户决策说明(禁用腾讯/百度,实现保留,修好可加回);tencent/baidu 描述、`registerEngine`、`getConfiguredEngines`、`resolveEngine` 等代码一行未删。
- `server/tests/component-contracts.test.mjs:772-773` → 契约断言正则同步 `['amap']`(附决策注释)。
- `server/tests/map-engine-selection.test.mjs` → 5 处按新口径修正(断言「用户可切三家」与本次禁用冲突的用例):
  - L69 `deepEqual(ENGINE_PRIORITY, [...])` → `['amap']`;
  - 「全配」用例:三 key 都在但 configured 只含 amap,`resolveEngine('tencent'/'baidu')` 均回落 amap;
  - 「单配只有 tencent」重写为「仅 tencent key(禁用引擎)→ 零候选,resolveEngine 返回 null」;
  - 「preference 优先」重写为「历史偏好 tencent → 读回原样(ENGINE_IDS 保留三家),resolveEngine 过滤回落 amap」;
  - 「preference 未配置回落」更名为「preference 指定禁用引擎:未在候选 → 回落 amap」(语义不变,原因从「未配置」变为「禁用」)。
- `tech/23-map-engines.md` → 背景节「用户可在面板切换引擎」句 + 注册表节 `ENGINE_PRIORITY` 代码行同步为 `['amap']`,并加决策说明块(唯一事实源、历史偏好自动回落、旧 deferred #4「三家同配真实冒烟」随禁用失效);顺带修正背景节过时的「偏好写 localStorage」表述(代码早已是 sessionStorage)。

## 复查结论

**ENGINE_PRIORITY 消费方清单(全库 grep,无一处硬编码假设三家):**
- `layers-panel.tsx:61` MapSourceSection 按它 map 渲染 chip → 只剩高德 chip,零改动(边界外);
- `mount.ts resolveEngine` / `use-map-engine.ts:49,359` 挂载/重试按 `getConfiguredEngines()`(ENGINE_PRIORITY 序)→ 解析与回退恒为高德,零改动(边界外);
- `engine-preference.ts ENGINE_IDS` 保留三家(历史 sessionStorage 值校验),由 resolveEngine 过滤回落——按任务书未动;
- `types.ts:20` 注释、`server/README.md:45` 回退语义描述均为泛化表述,无需改。

**测试影响面(map-engine-\* 系列):**
- `component-contracts.test.mjs:773` + `map-engine-selection.test.mjs` → 已同步(见上);
- `map-engine-mount.test.mjs` / `map-engine-switch.test.mjs` → 引擎由参数 DI 注入,零断言 ENGINE_PRIORITY 内容,无冲突;
- `map-engine-lifecycle.test.mjs` → 直接 import 三家实现,与候选列表无关,确认无影响;
- `map-engine-loader/amap/tencent/baidu/coord/tencent-style` → 引擎实现级测试,无冲突。

**文档:**
- `tech/23-map-engines.md` 已同步;`agent.md:159`「底图切换(右上)」为布局描述(切换入口仍存在,只是单引擎),未改;本批 `deferred-notes.md` 为空,无新增 deferred。

## 遇到的问题

- `map-engine-selection.test.mjs` 的修正超出 prompt 明列的两个文件边界,但属「经复查确认必须同步的测试」授权范围(4 个用例断言三家切换/三引擎列表,不改则门禁红),已在改动说明,供 boss 复核。
- `tech/23-map-engines.md` 背景节「偏好写入 localStorage」与代码(sessionStorage)不符,系历史过时表述,借本次文档同步顺带修正。
- 无其他问题,无 BLOCKED。

## 证据

- `npm test`:1487 tests / 1485 pass / 0 fail / 2 skip(与基线一致)。
- `npm run typecheck`:通过;`make docs-check`:通过;`git diff --check`:通过。
- 提交:
  - `e36176e` fix(map-engine): 禁用腾讯/百度底图(仅 ENGINE_PRIORITY 留 amap)
  - `e901c2e` docs(map-engine): 同步 ENGINE_PRIORITY 只留 amap 的禁用决策(2026-08-23)
- 工作树干净,分支 `feature/map-source-lock` 未 merge 未 push。

门禁: PASSED
结论: OK
