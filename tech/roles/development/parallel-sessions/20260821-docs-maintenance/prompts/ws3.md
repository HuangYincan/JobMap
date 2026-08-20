# Workstream 3 — roles/ 归档导航 (fix/roles-archive)

## 背景

仓库文档维护批次。用户已拍板归档策略：**全保留 + 导航补齐**。roles/ 存在结构缺口：parallel-sessions/ 无索引、决策性待办散落各批次 deferred-notes（部分批次缺失该文件）、development/README 未覆盖实际内容目录、product/README 有破损链接、phase-1 文档状态过时、quality-scans 未回填修复状态。你是 headless worker：**worktree 已预建**（/Users/acccan/dm-wt-ws3，分支 fix/roles-archive），只改 worktree 内文件，**不要 merge/push/切分支**。提交用 Conventional Commits。

**注意**：5 个未跟踪批次已由 boss 先行入库，worktree 内可读到全部 24 个批次目录。`20260821-boss-qqdoc-official/` 为 **in-flight**（reports/ 空、无 merge-report）：**不编辑其任何文件**，索引中标注 in-flight。

## 任务

### 1. 新建 `tech/roles/development/parallel-sessions/README.md` — 批次索引
- 索引表：全部 24 个批次（按日期倒序）：批次名 | 主题（一句话） | 状态（DONE/in-flight） | 关键内容指针（如 deferred-notes 有重要项、merge-report 有裁决） | 入库状态
- 目录结构说明（README/prompts/reports/merge-report/boss-state/deferred-notes 各是什么）+ 指向 deferred-ledger.md
- qqdoc-official 行标注 in-flight
- 建表依据：读各批次 README.md（无 README 的 2 个批次——bugfix/optimize——见任务 6）

### 2. 新建 `tech/roles/development/deferred-ledger.md` — 遗留待办账本（本批核心产出）
合并所有批次 deferred-notes 的 open 项（去重 + 来源批次指针），格式：

```
# Deferred Ledger — 遗留待办账本
> 各并行批次 deferred-notes 的合并追踪（去重）；批次内新增待办时同步登记。
> 来源批次: tech/roles/development/parallel-sessions/<batch>/

| ID | 类型 | 内容 | 来源批次 | 状态 | 执行条件/决策者 |
```

已知 open 项（**逐一核对原文后登记，发现其他项一并补**）：
- **D-01 跨城串味数据修正**：DB 147 条「city=外地但坐标=杭州」company_sites 行（76 公司/914 岗位）——boss-cluster-tune、boss-optimize D-01；查询层已防御；状态 OPEN（数据修正待执行，需用户确认）
- **D-02 icon 存量导入**：import:seed:apply + bump MODE_CACHE_VERSION + audit:pins——cluster-tune/cluster-viewport/fix-polish/optimize 多批承接；状态 OPEN（Env-only）
- **D-03 全国 geocode 配额**：radar 站点占位名 + 无坐标；geocode:sites:apply 8 城重跑（national-data D-1）——2026-08-21 quota 批已部分完成（20 家坐标写入），状态 PARTIAL
- **E-01 notifications 429 观察**（bugfix）；**E-02 Next 16 生成文件**（bugfix，含 AGENTS.md/CLAUDE.md 说明）；**E-03 b1 契约盲区教训**（bugfix，已闭环，可标 DONE-记录）；**E-04 import 自愈边界**（bugfix）
- **D-3 zhiye 北森源 robots 不可用**（national-data）——源策略变化待关注，状态 OPEN（观察）
- **distance 圆心语义备查**（cluster-viewport/fix-polish）：圆心随视野已实现；「以我的位置为中心」可选语义备查
- **marker 失步生产复验**（cluster-tune/cluster-viewport/fix-polish）：dev Fast Refresh 下偶发；生产未复验
- **20260820-all 扫描非文档项**（引用 scan-report，不复制全文）：map-shell 巨型组件重构（#6）、robots 失败策略（#8，采集口径待用户拍板）、radar 同公司多 slug 合并（#3，数据口径）、slug/显示名拼写（#5，数据口径）、双重 https 前缀（#4，数据修正）、/api/pois 双解码（#7）、city↔坐标矛盾行（#14，与 D-01 同源）

### 3. `tech/roles/development/README.md`
- 补 parallel-sessions/ 与 quality-scans/ 章节（各一句话说明 + 指向索引/报告）

### 4. `tech/roles/product/README.md`
- 修 2 条破损链接：`roadmap.md`、`PRD/01-mvp-recruitment.md`（目录均为空）→ 改为「规划中（目录尚未建立）」

### 5. `tech/roles/development/implementation/phase-1.md` 与 `tech/roles/testing/test-plans/phase-1.md`
- phase-1.md：头部 Status: in-progress → **complete/closed**（分支 feature/phase-1-platform-baseline 已并入 dev），与 phase-2.md 口径一致；正文不改
- test-plans/phase-1.md：「in-progress」措辞更新为已合入现状

### 6. 补 2 个缺失 manifest：`20260820-boss-bugfix/README.md`、`20260820-boss-optimize/README.md`
- 参照其他批次 README 格式（目标/Workstreams 表/合并顺序/合并后），从该批 prompts/merge-report/deferred-notes 提炼

### 7. quality-scans 状态回填
- `20260820-all/scan-report.md` 尾部补「修复状态回填（2026-08-21）」表：对 15 条发现逐条标 已修/未修/复发（依据该报告自身「上轮复核」段 + 本批实际修复情况；未修的标「见 deferred-ledger」）
- `20260819-docs/` 与 `20260819-all/` 的 scan-report.md 各加一行：「状态追踪见 20260820-all 复核段」

## 文件边界
- 新建：`tech/roles/development/parallel-sessions/README.md`、`tech/roles/development/deferred-ledger.md`
- 修改：上述 3/4/5/6/7 列出的文件
- **不碰**：20260821-boss-qqdoc-official/**、根文档、tech/ 顶层、server/、crawler/

## 门禁（全部通过才算 OK）
1. `make docs-check`（worktree 根）→ 通过
2. `git diff --check` → 无空白错误
3. **链接扫描 0 破损**：扫描 tech/**/*.md 与根 *.md 的相对链接（`](path` 形式，排除 http(s):// 外链），全部可解析或标注「规划中」
4. **ledger 覆盖核对**：逐一核对 24 个批次的 deferred-notes，所有 open 项均已在 ledger 中（自查清单附在回报里）

## 回报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-docs-maintenance/reports/ws3.md`：
- 各任务产出（文件 + 一行）、ledger 登记项数、链接扫描结果
- 遇到的问题段（如有）
- 末两行精确 token：
```
门禁: PASSED
结论: OK
```
（失败则 `门禁: FAILED` + `结论: BLOCKED: <一句话>`）
