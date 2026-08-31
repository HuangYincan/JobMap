# ws-shapefix 汇报(2026-08-21)

## 实际改动

- `server/src/lib/agent/llm-provider.ts` → 构建请求体时新增 `messages` 映射:对
  `role==='assistant'` 且带 `tool_calls` 的消息,将扁平 delta 产物
  `{id, name, arguments}` 转换为 OpenAI 兼容嵌套形状
  `{id, type:'function', function:{name, arguments}}`(保留 id 原值、arguments
  字符串原样);`...msg` 展开保证 content / reasoning_content / role 原样保留
  (DeepSeek 思考模式回传 reasoning_content 不受影响);role:'tool' 消息与无
  tool_calls 的消息原样透传。其余消息(非 assistant)不动。
- `server/tests/agent-llm-provider.test.mjs` → 追加用例「assistant(tool_calls)
  序列化为 OpenAI 嵌套形状,reasoning_content 保留;无 tool_calls 消息不受影响」:
  mock fetchLike 捕获请求体,断言 tool_calls 条目含 `type:'function'` 与嵌套
  `function:{name,arguments}`(两条、含中文参数串)、reasoning_content 保留、
  tool 消息 tool_call_id 原样、无 tool_calls 的 assistant/system/user 消息无附加字段。

## 门禁结果

- npm test: 948 通过(946 pass / 2 skip / 0 fail,含新用例)
- typecheck: 通过
- docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过(无输出)

## 遇到的问题

- 无。根因与修复路径与 boss 复现结论一致:DeepSeek 400 `missing field 'type'`
  由请求体序列化未转换扁平 tool_calls 导致;run-agent.ts L246 的扁平构造
  (ws-rfix 合并产物)是内部契约,转换收敛在 llm-provider.ts 序列化点,单点修复。

## 证据

- commit `a80e5ad` `fix(agent): assistant tool_calls 序列化为 OpenAI 嵌套形状 {id,type,function}`(2 files, +60/-1)
- npm test 尾部:`ℹ tests 948 / pass 946 / fail 0 / skipped 2`
- 新用例断言摘要:
  - `msgs[2].tool_calls` deepEqual `[{id:'c1',type:'function',function:{name:'amap__place_search',arguments:'{"query":"杭州"}'}}, {id:'c2',type:'function',function:{name:'rest__geocode',arguments:'{}'}}]`
  - `msgs[2].reasoning_content === '先想想'`(回传保留)
  - `msgs[3]`(tool)role/tool_call_id 原样;`msgs[4]`(assistant 无 tool_calls)无 tool_calls 字段

门禁: PASSED
结论: OK
