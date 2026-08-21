# WS-trimfix — 工具结果 sanitize + 历史裁剪结构修复 + 错误分类修正(boss 派发,mini worker)

## 背景

boss 冒烟 + 临时插桩定位到 3 个真实缺陷(全部在 agent 引擎,tech/24 §4.6 安全边界相关):

1. **工具结果未消毒**:`run-agent.ts` 工具循环里 `const summary = result.ok ? result.text : result.error;` 直接进 tool 消息,**`sanitizeToolText` 定义了但从未被调用**——实测一条 MCP 工具消息 15892 字符(应截断 3000),瞬间打爆历史预算。
2. **历史裁剪破坏结构**:`trimHistory` 从前往后逐条删非 system 消息,可删掉 user/assistant(tool_calls) 而留下孤儿 tool 消息 → DeepSeek 400 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。裁剪必须**整轮删除**(user + assistant(+ 其 tool 结果组)),保持 tool_calls↔tool 配对。
3. **错误分类误判**:`llm-provider.ts` 的 `/tool/i.test(bodyText)` 把「tool 消息配对错误」类 400(正文含 "tool")误判为 `unsupported_tools` → 触发无 tools 降级重跑,掩盖真因。应只在正文表明「tools 参数不被支持」时分类为 unsupported_tools(如 `unknown parameter.*tool` / `does not support.*tool` / `unsupported.*tool` / `tool.*not supported`),其余 400/422 归 http。

worktree: `/Users/acccan/dm-wt-agent-tfix`(分支 `feature/agent-trim-fix`,已从 dev `92f3e68` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-trimfix.md`

## 任务(2 文件 + 测试)

1. `/Users/acccan/dm-wt-agent-tfix/server/src/lib/agent/run-agent.ts`:
   - 工具结果入 history 前经 `sanitizeToolText(summary)`(错误摘要同样处理);
   - 重写 `trimHistory`:按「轮」为单位从最前删除——每轮 = 一个 user 消息 + 其后的 assistant(可能带 tool_calls)+ 该 assistant 之后连续的 tool 消息组;system 永不删;整轮不完整时(历史被外部截断)保守处理:删除该轮全部可识别部分。预算计算沿用 maxHistoryChars(content.length 求和)。
2. `/Users/acccan/dm-wt-agent-tfix/server/src/lib/agent/llm-provider.ts`:修正 400/422 分类正则(见背景 3)。
3. 测试:
   - `agent-runner.test.mjs` 追加:工具结果 >3000 字符 → tool 消息内容被截断;小 maxHistoryChars(如 500)多轮后断言「无孤儿 tool 消息」(每个 role:'tool' 消息之前存在带匹配 tool_call_id 的 assistant(tool_calls);每个 assistant(tool_calls) 的 tool_calls 均有对应 tool 消息);system 消息永在;LLM 收到 history 形状合法。
   - `agent-llm-provider.test.mjs` 追加:400 体为「tool 配对错误」→ kind 'http' 而非 unsupported_tools;400 体为「tools 参数不支持」→ unsupported_tools。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-tfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-tfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-trimfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
