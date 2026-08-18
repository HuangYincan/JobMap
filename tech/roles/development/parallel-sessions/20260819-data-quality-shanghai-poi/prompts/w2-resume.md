# WS w2 续作(resume)—— 完成官网 ATS 适配器

> 批次:20260819-data-quality-shanghai-poi | worktree: `/Users/acccan/dm-wt-w2`(同一 worktree/分支 `feat/official-ats-adapters`)

## 发生了什么

你(w2 前一个 worker 会话)在 **$3 预算耗尽时被中断,0 commit**。未提交成果(`git status`/`git diff` 查看):
- `crawler/app/domain_map_importer/ats_feishu.py`(新,feishu 适配器)
- `crawler/tests/test_ats_feishu.py` + `crawler/tests/fixtures/`
- `tech/roles/data/etl/feishu-ats.md` / `hotjob-ats.md` / `zhiye-ats.md`(新 ETL 文档)
- `cli.py` / `official_refresh.py` 改动、`tech/roles/data/data-sources.md` 加注

## 续作步骤

1. **盘点不重做**:`git diff` 审阅已有改动(方向正确就继续,不要回退);先跑 `cd /Users/acccan/dm-wt-w2 && make test-unit` 看破损面,把不一致补齐。
2. **对照原任务清单**(prompt:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-data-quality-shanghai-poi/prompts/w2.md`,务必读):
   - feishu 适配器:完成度如何?分页/坏响应降级/domain 路由/CLI 接入/导入形状兼容——逐项确认。
   - **hotjob / zhiye 适配器**:若已有解析结论与代码则完成;若时间/复杂度不允许,**至少交付「平台可行性结论 + 解析路径」写入对应 ETL 文档**(原任务要求至少 2 个平台适配器,feishu + 另一个能拿 JD 的;若第二个平台确实拿不到真实 JD,在汇报里写明证据)。
   - 测试全绿;`make docs-check` 绿。
3. **提交**(Conventional Commits,可多个小 commit)。
4. **门禁全绿**:
   ```bash
   cd /Users/acccan/dm-wt-w2 && make test-unit && cd server && npm test && npm run typecheck
   cd /Users/acccan/dm-wt-w2 && make docs-check && git diff --check
   ```
   (注意:若你未改 server 侧代码,`cd server && npm test` 只需确认不红即可——按实际改动范围跑)
5. **写汇报** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-data-quality-shanghai-poi/reports/w2.md`:各平台可行性结论(真实 JD 可得性)、完成的适配器与解析路径(file:line)、未完成项与原因、测试;遇到的问题(若有)。末两行精确 token:
   ```
   门禁: PASSED | FAILED
   结论: OK | BLOCKED: <一句话问题>
   ```

## 文件边界(同原 prompt)

crawler/app/domain_map_importer/ + crawler/tests/ + tech/roles/data/etl/ + data-sources.md。不碰 server/src/、drops、mokahr。

不要 merge / push / 建分支;不碰主工作树;不要跑全量网络爬取。
