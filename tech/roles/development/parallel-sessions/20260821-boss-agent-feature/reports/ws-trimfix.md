# ws-trimfix 汇报(2026-08-21)

worktree: `/Users/acccan/dm-wt-agent-tfix`(分支 `feature/agent-trim-fix`,基线 dev `92f3e68`)
交付 2 commit:`2217c07`(sanitize + 按轮裁剪)、`ea54440`(错误分类)。

## 实际改动

- `server/src/lib/agent/run-agent.ts` → **工具结果消毒**(bug 1):工具循环里
  `const summary = sanitizeToolText(result.ok ? result.text : result.error);`——ok 文本与
  error 摘要**都**在入 history / tool 事件前净化(截断 3000、剔 script、剔超长 URL);
  此前 `sanitizeToolText` 只被 rest-fallback 工具侧使用,LLM 上下文入口从未调用。
- `server/src/lib/agent/run-agent.ts` → **`trimHistory` 重写**(bug 2):由「从最前逐条删
  非 system 消息」改为「以轮为单位从最前整轮删除」——每轮 = user + 其后的
  assistant(可能带 tool_calls)+ 该 assistant 之后连续的 tool 消息组;system 永不删;
  最近一轮(本轮刚追加的 assistant(tool_calls)+ 其 tool 结果组)永保;轮不完整时
  (外部截断/孤立 assistant/tool 在队首)保守删除该轮全部可识别部分;预算仍按
  maxHistoryChars(content.length 求和)。调用点改为无参 `trimHistory()`(起点内部自算)。
  效果:不会出现「assistant(tool_calls) 被删、其 tool 结果残留」的孤儿 tool 消息
  (→ DeepSeek 400 "role 'tool' must be a response to 'tool_calls'")。
- `server/src/lib/agent/llm-provider.ts` → **400/422 分类修正**(bug 3):`/tool/i` 宽匹配
  换成 `UNSUPPORTED_TOOLS_BODY = /unknown parameter.*tool|does not support.*tool|unsupported.*tool|tool.*not supported/i`;
  只有正文表明「tools 参数不被支持」才 `unsupported_tools`(触发无 tools 降级重跑),
  其余 400/422(含 tool 消息配对错误)归 `HttpError`——不再误判掩盖真因。
- `server/tests/agent-runner.test.mjs` → 追加 2 测试 + `assertHistoryWellFormed` 辅助:
  (a) 工具结果 5000 字符(ok 与 error 各一)入 history 的 tool 消息被截断到 3000、
  事件 summary 同步截断;(b) `maxHistoryChars:500` 三轮工具 + 收尾,断言**每一轮**
  LLM 收到的 history 形状合法(每个 role:'tool' 前存在匹配 tool_call_id 的
  assistant(tool_calls)、每个 assistant(tool_calls) 的 tool_calls 均有对应 tool 消息、
  system 永在),且最早轮 tool 结果确实被整轮裁掉(裁剪真实生效)。
- `server/tests/agent-llm-provider.test.mjs` → 追加 2 测试:400/422 正文为
  「tool 消息配对错误」→ kind http 而非 unsupported_tools;4 种「tools 参数不支持」
  正文(unknown parameter / does not support / unsupported / not supported)→
  unsupported_tools。

未改:现有测试**零修改**——原有「历史裁剪删最旧 user、保留 system 与最近一轮」测试
在新语义下依旧通过(整轮删除首轮 user 后保留 [system, assistant, tool],配对完整)。

## 门禁结果

- `npm test`(server):**953 测试,951 通过 / 2 skip / 0 失败**(含新增 4 测试全绿)
- `npm run typecheck`:通过(tsc --noEmit 无输出)
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过(无空白错误)

## 遇到的问题

1. **tech/24 §6.4 描述已过时**:文档写「从最旧 user 起裁剪,保留 system + 最近一轮」,
   实现已改为按整轮删除。按任务边界「只动上述文件」未改文档 → 建议 boss 后续
   单独安排 doc 同步(§6.4 补一句「整轮删除,保 tool_calls↔tool 配对」)。
2. **裁剪后可能出现 [system, assistant(tool_calls), tool] 开头(无 user)**:单 user 多轮
   场景下预算耗尽时保留最近一轮会形成此形状——tool_calls↔tool 配对完整(不再是原 400
   根因),但某些 provider 可能不接受「system 后首条为 assistant」。本轮按任务定义
   实现(现有测试亦锚定此形状);若 boss 冒烟再遇「首个消息须为 user」类 400,需再
   拆一轮 ws 处理(如裁剪时连带保留最近 user 或把 user 摘要化)。
3. `node --test` 直接跑单文件被沙箱拦截,门禁以 `npm test --prefix <worktree>/server`
   全量跑通(953 条),覆盖同一套命令。

## 证据

- 新增测试运行结果(grep 于全量输出):
  `✔ runAgent: 工具结果 >3000 字符 → 入 history 前 sanitizeToolText 截断(ok 与 error 摘要均处理)`
  `✔ runAgent: 历史裁剪按轮删除 — 小预算多轮后无孤儿 tool 消息、system 永在、history 形状合法`
  `✔ streamChat: 400/422 正文为 tool 消息配对错误 → kind http,而非 unsupported_tools`
  `✔ streamChat: 400/422 正文表明 tools 参数不被支持 → kind unsupported_tools(触发无 tools 降级)`
- 全量输出尾部:`ℹ tests 953 / ℹ pass 951 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 2`
- commit:`2217c07`(run-agent 净化+按轮裁剪,+agent-runner 测试)、`ea54440`(错误分类,+provider 测试)

门禁: PASSED
结论: OK
