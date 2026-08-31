# WS4 Frontend Experience — boss-worker prompt

## 绝对路径

- 主仓库（只读，不得修改）：`/Users/acccan/Repos/huangyincan/domain-map`
- 你的 worktree：`/Users/acccan/dm-wt-job-navigation-ws4-frontend`
- 你的分支：`feature/job-navigation-ws4-frontend`
- 批次目录：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws4`
- 最终汇报：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws4/reports/ws4-frontend.md`

worktree 已由 boss 预建。所有代码、测试、文档修改与 commit 只发生在 worktree；不要 merge
回 `dev`，不要 push。`git add` 只添加你实际修改的具体路径。

## 开工前必读

1. worktree 内 `CLAUDE.md`、`agent.md`、`server/AGENTS.md`
2. `.claude/skills/liquid-glass-components/skill.md`
3. `.claude/skills/frontend-component-dev/skill.md`
4. `tech/07-frontend-design-system.md`、`tech/31` §5.3 / §8 / §9 WS4
5. `server/src/lib/map-engine/types.ts` 与 amap/tencent/baidu 的 `createCircle` 实现（polyline 对齐此模式）
6. `server/src/lib/agent-map-bridge.ts`、`server/src/components/agent-map-executor.ts`
7. `server/src/lib/navigation/route-http.ts`、`route-artifacts.ts`（`PublicRouteArtifact` 含 geometry，无 sessionId）
8. `server/src/components/map-shell.tsx`（map-canvas ~2186、mapControls ~2528、mobileDrawer ~2549）
9. `server/src/lib/commute.ts`、`poi-detail.tsx` 已有估算通勤与外部导航 URL
10. 写引擎适配前读对应 SDK 类型/注释，不要臆造厂商 API

## 已批布局（用户 2026-08-28 同意 tech/31 §8）

细化必须符合设计系统：岗位卡片 liquid glass；Explore/抽屉外壳 `--soft-strong`；
chrome `#007AFF`；12px 霜面字 `--blue-ink`；绿仅薪资/工时。

### 现状（桌面 ≥768px）

```text
┌─ rail ─┬─ Explore frost ──────────┬─ map canvas ─────────────────────────┐
│ icons  │ 搜索 / FilterPanel       │                                      │
│        │ POI 列表（无通勤分钟）    │     无折线 overlay                    │
│        │                          │                                      │
│        │                          │                      [指南针][定位]  │
│        │                          │                         [+][-]      │
│        └─ Agent 悬浮球 ───────────┴──────────────────────────────────────┘
```

### 目标（桌面）

```text
┌─ rail ─┬─ Explore frost ──────────────────┬─ map ────────────────────────┐
│ 不变   │ Work 搜索  [筛选]  [对比 n]      │  A ●━━━━━━━● B  (仅 GET 成功 │
│        │ 起点：定位/缺失提示               │    的 provider 折线)         │
│        │ 地铁 ≤45 分 · 严格命中 k          │                              │
│        │ □ 岗位 A  38 分                  │              ┌ AI 对话 ─┐   │
│        │ □ 岗位 B  44 分                  │              │ 路线摘要  │   │
│        │ □ 岗位 C  估算 51 分              │              │ [看路线]  │   │
│        │ [严格命中] [接近条件]             │              └──────────┘   │
│        ├──────────────────────────────────┼──────────────────────────────┤
│        │ 路线来源条：供应商·获取时间·路况/估算原因（不能只藏 tooltip）   │
└────────┴──────────────────────────────────┴──────────────────────────────┘
```

来源条：桌面放在地图底部、**不得挡住** zoom/locate（`mapControls` z-index 10）和
侧栏；宽度受 sidebar 偏移影响，与现有 `shifted` 模式一致。卡片仍高密度可扫描；
对比是**列式事实表**（岗位事实 + 通勤分钟 + quality），禁止 AI 总分。

### 现状（移动 ≤767px）

```text
┌ map ──────────────────┐
│ 无折线                 │
├ 抽屉 岗位列表 ─────────┤
│ 工具栏: 图层/收藏/探索/最近/AI
└────────────────────────┘
```

### 目标（移动）

