# Domain Map Platform — Claude Code 项目指令

> 本文件每次会话自动加载(精简版)。完整开发契约见 [`agent.md`](./agent.md)。本仓库不跟踪私有内部文档；当前事实以 tracked 源码、`db/migrations/`、`Makefile`、`.github/workflows/` 与对应 README 为准。

## 项目速览

Next.js 16 + React 19(`server/`)、Python 爬虫(`crawler/`)、PostGIS(`db/`)。多模式地图:Domain(高德 AMap)+ 工作(真实招聘 catalog)。**一切皆插件,一切数据皆可换源。**

> **当前状态:**全国规模工作模式已并入 `dev`;不要依赖已删除或未跟踪的内部计划、扫描报告或旧批次目录。

## 并行开发铁律:worktree 先行

**可能同时有多个 Agent 会话并行改前端 / 后端 / 数据库。规则:**

1. **永远先建 git worktree,再开发** —— 每个并行任务一个 worktree,从 `dev` 切出 `feature/<scope>` / `fix/<scope>`:
   ```bash
   git switch dev && git pull --ff-only origin dev
   git worktree add -b feature/<scope> ../domain-map-wt-<scope> dev
   ```
   主工作树保持稳定,并行分支互相隔离,冲突在每个 worktree 内显式解决。
2. **子 Agent 各占独立 worktree + 分支**;子 Agent 回报结论与证据,不倾倒文件,保持主 Agent 上下文干净。
3. **功能验证通过后 merge 回 `dev`**;`main` 只由用户发版。提交用 Conventional Commits。
4. **冲突处理**:功能分支定期 `git merge dev` 保持分叉小;冲突在各自 worktree 内解决。

> ✅ **分支状态(2026-08-17):** `dev` 已同步 `feature/phase-2-multi-mode`(Phase 1/2 全部工作已并入 `dev`)。新任务直接从 `dev` 切 worktree。

## 硬性规则(无例外)

- 🎨 **前端代码编写前必须先做 ASCII/文字布局图并获用户批准**;只有用户明确批准后才能写前端代码。
- 🧩 使用组件库前必须审查其源码,像自己写的那样理解;不无脑用。
- 🔬 **子 Agent 结果必须二次验证**:亲自跑测试 / 逐行读代码 / 截图看视觉效果,「信任但验证」。
- 📡 外部数据采集必须有来源审查记录（记录应与 `server/data/`、`crawler/` 中的实际来源和适配器保持一致）；BOSS 直聘 / 牛客 / 小红书 / 实习僧不得直接抓取;不得绕过登录、验证码、限流。
- 🔑 **不打印 / 不提交 `.env`、`.env.local`、`AMAP_WEB_KEY`、`BAIDU_MAP_AK`、`TENCENT_MAP_KEY` 等密钥**;调用 AMap/Baidu/Tencent REST 必须先有对应 key(`AMAP_WEB_KEY` / `BAIDU_MAP_AK` / `TENCENT_MAP_KEY`),且绝不打印;AMap 日配额耗尽(10044)时 geocode 工具链自动切百度→腾讯兜底。
- 📄 文档必须反映可验证事实；当前受维护的依据是 tracked 源码、`db/migrations/`、`Makefile`、CI workflow 与 README；`make docs-check` + `git diff --check` 通过后再提交。
- 🖼️ **Playwright 截图与产物统一存 `.playwright-mcp/`**(已 gitignore):`browser_take_screenshot` 用**相对文件名**(自动落在输出目录内),绝不写到仓库根目录;只有用户显式要求时才指定其他路径。
- ✅ 提交用 Conventional Commits(`feat` / `fix` / `docs` / `test` / `refactor` / `chore`);分支命名 `feature/` / `fix/`。

## 常用命令

```bash
make help                 # 支持的 Make target
make docs-check           # 文档规范检查
make test-unit            # crawler 单元测试
make test-integration     # PostGIS 集成测试(需 DATABASE_URL/服务)
cd server && npm run typecheck
cd server && npm test     # node:test，数量随当前源码变化
cd server && npm run build
make db-migrate           # 应用待执行 migrations(Env-only，需 DATABASE_URL)
make db-up                # 启动本地 PostGIS
```

CI 当前定义于 `.github/workflows/test.yml`:docs policy、`make test-unit`、server typecheck/test/build、以及 PostGIS 集成测试。仓库有 Node 安全契约测试(`server/tests/security-headers.test.mjs`、`account-security.test.mjs`、`agent-route-contract.test.mjs`、`rate-limit-xff.test.mjs`、`agent-mcp.test.mjs`)，但尚未配置 SAST、DAST 或依赖扫描 job/tool；不要把这些契约测试或未配置扫描报告为扫描门禁。

MCP agent 使用官方 `@modelcontextprotocol/sdk`：`server/package.json` 声明 `^1.30.0`，当前 lockfile 解析为 `1.30.0`；实现使用 SDK `Client`、`StreamableHTTPClientTransport` 与 `SSEClientTransport`，见 `server/src/lib/agent/mcp-providers.ts`。

数据库迁移由 `db/scripts/apply.sh` 按文件名顺序 `001`–`023` 执行，以 `schema_migrations` ledger 与 SHA-256 checksum 保证幂等和漂移检测；`022_hz_pois_photos_shape.sql` 会先检查 `hz_pois.photos` 的历史脏数据，再安装 JSON 数组约束；`023_recruitment_source_record_fk.sql` 为招聘站点/岗位增加指向 `source_records` 的可空复合外键，不回填历史行。apply 是 Env-only 操作，Agent 不得擅自执行。

## 并行任务协作

并行任务仍必须各自使用独立 worktree 和 `feature/` / `fix/` 分支；开发者只在自己的 worktree 修改，验证后由负责人按顺序合并回 `dev`。不要依赖未跟踪的旧批次目录、prompt、report 或 merger 状态文件。
