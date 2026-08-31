# Session Prompt — WS4: 工作模式视口按需加载 + LOD + 在招呈现

> 这是 Domain Map 并行开发的一个独立 Agent 会话。先读 `CLAUDE.md`、`agent.md`、`tech/18-national-scale-plan.md`、`tech/07-frontend-design-system.md`、`.claude/skills/frontend-component-dev/`,再开工。
>
> **第一步(必做):自己创建 worktree。** 主工作树在 `dev`,你是全新会话。开工前先:
> ```bash
> git switch dev && git pull --ff-only origin dev
> git worktree add -b feature/work-viewport-lod ../dm-wt-ws4 dev
> cd ../dm-wt-ws4
> ```
> 之后所有开发/提交都在该 worktree 内完成;**不要在主工作树(dev)上直接改文件**。worktree 是本会话的独立工作区,其他并行会话(WS1/WS2/WS3)各有各的,互不干扰。完成后由你负责移除。

## 背景

- 工作模式数据已入库(Postgres 优先,79 pin 杭州)。现在要让地图**随视角变化按需加载**(全国范围),并按**缩放层级(LOD)**展示不同档位公司,且只突出**在招中**真实岗位。
- 你负责**前端**:工作模式的视口加载 + 层级过滤 + 在招呈现。Domain 模式(主地图)**保持刷新才更新,不实现视口加载**(高德 API 负载/余额原因)。
- 服务端 `filters.maxTier` / `filters.city` / alive 过滤正在并行开发(WS1),客户端先把参数发出去(未知参数服务端忽略,不破坏现有功能)。

## 任务

1. **工作模式视口按需加载**(`src/components/map-shell.tsx` + marker 逻辑):
   - 工作模式下监听地图 `moveend` / `zoomend` → 防抖(~300ms)→ 请求 `/api/pois`(当前 `bounds` + `filters.maxTier`)→ **增量合并**进现有 catalog(不清空已有 marker)→ 更新 marker。
   - 性能:同刻只有一个 in-flight(请求合并/取消旧请求)、增量 merge 去重(按 poi.id)、marker 复用。
   - **Domain 模式不加视口加载**——保持现状(刷新才更新)。
2. **LOD 层级过滤**(`src/lib/lod.ts` 新常量 + 使用):
   - zoom → `maxTier` 映射(可配置,语义见 tech/18 §2.2):
     - 放大到街区:只名企(`maxTier=1`)
     - 中比例:中厂+大厂(`maxTier=2`)
     - 缩到全国:全部(`maxTier=3`)
   - 请求带 `filters.maxTier`;若服务端未 merge WS1,该字段被忽略,前端按现有数据工作。
3. **在招呈现**:
   - 招聘卡片/详情突出「在招中」信号;`deadline` 过期或非 open 的岗位不展示(客户端兜底过滤,服务端 alive 过滤在 WS1)。
   - 保持「只展示真实岗位」(`isAuthenticPositionId`)不回归。
4. **测试 + a11y**:视口防抖/合并逻辑单测(纯函数抽离)、LOD 映射单测;键盘/读屏标签不回归。

## 文件边界

**拥有**:`src/components/map-shell.tsx`、marker/卡片相关组件与 CSS、`src/lib/lod.ts`(新)、`src/lib/viewport-search.ts`、客户端 `src/lib/mode-cache.ts`、`src/lib/fetch-work-catalog.ts`(如存在)、对应 tests。
**不碰**:`db/`、`crawler/`、`server/data/`、服务端读路径(`recruitment-store.ts` / `spatial-query.ts` / `server-catalog.ts`)、`scripts/`。

## 依赖说明

- 服务端 `filters.maxTier` 由 WS1 提供;你先按 `filters` 对象传 `maxTier`/`city`,服务端 merge 后即生效。
- 不要改服务端 API 契约文件(那是 WS1 的地盘);只在客户端构造查询参数。

## 门槛

- `cd server && npm test && npm run typecheck` 全绿;`make docs-check` + `git diff --check`;Conventional Commits。
- 移动端抽屉(≤767px)行为不回归;LOD 与视口加载在移动端同样生效。

## 回报格式

完成后返回:改动文件、视口防抖/合并/LOD 实现要点、单测结果、移动端验证情况、遇到的问题。不要倾倒文件内容。
