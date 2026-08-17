# Domain Map Platform — Claude Code 项目指令

> 本文件每次会话自动加载(精简版)。完整开发契约见 [`agent.md`](./agent.md);技术文档见 `tech/`;并行开发操作细节见 `.claude/skills/parallel-development/`。

## 项目速览

Next.js 15 + React 19(`server/`)、Python 爬虫(`crawler/`)、PostGIS(`db/`)。多模式地图:Domain(高德 AMap)+ 工作(真实招聘 catalog)。**一切皆插件,一切数据皆可换源。**

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
- 📡 外部数据采集必须有来源审查记录(`tech/roles/data/etl/`);BOSS 直聘 / 牛客 / 小红书 / 实习僧不得直接抓取;不得绕过登录、验证码、限流。
- 🔑 **不打印 / 不提交 `.env`、`.env.local`、`AMAP_WEB_KEY` 等密钥**;调用 AMap REST 必须先有 `AMAP_WEB_KEY`,且绝不打印该 key。
- 📄 文档必须反映可验证事实;代码变更同步 `tech/` 与 `agent.md` 文档维护契约;`make docs-check` + `git diff --check` 通过后再提交。
- ✅ 提交用 Conventional Commits(`feat` / `fix` / `docs` / `test` / `refactor` / `chore`);分支命名 `feature/` / `fix/`。

## 常用命令

```bash
make help                 # 支持的 make 命令
make docs-check           # 文档规范检查
cd server && npm test     # 185 测试(2026-08-17)
cd server && npm run typecheck
npm run import:seed:apply  # 同步 Postgres(需 DATABASE_URL,读 server/.env.local)
npm run geocode:sites:apply --dry-run  # 雷达公司落真实办公点(需 AMAP_WEB_KEY)
make db-up                # 启动本地 PostGIS
```
