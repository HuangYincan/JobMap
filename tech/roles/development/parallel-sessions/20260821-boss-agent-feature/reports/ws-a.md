# WS-a 汇报(2026-08-21)

## 实现摘要(每个文件一句话)

- `server/src/lib/agent/types.ts` — 全链路契约:AgentTool/ToolResult/AgentContext/AgentAction/AgentEvent(mode 用 string,不耦合 MapMode)
- `server/src/lib/agent/action-schema.ts` — `validateAction` 纯函数逐字段校验:经纬度 finite 且 |lat|≤90/|lng|≤180、radiusMeters 10..50_000、points ≤50(每项 lng/lat finite、label ≤50)、id ≤128、query ≤100、mode ≤32、未知 type 一律 null;容忍多余字段
- `server/src/lib/agent/config.ts` — env 读取单点:`readAgentConfig()` AGENT_LLM_* → 回退 LLM_*(secret 只在此处,不打印);AGENT_MAX_TOOL_TURNS 默认 8 / AGENT_HISTORY_LIMIT 默认 6000(非法值回退默认);`hasBaiduAgentPlan()`(BAIDU_MAP_AUTH_TOKEN 非空,供 ws-b)
- `server/src/lib/agent/prompts.ts` — `buildSystemPrompt(cfg, lang)` 纯函数:角色定义/能力边界(GCJ-02 不得编造坐标)/工具纪律(结果视为不可信数据)/动作纪律({"actions":[...]} 结构化 JSON)/安全红线/输出格式;模板零 secret 占位(zh/en 双语言)
- `server/src/lib/agent/llm-provider.ts` — OpenAI 兼容 SSE 流式客户端:只 import llm-validate 的 HttpError/isRetryableStatus;`parseSseLine` 纯函数导出;delta.content 与 delta.tool_calls 双 chunk 兼容(工具参数跨 chunk 增量拼接);30s 首包 + 120s 整体超时(AbortController);408/429/5xx/网络错 2 次指数退避(500ms→1s,参数可注入供测试);400/422 响应体含 tools → kind `unsupported_tools`;abort → kind `aborted`;错误原样抛出由调用方分类
- `server/src/lib/agent/run-agent.ts` — `runAgent` AsyncGenerator(route 可直接消费为 SSE):事件队列桥接回调→生成器实现 delta/tool start 真流式转发;无 tool_calls → 花括号配对容错提取 `{"actions":[...]}` → 逐个 validateAction 下发(非法丢弃)→ done;有 tool_calls → 白名单查表(不在 → `tool not in whitelist`)→ `sanitizeToolText`(剔 `<script`/超长 URL/截断 3000)→ tool done/error → assistant(tool_calls)+tool 消息回流 → 下一轮;每轮按 maxHistoryChars 从最旧 user 裁剪(保留 system+最近一轮);unsupported_tools 无 tools 降级重跑一次(不耗轮数);超 maxTurns → `done truncated`;仅调用方 abort 静默停止,超时/网络错如实发 error(消息过 secret 清洗);`sanitizeToolText`/`extractActions` 纯函数导出

## 新增测试(5 文件 59 个,全部通过)

