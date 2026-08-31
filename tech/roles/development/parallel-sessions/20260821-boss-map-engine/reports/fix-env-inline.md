# fix-env-inline 汇报(2026-08-21)

## 修复点逐条(改前 → 改后)

1. **`server/src/lib/map-engine/engine-registry.ts` L50 附近**
   - 改前:`isConfigured: () => Boolean(process.env[desc.keyVar])`(动态属性访问,浏览器端恒 undefined)
   - 改后:新增 `envConfigured(keyVar)` 静态分派函数,`switch` 按 keyVar 逐一映射到裸字面量
     (`process.env.NEXT_PUBLIC_AMAP_KEY?.trim()` / `...TENCENT_JSAPI_KEY?.trim()` /
     `...BAIDU_AK?.trim()`),未知 keyVar 默认返回 `() => false`;
     `isConfigured: envConfigured(desc.keyVar)`。装配处 L101 注释「骨架 isConfigured 保持不动」
     语义不变——改的是骨架自身,全局生效。

2. **`server/src/lib/map-engine/tencent/tencent-engine.ts` L63-64 `getKey()`**
   - 改前:`(process.env[TENCENT_KEY_VAR] ?? '').trim()`(TENCENT_KEY_VAR 为常量,括号访问不被 Next 替换)
   - 改后:`(process.env.NEXT_PUBLIC_TENCENT_JSAPI_KEY ?? '').trim()`(裸字面量)。
     常量 `TENCENT_KEY_VAR` 保留,仍用于错误信息与 `keyVar` 字段。

3. **`server/src/lib/map-engine/baidu/baidu-engine.ts` L640 与 L649**
   - 改前:`process.env[BAIDU_KEY_VAR]?.trim()` 两处(isConfigured + load)
   - 改后:两处均为裸字面量 `process.env.NEXT_PUBLIC_BAIDU_AK?.trim()`。
     导出常量 `BAIDU_KEY_VAR` 保留(L651 错误信息继续引用)。

注:注释措辞刻意避免字面 `process.env[` 序列,防止契约正则误伤。

## 契约测试断言(追加于 `server/tests/component-contracts.test.mjs`)

新用例「map-engine 契约:env 读取必须裸字面量,禁止 process.env[ 动态访问(ws-b 轮 3)」:
- `readdirSync(lib/map-engine, { recursive: true })` 遍历目录内全部 .ts(当前 9 个文件,
  含 amap/tencent/baidu 子目录),逐一 `assert.doesNotMatch(code, /process\.env\[/)`;
- 断言 registry 对三个 key(`NEXT_PUBLIC_AMAP_KEY` / `NEXT_PUBLIC_TENCENT_JSAPI_KEY` /
  `NEXT_PUBLIC_BAIDU_AK`)均存在 `process\.env\.<key>` 裸字面量引用;
- 用例名含「map-engine」,与既有 map-engine 契约用例(ws-b)并列追加,未覆盖任何已有用例。

## 门禁结果

- npm test:865 通过 / 0 失败 / 2 skip(基线 825 之上新增内容来自本分支 tip 已并入的
  ws-b agent 测试,零漂移;新增契约用例在列,单独点名运行 1 pass)
- typecheck:通过
- docs-check:通过(Documentation policy check passed)
- git diff --check:通过

## Node 侧行为验证(isConfigured 静态分派)

独立运行 registry 实测(零配/单配/全配/空白值):
- 零配:`amap=false tencent=false baidu=false`
- 单配 amap:`amap=true tencent=false baidu=false`
- 全配:`amap=true tencent=true baidu=true`
- 空白值 amap(应 false):`amap=false`(trim 语义保留)

map-engine-selection / switch 既有测试(4 个)继续绿;map-engine 模式全量 78 个测试全绿。

## Commits(分支 fix/map-engine-env-inline,共 2 个)

- `b6688da` fix(map-engine): env 读取改静态字面量(浏览器端动态 process.env 失效)
- `2b661ed` test(map-engine): 契约禁止 process.env[ 动态访问

## 遇到的问题

无。worktree 起始即干净的 `fix/map-engine-env-inline` 分支(无上次中断遗留),全新开发。

门禁: PASSED
结论: OK
