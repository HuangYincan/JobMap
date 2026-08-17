# Session Prompt — WS2: 多城市真实数据管线

> 这是 Domain Map 并行开发的一个独立 Agent 会话。先读 `CLAUDE.md`、`agent.md`、`tech/18-national-scale-plan.md`、`tech/roles/data/etl/xiaozhao-radar.md`、`tech/04-workflow.md`,再开工。
>
> **第一步(必做):自己创建 worktree。** 主工作树在 `dev`,你是全新会话。开工前先:
> ```bash
> git switch dev && git pull --ff-only origin dev
> git worktree add -b feature/multi-city-data ../dm-wt-ws2 dev
> cd ../dm-wt-ws2
> ```
> 之后所有开发/提交都在该 worktree 内完成;**不要在主工作树(dev)上直接改文件**。worktree 是本会话的独立工作区,其他并行会话(WS1/WS3/WS4)各有各的,互不干扰。完成后由你负责移除。

## 背景

- 工作模式目前只覆盖杭州(79 pin,全部真实办公点,`AMAP_WEB_KEY` 已配)。现在扩展到**全国:北京、上海、广州、深圳、成都、武汉**(+ 杭州)。
- 你负责**数据侧**:把 `xiaozhao-radar` jobs.json 按目标城市展开成 per-city sites,产出首批城市 drops,并把 `geocode:sites:apply` 升级成多城市。
- 关键要求(用户定):**公司 ↔ 位置 ↔ 岗位三者的真实性必须匹配**;岗位必须真实;警惕「**多个岗位合到一条**」的聚合行。

## 任务

1. **多城市 mapper**(`crawler/app/domain_map_importer/radar_jobs.py`):
   - 支持 `--cities 北京,上海,广州,深圳,成都,武汉,杭州`(默认目标城市集),不再硬编码 `hangzhou_only`。
   - 公司按城市文本(`"北京/上海/杭州"`)拆出 per-city sites;site id 遵循 `${slug}-site-${cityKey}` 规范;`location.address` 保留城市文本供 geocode。
   - 岗位分配:标题含城市括号(`(杭州)`)→ 挂到对应城市 site;否则挂公司主 site(首个城市 site)。`externalId` 保持唯一。
   - **聚合行检测**:标题如「技术、设计、数据、运营、产品等七大类」「软件类 算法类 硬件类」等 → 加 `aggregate: true`,不静默展开。这是给 WS3 LLM 校验 + 人工策展用的标记。
2. **首批城市 drops**:至少跑通 mapper 并产出 **1 个非杭州城市**(如北京)的可导入 drops(真实公司、真实岗位),作为多城市管线验证。城市字段:`site.city`、`site.province`。
3. **多城市 geocode**(`scripts/geocode-sites-apply.mjs` + `src/lib/site-geocode.ts`):
   - site 带 `city`/`province` 时,place-text 搜索用该城市(不再硬编码杭州),`citylimit` 用对应城市。
   - 城市级校验:regeo 确认坐标落在目标城市。
4. **数据质量记录**:更新 `tech/roles/data/data-quality.md`(新增城市、聚合行计数、geocode 通过率)。不要把 AMAP_WEB_KEY 打印出来。

## 文件边界

**拥有**:`crawler/app/domain_map_importer/*`(radar_jobs.py 等)、`server/data/recruitment/radar/*`(drops)、`scripts/geocode-sites-apply.mjs`、`src/lib/site-geocode.ts`。
**不碰**:`db/migrations/`、`src/lib/types.ts`(drop 形状与 WS1 契约,见下)、`src/lib/recruitment-store.ts`、`src/lib/server-catalog.ts`、`map-shell.tsx`。

## 与 WS1 的契约

- drop 形状(WS1 正在落 `types.ts`):`SourceCompany.tier`(可选,缺省 3)、site `province`/`city`。你**产出含这些字段的 JSON**(Python 侧不受 TS 阻塞)。
- 不要 edit `types.ts`/`recruitment-import.ts`;导入映射由 WS1 消费你的形状。

## 门槛

- `cd crawler && PYTHONPATH=app python3 -m unittest discover -s tests -q` 全绿;`cd server && npm test && npm run typecheck` 不回归。
- `make docs-check` + `git diff --check`;Conventional Commits。
- geocode 多城市调用必须 throttle(≤3 QPS),不打印 key。

## 回报格式

完成后返回:mapper 改动、北京(或其他城市)drops 的公司数/岗位数、聚合行标记数、geocode 成功/失败统计、遇到的问题。不要倾倒文件内容。
