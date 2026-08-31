# WS: ws-c — 文档事实同步(docs)

你是 headless 开发 worker。工作目录是**你的 worktree**:`/Users/acccan/dm-wt-r2-c`(已预建,分支 `feature/scan-r2-docs`,从 **ws-a 合并后**的 dev 切出)。**worktree 已预建,boss 统一合并;你绝不 merge / push / 建分支。** 若开工时 dev 又前移,可 `git merge dev` 后再动手。完成后写汇报到 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix-r2/reports/ws-c.md`(末两行 token)。

## 背景

r2 质量扫描:`tech/roles/development/quality-scans/20260823-all-r2/scan-report.md`。本 WS 修 **#3 #8 #9 #10**(技术类文档事实,boss 已批),并负责 ws-a(后端批次,已合并)之后的**测试计数同步**。只改文档,不写代码;每处修改前先读文件核对事实(扫描是 06:21 快照,以当前 worktree 为准),文档必须反映可验证事实(硬性规则)。

## 任务(全部在 worktree 内)

### #3(Med)tech/15-deploy.md + tech/01-architecture.md 过时
- `tech/15-deploy.md:52`:`make db-migrate` 迁移范围 `001–016` → `001–018`(017 avatar / 018 memories)。
- `tech/15-deploy.md:68`:「What is not deployed」的 SMS/email 行:「No real SMS / email. Inbox rows stay queued.」→ 改为「OTP 已真发(Resend email / 阿里云短信,2026-08-22,见 tech/25/26);岗位提醒仍仅入队(queue-only)」。核对上下文,表述与 README / data-quality.md 一致。
- `tech/01-architecture.md:70`:「migrations (001–016, live-applied)」→ `001–018`。

### #8(Low)deferred-ledger.md D-20 台账脱节
- `tech/roles/development/deferred-ledger.md:33` 附近:D-20 台账仍只列 4 处,与扫描实证脱节。**补全事实清单**(不修数据,只记台账):r1 已实证 13 文件 `证劵`(radar 11 + qqdoc-jobs 2,清单见 r1 scan-report #9)+ 3 处转录疑似(中国一众/城堡证劵/方联证劵);r2 新增实锤 2(上海市交通大学→上海交通大学、北京市大学→北京大学)+ 疑似 2(北京润料→润科通用、OCC欧晰折咨询→欧晰析);每条注明「见 scan-report 20260823-all #9 / 20260823-all-r2 #2」,状态=待用户拍板。
- 顺带把 D-18 状态行数字更新为 r2 实测(map-shell ~3055 行,2026-08-23),并注明「继续抽 hook,追踪中」。

### #9(Low).claude/skills/frontend-component-dev/skill.md 过时
- `:8`「Next.js 15」→ 核对 `server/package.json` 实际版本(16.x)更新。
- `:34`「Keep POST /api/auth/otp/send for Aliyun SMS later」→ OTP 已真发(Resend/阿里云,tech/25/26),更新表述。
- `:44` 附近 Next 版本标签(如「Next 15 rejects ssr:false」)→ 按当前版本语义修正。
- **勿误改** Job-alerts 段(:39 附近,「仅入队 queue-only」仍是正确的,扫描已确认)。
- 该文件是 `.claude/skills/frontend-component-dev/skill.md`(仓库已跟踪);只改这三个点,不顺手改其他 skill。

### #10(Low)tech/README.md 编号重复
- `tech/README.md:33-35`:`26-aliyun-sms` 与 `26-agent-memory` 同号 → 后者改 `30`(先确认无 tech/30 冲突;若已存在则改 31 或 26b,并在汇报说明)。同步全库对该文档的引用(至少 CHANGELOG.md 引用处;`grep -rn "26-agent-memory" .` 找全),若文件本身名为 `tech/26-agent-memory.md` 需 `git mv` 重命名 + 更新所有引用路径。

### 测试计数同步(ws-a 合并后)
- `cd server && npm test` 实跑,取权威数(ws-a 删除了 contrast 测试,计数可能低于 1487)。
- `grep -rn "1487\|1485" CLAUDE.md agent.md CONTRIBUTING.md README.md CHANGELOG.md tech/05-milestones.md server/README.md` 找出所有测试计数行,统一写为实跑值(格式照旧:「N 测试(N-2 pass / 2 skip,2026-08-23)」之类,跟随各处既有格式)。只有计数与实际不符才改。

## 文件边界

- 拥有:`tech/15-deploy.md`、`tech/01-architecture.md`、`tech/roles/development/deferred-ledger.md`、`.claude/skills/frontend-component-dev/skill.md`、`tech/README.md`、`tech/26-agent-memory.md`(如重命名)、`CLAUDE.md`/`agent.md`/`CONTRIBUTING.md`/`README.md`/`CHANGELOG.md`/`tech/05-milestones.md`/`server/README.md`(仅测试计数行)。
- 不碰:`server/src/**`、`server/data/**`、其他 tech 文档内容、其他 skill 文件、`server/package.json`。

## 门禁(必须全部通过)

```bash
cd server && npm test        # 全绿(只读验证,不新增测试)
cd .. && make docs-check     # 文档规范
git diff --check
```

## 汇报

写 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-scan-fix-r2/reports/ws-c.md`:
- 顶部:每个发现号一行(改了什么,file:line)+ 测试计数同步结果(实跑值 + 改了几处)。
- 「遇到的问题」段:与扫描报告不一致处、任何需要 boss 裁决的事项(如 tech/30 已存在、引用未找全)。
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
