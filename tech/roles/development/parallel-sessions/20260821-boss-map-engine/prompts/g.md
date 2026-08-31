# Workstream g — feature/map-engine-docs(文档收尾,仅零重叠项)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-g`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/g.md`(末两行 token,见文末)。

## 背景(冲突防护硬约束)

轮 1-3(引擎内核/三引擎/UI 切换)已合并进 dev。本 WS 收尾文档与清理。**注意:项目有活跃批次 `20260821-docs-maintenance` 正在改 `tech/01-architecture.md`、`tech/03-plugin-system.md`、`tech/06-decisions.md`、`agent.md`——这些文件一律不碰**(boss 裁决 defer 到后续独立文档批次)。

## 任务

### 任务 1:`tech/23-map-engines.md`(新建,收尾文档)

综合各 ws 汇报(boss 已把 vendor 核实记录转交本批次目录,见 `reports/d.md`、`reports/e.md`)编写:
- 引擎插件架构:MapEngine/MapView/MapSearchProvider 三层接口、引擎注册表与优先级(AMap > Tencent > Baidu)、key 矩阵(AMAP_WEB_KEY/BAIDU_MAP_AK/TENCENT_MAP_KEY + NEXT_PUBLIC_AMAP_KEY/NEXT_PUBLIC_TENCENT_JSAPI_KEY/NEXT_PUBLIC_BAIDU_AK)
- 坐标规范:gcj02 为规范坐标,百度引擎 bd09 边界转换(含 coord-utils 引用)
- 样式支持矩阵:normal/satellite/whitesmoke 在每家引擎的形态与降级语义
- 切换编排:switchMapEngine 流程、localStorage 偏好、自动/手动选择语义
- 后端 geocode 链:provider 注册表、固定链顺序、配额切换(引用 site-geocode.ts 既有注释)
- 冒烟记录:各 ws 汇报中的自检结果;已知未验证项(如腾讯真实 key 冒烟缺口,注明 deferred)
- **非目标(明确写入)**:引擎热插拔插件运行时(注册表是静态 MODES 式)、后端 chain 顺序配置、多引擎同时加载

### 任务 2:删除 `server/src/lib/map-adapter.ts`

- 先确认零引用:`grep -rn "map-adapter\|getMapAdapter" server/src server/tests`(应无结果,轮 2 map-shell 迁移已完成)
- 删除该文件(6 行空壳,seam 已被 map-engine 取代)

### 任务 3:契约测试收尾

- 检查 `server/tests/component-contracts.test.mjs`(轮 1/3 已追加断言):确认含 `new window.AMap` 从 map-shell 消失断言与引擎 env 名断言;必要时补充「map-adapter.ts 不存在」断言

## 文件边界

- **只允许改**:`tech/23-map-engines.md`(新)、`server/src/lib/map-adapter.ts`(删除)、`server/tests/component-contracts.test.mjs`(收尾追加,可选)
- **绝对不碰**:`tech/01-architecture.md`、`tech/03-plugin-system.md`、`tech/06-decisions.md`、`agent.md`、`CLAUDE.md`、`server/docs/**`、`server/.env.example`(均属他批或他 WS)

## 门禁

1. `cd /Users/acccan/dm-wt-eng-g/server && npm test`(全绿零漂移)
2. `cd /Users/acccan/dm-wt-eng-g/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-g && make docs-check`、`git diff --check`(tech/23 格式对齐既有 tech 文档风格)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/g.md`。内容:tech/23 结构摘要、map-adapter 删除确认(grep 证据)、契约测试收尾项。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

## 【轮 4 派发附录 — boss 裁决 2026-08-21(轮 3 合并后现状)】

轮 1-3 已合并(内核/三引擎/map-shell 迁移/UI 切换)。你的任务追加两项 boss 裁决:

### 追加任务 A:`BasePOI.source` 联合扩展(boss 裁决,来自 ws-d)
- 现状:ws-d 报告腾讯引擎归一化沿用 `source: 'amap'`(因 `BasePOI.source` 闭合联合为 `'amap' | 'seed' | 'api'`,无 'tencent'),会误导持久化判定。
- 任务:扩展 `BasePOI.source` 联合加 `'tencent'` 与 `'baidu'`(类型定义位置以实际为准,可能 `amap-api.ts` 或公共类型文件),并让 `tencent-engine.ts` / `baidu-engine.ts` 的归一化输出各自 `source: 'tencent'` / `'baidu'`。**相应测试断言同步**(tencent/baidu 引擎测试中 source 断言)。
- 边界扩展:允许改 `server/src/lib/amap-api.ts`(仅类型联合,行为不变)、`server/src/lib/map-engine/tencent/tencent-engine.ts`、`server/src/lib/map-engine/baidu/baidu-engine.ts`(仅 source 值 + 相关归一化)、`server/tests/map-engine-tencent.test.mjs`、`server/tests/map-engine-baidu.test.mjs`(断言同步)。其余边界不变。

### 追加任务 B:tech/23 汇总三引擎 vendor 核实
- 读 `reports/c.md`、`reports/d.md`、`reports/e.md` 中的 vendor API 核实记录(脚本 URL、API 命名、已知限制),汇总进 `tech/23-map-engines.md`;所有「[冒烟待验]」项(沙箱禁网未实机核实)在 tech/23 中标注「待真实 key 冒烟回填」(deferred #1/#2)。
- tech/23 中体现:切换后底图样式回退快照语义(deferred #5)、非 AMap 引擎蓝点行为(deferred #6)——一句话注明即可。
