# WS w3 续作(resume)—— 完成上海试点

> 批次:20260819-data-quality-shanghai-poi | worktree: `/Users/acccan/dm-wt-w3`(同一 worktree/分支 `feat/shanghai-pilot-data`)

## 发生了什么

你(w3 前一个 worker 会话)在 **$3 预算耗尽时被中断**。已完成:
- **commit `2773e00`**(已提交):`site-geocode.ts` 去杭州硬编码(geocodeQueryForSite / listImportedSitesNeedingGeocode 改用站点城市)+ 测试。
- **未提交**:试点公司雷达文件的错误坐标清除进行中(`git status` 显示 商汤科技-无限原力 / 得物 / 禾赛科技 等文件已改)——继续完成试点清单内所有公司的 -shanghai 等非杭州站点坐标清除。

## 续作步骤

1. **盘点不重做**:`git status` + `git diff` 看清除进行到哪;`git show 2773e00 --stat` 确认 geocode 小修已提交且测试绿。
2. **对照原任务清单**(prompt:`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-data-quality-shanghai-poi/prompts/w3.md`,务必读):
   - (1) geocode 城市化小修 ✅(已提交)——验证测试通过即可。
   - (2) 试点公司清单 + `tech/roles/data/shanghai-pilot.md`(10-15 家 + careerUrl 复核 + 站点现状)。
   - (3) 试点公司 -shanghai 等非杭州站点错误坐标清除(完成未提交部分;只动试点公司)。
   - (4) geocode-overrides.json 试点条目(宁缺毋滥,注明依据)。
   - (5) 文档。
   - 缺什么补什么。
3. **提交**:已改文件按主题提交(Conventional Commits);未提交的坐标清除单独 commit。
4. **门禁全绿**:
   ```bash
   cd /Users/acccan/dm-wt-w3/server && npm test && npm run typecheck
   cd /Users/acccan/dm-wt-w3 && make docs-check && git diff --check
   ```
5. **写汇报** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-data-quality-shanghai-poi/reports/w3.md`:试点清单及理由、坐标清除范围、overrides 依据、geocode 小修、测试;遇到的问题(若有)。末两行精确 token:
   ```
   门禁: PASSED | FAILED
   结论: OK | BLOCKED: <一句话问题>
   ```

## 文件边界(同原 prompt)

试点公司 radar 文件 + geocode-overrides.json(仅新增试点条目)+ site-geocode.ts(已提交,勿再动)+ shanghai-pilot.md + 相关测试。不碰非试点公司、crawler/、map-shell。

不要 merge / push / 建分支;不碰主工作树;不要跑 geocode / 爬虫 / 导入。
