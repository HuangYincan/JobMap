# q-docs 汇报(2026-08-27)

worktree `/Users/acccan/dm-wt-q-docs`,branch `fix/quality-docs-current`,base `d899b3f`。扫描项 #23 #24 #26。
本批为续作重派:上一轮 worker 中断前遗留 8 个文档文件的未提交修改;已逐项复验(不重做)、补齐扫描 #23 明确要求但遗漏的 data-model/deploy 两文件,小步 3 提交。

## 实际改动

### Task 1 当前状态复验与同步(扫描 #23)

| 文件 | 旧值 | 新值 | 证据位置 |
|---|---|---|---|
| `CLAUDE.md` | `npm test # 1610 测试(1608/2,2026-08-24)` | `1689 测试(1686 pass/3 skip,2026-08-27,commit d899b3f 快照)` | 实测 `npm test` 于 d899b3f:`tests 1689 / pass 1686 / fail 0 / skipped 3` |
| `CONTRIBUTING.md` | 同上 1610/1608/2 | `1689/1686/0/3,commit d899b3f 快照` | 同上 |
| `server/README.md` | 1610/1608/2;读路径「Postgres first,offline drops fallback」 | `1689/1686/3`;public Work reads 改 strict DB-only(无库/失败/空 → 空列表,无离线 seed 回退) | `server/src/lib/server-catalog.ts`「严格 DB-only(2026-08-26)」+ `loadWorkCatalogFromDb ?? []`;`tech/backup/seed-data/` 存在 |
| `README.md` | 1610 测试;离线 fallback;migration 001–019 描述旧(计划数字 669/1440/877、1040/2351/12932 等);「runtime multi-engine deferred」 | 1689 快照;strict DB-only;migration 001–019;数据台账 1052/2411/12890/0;radar 646→659;radar 目标 11 城;三引擎已实现 | 见下「证据」各来源 |
| `tech/05-milestones.md` | Current Baseline 写「Postgres first,offline drops fallback」「001–016」「1610」「669/1440/877」;pytest | strict DB-only(server-catalog.ts 行为);001–019(apply.sh 枚举);1689/1686/0/3(注明瞬态基线 commit);111 unittest(无 Black);数据台账 1052/2411/12890/0;radar 646→659;Phase 2–4 段标记 historical 并指向 Current Baseline/tech-13/tech-14 | 同上 + `make test-unit` = `python3 -m unittest discover`;`crawler/tests/*.py` 均 `import unittest`,111 个 `def test_` |
| `tech/01-architecture.md` | 001–016;离线 fallback;auth stub;multi-engine deferred | 001–019(017/018/019 语义);strict DB-only;password/OTP/OAuth authorization-code(gated demo);三引擎已实现、再加适配器 deferred | `db/scripts/apply.sh` + `schema_migrations`;`server/src/lib/map-engine/{amap,tencent,baidu}/`;CHANGELOG 2026-08-22 OAuth |
| `tech/02-data-model.md`(本轮补齐) | Status/枚举/实测均 `001–016`;Last reviewed 2026-08-21 | `001–019`(Status + 枚举补 017/018/019 + 实测);Last reviewed 2026-08-27 | `ls db/migrations/` → `019_user_memory_unique.sql`;`db/scripts/apply.sh` 循环 `[0-9][0-9][0-9]_*.sql` 记 checksum |
| `tech/15-deploy.md`(本轮补齐) | 「Without a database they stay on the seed」 | strict DB-only:无库/失败 → 空列表,无离线 seed 回退(`tech/backup/seed-data`) | `server/src/lib/server-catalog.ts`;`tech/backup/seed-data/` |

### Task 2 env 示例(扫描 #24)

`server/docs/environment-variables.md`:
- `NEXT_PUBLIC_API_BASE_URL` 示例 `http://localhost:3000/api` → `http://localhost:3000`,并新增说明:客户端 `request()` 自己拼 `/api/...`,只填 origin(或不以 `/api` 结尾的前缀)。
- 全仓搜索 `API_*` 开关消费者 → 0 命中 `API_RATE_LIMIT` / `API_MAX_PAGE_SIZE` / `NEXT_PUBLIC_FEATURE_*`;这三个示例删除,改标「Feature Flags (reserved; not implemented)」,不得宣称可用。
- 顺带补 `ALIYUN_SMS_TEMPLATE_MINUTES` 示例(真实消费者 `aliyun-sms-client.ts:40`,缺省 `'5'`,与短信模板 `{code,min}` 对齐)。

