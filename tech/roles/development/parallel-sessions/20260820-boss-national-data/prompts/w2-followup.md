# Workstream w2 — FOLLOWUP(boss 复验裁决)

## 背景

你(同一 worktree `/Users/acccan/dm-wt-w2`,分支 `feat/ats-source-extend`)已完成 zhiye 适配器。boss 复验 crawler 测试时发现 **3 个失败**(你的汇报称 37 个全过,与实测不符——复验命令 `cd crawler && PYTHONPATH=app python3 -m unittest discover -s tests` 实际 103 跑 / 3 失败):

1. `PositionMappingTests.test_job_city`:`job_city({"location": "上海市浦东新区"})` 期望 `"上海市"`,实际返回 `"上海市浦东新区"` —— **区级城市文本未归一**。
2. `PositionMappingTests.test_ensure_city_sites_appends_only_new_cities`:site id 期望 `科大讯飞-site-hefei`,实际 `科大讯飞-site-合肥` —— **「合肥」拼音转换失败**。
3. `CrawlTests.test_crawl_company_paginates_until_total`:期望 `meta["api_jobs"] == 3`,实际 2 —— 疑为城市过滤/归一副作用,一并修。

## 任务

修这 3 个失败(全部归因于城市文本处理):

1. **`job_city` 归一**:检查你实现的城市归一逻辑,参考项目已有语义 —— `crawler/app/domain_map_importer/` 下 imports.py / radar_jobs.py / cli.py 中是否有现成城市归一(如「去 市/区/县 后缀」「直辖市区级 → 市名」)。项目级语义:site.city 用裸城市名(如「上海市」,参考既有 drops 如 radar/得物.json 的 site.city)。「上海市浦东新区」→「上海市」(区级文本归一到市名;注意「北京市朝阳区」→「北京市」同型)。
2. **site id 拼音**:检查 pinyin 转换(映射表/库),补「合肥」→ hefei(以及同型城市,如「长沙」→ changsha 等,若映射表式实现,把测试涉及的都核对)。
3. **分页计数**:修完 1/2 后跑全量 crawler 测试,确认 3 个失败清零、其余 100 个不回归。

## 门禁

1. `cd /Users/acccan/dm-wt-w2/crawler && PYTHONPATH=app python3 -m unittest discover -s tests` → **103 全过,0 失败**(worker 无 python?—— 上次你无法跑;本批环境不变的话,写清楚修复推理与预期,由 boss 复验;但请尝试,若 `python3` 被拒,在汇报注明)
2. `cd /Users/acccan/dm-wt-w2/server && npm test`(基线 500 pass/2 skip,确认不回归)
3. typecheck / docs-check / diff --check
4. 新 commit(Conventional Commits,如 `fix(crawler): normalize job city text + pinyin site ids (w2 followup)`)—— 追加到同一分支。

## 汇报

更新 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-national-data/reports/w2.md`(追加「followup」段:3 个失败根因 + 修复方式 + 结果)。末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

不 push、不 merge、不切分支。