```text
┌ map + overlay ─────────┐
│ A ●━━━━ B（有 artifact）│
├ 抽屉 ───────────────────┤
│ 岗位 | 对比 | 行程      │  ← 内页签，不是第 6 个工具栏按钮
│ 起点 / ≤45 分 / 命中数  │
│ 列表或事实表            │
│ [展开路线与来源]        │
├ 工具栏 5 项（AI 仍开 agent sheet）
└────────────────────────┘
```

内页签不得遮挡抽屉把手、输入框、底部安全区。`行程` 页展示来源条；AI 仍是工具栏
现有入口。

必须覆盖的状态（每种都要有可见文案，不能空白死图）：槽位缺失（无起点）、
路线加载、真实折线、估算降级、严格 0 结果、部分候选失败、路线过期（410）、
岗位下线、位置拒绝、离线/重试。

## 必须交付

按 TDD 顺序实现。生产 `providers: []`，不要假设真实道路。

### A. MapEngine polyline 契约

`MapView` 增加 `createPolyline`（名称可微调，三引擎 + mock 必须一致）：

```ts
interface MapPolylineOptions {
  path: Array<{ lng: number; lat: number }>; // gcj02
  color?: string;          // 默认 #007AFF
  dashed?: boolean;        // estimate 直线用虚线
  weight?: number;
}
interface MapPolyline { raw: unknown; remove(): void; }
```

- 路径 2..`MAX_GEOMETRY_POINTS`；非法/空 → 不挂图，可返回 no-op remove
- 百度：gcj02→bd09 与 marker 同一套转换
- 腾讯/高德：读现有 createCircle/createMarker 注释与 SDK，禁止直连业务组件里的 `AMap`/`TMap`/`BMapGL` 全局
- 更新 `engine-mock.mjs` / `amap-mock.mjs` 与三份 `map-engine-*.test.mjs`
- 坐标系转换若需要，只在引擎适配层做

### B. 桥接与 showRoute 真正执行

- `MapBridge.drawRoute(path, opts) => cleanup`；业务只经 bridge
- `agent-map-executor`：合法 `showRoute` **不再 no-op**
  1. 需要 `bridge.isReady()`
  2. `GET /api/navigation/routes/:routeId`（`credentials: 'include'`，不把 cookie 写入 JS 可读存储）
  3. 200 + geometry → `drawRoute` 实线，入 undo，可 `onAction`
  4. 401/403/404/410/5xx → **不画道路折线**，回调错误码（EXPIRED/FORBIDDEN/NOT_FOUND…），卡片可保留
  5. 禁止把 GET body 的 geometry 塞回 AgentAction / SSE / 日志
- 注入 `fetch` 以便测试无网络
- 更新 `agent-map-executor.test.mjs`：成功绘制、过期不画、geometry 动作仍拒绝

### C. 估算 vs 可信路线（产品不变量）

- `estimate` **没有** `routeId`：不得为估算结果发 `showRoute` 去 GET
- 列表/详情：复用 `commute.ts` + 已有 `amapDirectionsUrl` 显示「估算 N 分钟」+ 外部导航
- 估算直线（可选）：仅当 UI 有起终点坐标时，`drawRoute` **虚线**，并在来源条写明估算、无路况
- 来源条字段：provider、fetchedAt、trafficAware、quality；估算要有降级原因，不能只写「路线」

新建 `components/route-overlay-bar.tsx` + CSS Module（霜面，不是第三层 blur 套娃）。

### D. 通勤 chrome（Work 模式）

客户端通勤约束（不要做成打到 Postgres 的新过滤引擎；未知 filter key 不要弄坏 `/api/pois`）：

- 起点：已授权定位；拒绝/缺失 → 槽位缺失提示，不规划
- 方式 + 上限分钟（建议 slider 15–120，默认 45；方式 walk/bike/transit/drive）
- 对当前列表用 `estimateCommuteOptions` **粗筛**；严格命中 vs 接近（超过上限但最近）分 tab
- 严格 0 命中时列表为 0，并单列最接近 + 放宽说明，不得把超限画成命中
- **禁止**对每个 POI POST `/api/navigation/routes/plan`（N+1）
- 对比：2–5 列事实表（可新建 `commute-compare-table.tsx`，不要复用 Saved 的公司对比当通勤对比）；无总分
- 列表↔地图选择保持现有双向联动；选中岗位可虚线估算到起点
- `agent-panel`：`showRoute` 建议卡片加「看路线」（执行已校验动作）；有 RoutePlan 摘要时展示 quality/时长，无 polyline