### Task 3 质量门禁契约(扫描 #26)

`agent.md`:
- 选最小真实方案:把契约改成仓库当前确实可执行的命令,不安装/不臆造工具链。
- TypeScript/React:可执行门禁 = `npm run typecheck`(tsc --noEmit)+ `npm test`(node --test);保持现有 CSS Modules 与 2 空格风格。
- 明确声明:当前无 ESLint 配置或 `lint` script、无 Prettier 配置/依赖,不得声称或运行不存在的 ESLint/Prettier 门禁。
- Python:`crawler/pyproject.toml` 无 Black 依赖/配置;门禁 = `make test-unit`(`python3 -m unittest discover -s tests`),不臆造 Black 门禁。
- 运行时依赖清单同步(package.json 实测:Next/React/ReactDOM/pg、MCP SDK、DOMPurify、marked)。

## 门禁结果

- npm test(server,base d899b3f 实测):**1689 通过 / 0 失败 / 3 skip**
- typecheck:`npm --prefix server run typecheck` 通过
- make docs-check:通过
- git diff --check:通过
- crawler `make test-unit`:**本会话未能复跑**(沙箱拒绝 `python3` 执行);计数与运行器已从源码验证(111 个 `def test_`,`unittest` + Makefile target)。属瞬时基线复核,不影响文档改动正确性。

## 遇到的问题

1. **沙箱禁止 `python3`/`make test-unit`**:本会话无法实际复跑 crawler 单测。→ 以源码证据替代:6 个测试文件全部 `import unittest`,`make test-unit` 目标实为 `python3 -m unittest discover -s tests -v`,`def test_` 计数 111。若 boss 需实测,可在 dev 主树人工 `make test-unit`。
2. **`.claude/skills/frontend-component-dev/skill.md:41` 残留过期引用**:仍写「no-DB fallback is the offline catalog (`loadOfflineWorkCatalog`)」,但该函数已删除(全仓 0 命中,`company-logo.ts:75` 注释已称「2026-08-26 前枚举」)。→ 本文件写入权限未授予,未改动;建议后续批次处理(属前端技能文档,非扫描 #23 指定清单)。已在本次提交中排除。
3. **历史文档不重写**:`CHANGELOG.md`、`tech/13-db-query-notes.md`、`tech/20-development-plan.md` 中的 `001–016`/旧测试数均为带日期历史基线,保留原样(符合「不要大范围重写历史文档」)。
4. **测试基线瞬态**:其他 workstream(q-db/q-read/q-front 等)随后会改测试数,故所有文档均写成「d899b3f 快照」并注明瞬态,避免永久固化。

## 证据

- 服务器测试输出摘要(`npm --prefix server test` 于 d899b3f):`ℹ tests 1689 / ℹ pass 1686 / ℹ fail 0 / ℹ skipped 3 / duration_ms ~6901`。
- 迁移集:`db/migrations/` 共 19 个 `00X_*.sql`(019_user_memory_unique.sql);`db/scripts/apply.sh` 枚举 `[0-9][0-9][0-9]_*.sql` 并写 `schema_migrations(version, filename, checksum)`。
- 数据台账:`tech/roles/data/data-quality.md:196`「Import plan 现行口径(2026-08-27):companies 1052 / sites 2411 / positions 12890(plan 口径,含未到期),dropped 0」;`:191`「radar drops 646→659 公司,+64 站、+18 岗位行」。
- 严格 DB-only:`server/src/lib/server-catalog.ts`(注释「无 DATABASE_URL / DB 故障 → 返回 []」,`loadWorkCatalogFromDb ?? []`);seed 归档目录 `tech/backup/seed-data/`(domain-seed.json/work-seed.json/README.md)。
- env 消费者:`grep -rn NEXT_PUBLIC_API_BASE_URL server/src` → 唯一 `server/src/lib/api.ts:20`;`request()` 用 `${API_BASE}${path}`,path 均以 `/api/` 开头(`/api/suggest`、`/api/pois/[id]` 等)。
- 质量契约:`server/package.json`(无 lint script、无 eslint/prettier 依赖;test=`node --test tests/*.test.mjs`,typecheck=`tsc --noEmit`);`crawler/pyproject.toml`(无 black);`Makefile`(`test-unit` 用 `unittest discover`)。
- 提交:`103dbcd docs(status)` → `9d973d6 docs(env)` → `ec16405 docs(agent)`;工作树干净,未 merge、未 push。

门禁: PASSED
结论: OK
