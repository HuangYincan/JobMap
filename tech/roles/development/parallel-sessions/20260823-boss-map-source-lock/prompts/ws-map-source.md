# WS: ws-map-source — 禁用腾讯/百度底图(不删代码,只是不让用户用)

> 本 prompt 由 boss 生成。worktree 已预建(下面绝对路径),**不要 merge / push / 建分支**,
> 完成后把汇报写到批次目录(绝对路径)。

## 背景

用户报告:三家底图(高德/腾讯/百度)切换时有各种 POI 消失的 bug。
用户决策(2026-08-23):**禁用腾讯和百度底图;不用删代码,只是不让用户用。**

boss 探索结论(直接采用,不必重新推演):
- 底图引擎切换的唯一事实源是 `ENGINE_PRIORITY`:
  - `server/src/components/layers-panel.tsx` 的 `MapSourceSection` 按它渲染引擎 chip;
  - `server/src/lib/map-engine/mount.ts` 的 `resolveEngine` 按它回落;
  - `server/src/hooks/use-map-engine.ts` 挂载/重试按它取 configured 引擎列表;
  - 历史 sessionStorage 偏好(`domain-map:engine`)也经它过滤。
- 因此**只改 `ENGINE_PRIORITY` 一项**,即可让腾讯/百度在 UI 无入口、解析与回退恒为
  高德、历史偏好自动回落高德;三家引擎实现代码一行不删。

## 任务(worktree 内绝对路径)

1. `server/src/lib/map-engine/engine-registry.ts`
   - 把 `export const ENGINE_PRIORITY: MapEngineId[] = ['amap', 'tencent', 'baidu'];`
     改为 `export const ENGINE_PRIORITY: MapEngineId[] = ['amap'];`
   - 保留原注释行(或在其上方加一行注释):注明
     「2026-08-23 用户决策:三家切换有 POI 消失 bug,禁用腾讯/百度(实现代码保留,
     仅从候选列表移除);后续修好可加回」。
   - **不删** tencent/baidu 引擎描述、registerEngine、getConfiguredEngines 等任何代码。
2. `server/tests/component-contracts.test.mjs`
   - 第 773 行契约断言 `ENGINE_PRIORITY: MapEngineId\[\] = \['amap', 'tencent', 'baidu'\]`
     需同步为 `['amap']`(正则形式参照原文)。
3. 全面复查(你负责,不限于下列):
   - grep 全库 `ENGINE_PRIORITY` 的所有消费方,确认无一处硬编码假设三家;
   - 检查 `server/tests/` 里 map-engine-* 系列测试是否断言三引擎列表或
     切换可用性(如 map-engine-mount / map-engine-switch / map-engine-lifecycle /
     map-engine-loader);lifecycle 直接 import 三家实现,应不受影响——确认即可,
     若某测试断言「用户可切三家」且与本次禁用冲突,按新口径修正断言并说明;
   - 检查 `server/src/lib/map-engine/engine-preference.ts` 的 ENGINE_IDS 数组
     (sessionStorage 值校验)——**保留三家**,历史遗留值由 resolveEngine 经
     ENGINE_PRIORITY 过滤回落,不要动;
   - 检查 tech/ 文档与 agent.md 是否有「三家底图可切换」的描述段落需同步
     (文档契约:代码变更同步文档,make docs-check 必须过)。
4. 门禁全跑(见下)。

## 文件边界

- 可改:`engine-registry.ts`(仅 ENGINE_PRIORITY + 注释)、`component-contracts.test.mjs`(仅 773 行附近断言)、
  其他**经你复查确认必须同步**的测试/文档(在汇报「遇到的问题」段说明)。
- 不可改:`use-map-engine.ts`、`switch.ts`、`mount.ts`、`layers-panel.tsx`、
  `saved-overlay.ts`、`use-saved-layer.ts`、tencent/baidu 引擎实现文件。
- 不碰主树 `/Users/acccan/domain-map/` 下任何文件(汇报除外)。

## 门禁(全绿才算 PASSED)

```bash
cd /Users/acccan/dm-wt-map-source/server && npm test        # 1487 全量,须全绿(0 fail,skip 允许)
cd /Users/acccan/dm-wt-map-source/server && npm run typecheck
cd /Users/acccan/dm-wt-map-source && make docs-check && git diff --check
```

## 提交

- Conventional Commits,小步:`fix(map-engine): 禁用腾讯/百度底图(仅 ENGINE_PRIORITY 留 amap)`,
  测试断言同步可并入同一 commit。
- 提交前 `git status` 确认改动仅限边界内文件。

## 汇报

写到 **`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-map-source-lock/reports/ws-map-source.md`**:
- 做了什么(文件:行 + 一句话)
- 复查结论(ENGINE_PRIORITY 消费方清单、测试影响面)
- 「遇到的问题」段(若有)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