### E. 移动内页签

在 **抽屉内部**（`mobileSheet === "explore"` 的内容区）增加 Work 模式三页签：
`岗位 | 对比 | 行程`。不要改工具栏五按钮信息架构。
行程页：起点、上限、来源条、过期/离线。
`embedded` Agent 仍只由工具栏 AI 打开。

键盘：页签可 focus；`prefers-reduced-motion` 缩短动画。

### F. 测试与文档

Node 测试（无 DATABASE_URL、无真实 key、无真实路况）：

1. 三引擎 createPolyline 映射 + remove
2. executor showRoute：fetch mock 200 画线；410 不画；非法动作仍拒
3. 通勤粗筛：严格 0 vs 接近；上限过滤
4. 对比表无 score 字段
5. 源码契约：map-shell 含来源条；移动 explore 含三页签；无对 `audit_events` 写入
6. i18n 中英键齐全

仓库 **没有** Playwright 依赖。不要 `npm install`。不要为截图加依赖。
布局用源码断言 + 组件测试覆盖。截图由 boss 在合并后用浏览器补。

文档（只写可验证事实）：

- `tech/31`：§8 审批状态改为「已于 2026-08-28 用户明确批准」；WS4/M3 改为已实现（写明生产仍 estimate-only，无真实路况）
- `tech/01-architecture.md`：MapView polyline + overlay；live provider 仍未实现
- `tech/07` 如需补通勤条/来源条位置
- `tech/24`：`showRoute` 客户端改为拉取 artifact 后绘制
- ADR-008 当前状态：补 overlay 已实现、仍无 live provider
- `CHANGELOG.md` 一行

## 文件边界

### 你拥有

- `server/src/lib/map-engine/types.ts` 与 amap/tencent/baidu `createPolyline`
- `server/src/lib/agent-map-bridge.ts`、`server/src/components/agent-map-executor.ts`
- 新建 route overlay bar、commute compare table、navigation client fetch helper、必要 CSS Module
- `map-shell.tsx` / `map-shell.module.css`（来源条、explore 通勤头、移动内页签）
- `filter-panel` 仅当复用现有 range/select 控件；优先独立通勤条，少改 FilterPanel 结构
- `poi-card` / `poi-list` 通勤分钟与估算徽章
- `agent-panel.tsx` 看路线 / 摘要（不改面板外壳布局结构，只加卡片内容）
- `i18n.ts` 新键
- 对应 `server/tests/**` 与 engine mocks
- 上列 tech/ 与 CHANGELOG

### 明确不碰

- `db/**`、migration、`audit_events`
- `.env*`、live provider adapter、`providers/` 真适配器
- WS0 `navigation-eval-cases.json` 契约内容
- 登录/Profile/Saved 公司对比语义（通勤对比是新表，不要改 Saved 两家对比的产品含义）
- crawler、npm/pip 依赖
- 不要把 Agent 球改成另一种信息架构

## 质量要求

- TDD；2 空格；不新增依赖
- 日志/UI 无 key、无 cookie 明文、无完整 geometry 数组 dump
- 频繁小步 Conventional Commits

## 门禁

```bash
cd /Users/acccan/dm-wt-job-navigation-ws4-frontend/server
node --test --test-concurrency=1 tests/map-engine-amap.test.mjs tests/map-engine-tencent.test.mjs tests/map-engine-baidu.test.mjs tests/agent-map-executor.test.mjs
npm test
npm run typecheck
cd /Users/acccan/dm-wt-job-navigation-ws4-frontend
make docs-check
git diff --check
git status --short
```

全量 `npm test` 必须串行。已知 `llm-validate` CLI 与重任务并行会 30s 超时。

## 汇报格式

含实际改动、不变量（estimate 不伪装道路、无 N+1 plan、来源条可见、移动不是第 6 工具栏按钮）、
门禁计数、剩余风险、commits/tip。

末两行必须精确：

```text
门禁: PASSED
结论: OK
```

stdout ≤ 3 行，不贴代码。
