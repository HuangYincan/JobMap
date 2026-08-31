# Session Prompt — WS3: LLM 并发岗位真实性验证脚本

> 这是 Domain Map 并行开发的一个独立 Agent 会话。先读 `CLAUDE.md`、`agent.md`、`tech/18-national-scale-plan.md`、`tech/roles/data/data-quality.md`,再开工。
>
> **第一步(必做):自己创建 worktree。** 主工作树在 `dev`,你是全新会话。开工前先:
> ```bash
> git switch dev && git pull --ff-only origin dev
> git worktree add -b feature/llm-validation ../dm-wt-ws3 dev
> cd ../dm-wt-ws3
> ```
> 之后所有开发/提交都在该 worktree 内完成;**不要在主工作树(dev)上直接改文件**。worktree 是本会话的独立工作区,其他并行会话(WS1/WS2/WS4)各有各的,互不干扰。完成后由你负责移除。

## 背景

- 工作模式数据强调**真实性**:公司 ↔ 位置 ↔ 岗位必须匹配,岗位必须真实。脚本校验对「多个岗位合到一条」的聚合行(如「技术、设计、数据、运营、产品等七大类」)效果有限。
- 你负责开发一个**并发 LLM 验证脚本**:批量读 drops,用 LLM 判断真实性。用户会自己配置 API(`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`),**QPS 几千**,所以并发度可以很高。
- 地址/位置校验可以用类似思路(LLM 判断公司名 ↔ 城市/地址是否一致)。

## 任务

1. **脚本** `server/scripts/validate-positions-llm.mjs`(新)+ `src/lib/llm-validate.ts`(新):
   - 读 `server/data/recruitment/**/*.json`(radar + official-career drops)。
   - 对每条公司/岗位,调用 OpenAI 兼容 chat completions(`LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`,从 env 读,**绝不打印 key**),按确定性 schema 返回判定(JSON 输出约束)。
   - 校验维度:
     - **title 真实性**:是否真实岗位标题;是否聚合行(建议拆解成哪些具体岗位)。
     - **公司 ↔ 岗位** 一致性(标题/部门/技能与公司行业是否相符)。
     - **公司 ↔ 站点 ↔ 城市** 一致性(公司是否真在该城市有办公点)。
     - **applyUrl 域名 ↔ 公司** 匹配(投递链接是否该公司官网/ATS 域名)。
   - **并发**:Promise 池(可配 `--concurrency`,默认几百~上千),限流与重试,失败不中断。
   - 输出:`tech/roles/data/validation-report-<YYYYMMDD>.json`(每条 pass/warn/fail + 理由 + 聚合行拆解建议)+ 控制台汇总。
2. **CLI 参数**:`--limit N`、`--sample N`、`--only slug1,slug2`、`--concurrency N`。
3. **测试**:mock LLM 响应(`tests/llm-validate.test.mjs`)——解析、判定、聚合检测、域名匹配。
4. **文档**:`tech/18` 提到脚本;`tech/roles/data/data-quality.md` 记录脚本用途与 env 配置方式。

## 文件边界

**拥有**:`server/scripts/validate-positions-llm.mjs`(新)、`src/lib/llm-validate.ts`(新)、`tests/llm-validate.test.mjs`(新)。
**不碰**:`crawler/`、`db/`、`server/data/recruitment/`(只读,不改 drops)、`map-shell.tsx`、`src/lib/recruitment-store.ts`、`src/lib/server-catalog.ts`。

## 安全

- API key 只从 env 读(`LLM_API_KEY`),不硬编码、不打印、不写进报告。
- 只把**单条岗位文本**(title/公司/城市/applyUrl)发给 LLM,不批量泄露无关数据。
- 不执行 LLM 返回的可执行内容;只解析 JSON。

## 门槛

- `cd server && npm test && npm run typecheck` 全绿;`make docs-check` + `git diff --check`;Conventional Commits。
- 无 key 时脚本 dry-run(打印将发送多少条、示例输入),不 crash。

## 回报格式

完成后返回:脚本位置、验证维度清单、并发/限流设计、mock 测试结果、无 key 时 dry-run 输出样例、遇到的问题。不要倾倒文件内容。