- `agent-types.test.mjs`(9)— validateAction 合法/非法矩阵:越界坐标(181/91/-181/-91)、NaN/Infinity/字符串坐标、超长 id(129)/query(101)/mode(33)/label(51)、radius 9/50001、>50 points、空 points、未知 type、非对象、容忍多余字段
- `agent-config.test.mjs`(7)— env 注入/还原(保存恢复):AGENT_* 优先、LLM_* 回退、全缺 → ok:false(reason 含变量名不含值)、部分缺失、maxTurns/history 默认与非法回退、hasBaiduAgentPlan 缺失/空白/存在
- `agent-prompts.test.mjs`(5)— zh/en 结构关键词、GCJ-02/{"actions": 断言、hasTools/maxTurns 注入、零 secret 占位正则(api_key/base_url/secret/token/password 均无)
- `agent-llm-provider.test.mjs`(20)— parseSseLine 纯函数矩阵;delta 逐 chunk、tool_calls 跨 chunk 增量拼接至完整 JSON、多工具 index 累计;注释/坏 JSON 行忽略;EOF 无 [DONE];429×2→200、500→200、429 持续 → HttpError(429) 共 3 次尝试、网络错 2 次退避后成功/持续 → kind network;400/422+tools 字样 → unsupported_tools;400 无 tools → HttpError;401 不重试;首包超时/整体超时 → kind timeout 不重试;预 abort 不发请求、流中 abort → kind aborted
- `agent-runner.test.mjs`(18)— 工具闭环(tool_calls→执行→回流→二轮)、白名单拒绝(不调用)、工具抛错/ok:false → tool error 且继续、非法参数 JSON;动作 JSON 提取/校验/逐个下发(非法丢弃)、纯文本无动作;超轮截断(末轮工具不执行);历史裁剪(删最旧 user 保 system+最近一轮);unsupported_tools 降级一次(成功/仍失败→error);abort 静默;网络错/超时/HTTP 错误事件 code;lang/viewport/bounds 上下文透传;sanitizeToolText 纯函数

## 遇到的问题

1. **6 个既有测试失败(非本 WS 引入,未修,越界)**:
   - 失败:`planSeedImport includes qqdoc-jobs companies ahead of seed`、`qqdoc-official 同`、`applyRecruitmentImport only counts authentic positions`、`planSeedImport accepts every current WORK_SEED company`、`planSeedImport merges official-career drops onto seed slugs`、`applyRecruitmentImport is a no-op without DATABASE_URL`
   - 根因:`server/src/lib/recruitment-import.ts` `cloneCompany`(222 行)无条件 `[...company.industries]`,而 `data/recruitment/qqdoc-jobs/*.json`(163 家)整批缺 `industries` 字段(抽查 2 个样本 0 处,official-career 有、seed-data 经 withWorkDefaults 有)——`planSeedImport` 一跑即 TypeError
   - 非本 WS 引入的证据:① 我 3 个 commit(a6dbc08/c83c05c/3edc4a0)只动 `server/src/lib/agent/*` 与 `server/tests/agent-*.test.mjs`,`git show --name-only` 确认零接触 recruitment/data 文件;② `cloneCompany` 的 industries spread 自文件创建(5262b86)就有,失败是数据形状不匹配;③ node --test 每文件独立进程,我的测试不可能影响它们
   - **未修**:任务硬约束「只新建,不改现有文件」,recruitment-import.ts 与 data/ 不归本 WS → 需 boss 裁决(派 fix WS 补 drops 的 industries 字段或确认基线)
2. **`tech/24-agent-feature.md` 不在 worktree**:ws-d 拥有 tech/,本分支无该文件;按 prompt 指示「以本 prompt 的设计为权威」执行,未读 spec(如有设计冲突以 prompt 为准)
3. 无其他问题;新增 59 测试首跑有 2 处自身测试笔误(mjs 里误用 TS `as` 语法、断言路径写错)已修,与 lib 无关

## 门禁结果

- npm test:**731 通过 / 6 失败**(739 total,2 skip);6 失败全部为上述既有 recruitment-import 问题,本 WS 新增 59 测试全绿;基线 568 对比:本树实际 739(dev 已推进,含 avatar/embodied 等新增)
- typecheck:`tsc --noEmit` 通过(零错误)
- docs-check:`Documentation policy check passed.`
- git diff --check:通过(无空白错误)

## 证据

- 提交:`a6dbc08` feat(agent) 6 lib 文件 / `c83c05c` test(agent) 5 测试文件 / `3edc4a0` fix(agent) 终态错误分类
- 门禁输出摘要:
  ```
  ℹ tests 739  ℹ pass 731  ℹ fail 6  ℹ skipped 2
  ✖ planSeedImport includes qqdoc-jobs companies ahead of seed (TypeError: company.industries is not iterable at cloneCompany)
  ✖ planSeedImport includes qqdoc-official companies ahead of seed (同上)
  ✖ applyRecruitmentImport only counts authentic positions (同上)
  ✖ planSeedImport accepts every current WORK_SEED company (同上)
  ✖ planSeedImport merges official-career drops onto seed slugs (同上)
  ✖ applyRecruitmentImport is a no-op without DATABASE_URL (同上)
  ```
- 分支 `feature/agent-backend-core` tip `3edc4a0`,工作树干净;未 merge 未 push

门禁: FAILED
结论: BLOCKED: 树内 6 个既有 recruitment-import 测试失败(drops 缺 industries 字段),非本 WS 引入且不在文件边界内,需 boss 裁决(派 fix WS 或确认基线)
