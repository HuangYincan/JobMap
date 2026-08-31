# WS-eng-meta fix/mount-error-engine —— mountError.engine 语义修正(最后失败引擎)

## 背景(REPRO 实证,reports/repro.md R4 小标注)

全引擎失败时 `mountError.engine` 显示 `amap`(**偏好引擎**),而 `mountError.message` 却是 baidu
的失败信息(最后失败引擎)——字段语义不一致:重试 UI 小字显示 `amap · script-load-failed: BMapGL…`,
误导用户「高德挂了?」实际是百度挂在最后。修正:全链失败时 `mountError.engine` = **最后失败引擎**。

## 任务(worktree: /Users/acccan/dm-wt-eng-meta,分支 fix/mount-error-engine,从 dev 预建)

修改文件(边界):
- `server/src/hooks/use-map-engine.ts`(必改)
- `server/src/lib/map-engine/mount.ts`(如需;最终错误已携带 engineId(ws-2 加的),核实其字段名
  —— 若与 `mountError.engine` 映射不一致,以 mount.ts 为准归一)
- `server/tests/map-engine-mount.test.mjs` + `server/tests/hooks-contracts.test.mjs`(如需更新断言)

### 实现要点

1. catch 分支构造 `mountError` 时:`engine` 取错误对象携带的**最后失败引擎 id**
   (`err.engineId ?? err.engine ?? <fallback resolved.id>`,按实际错误形状取值;若 mount.ts 未把
   engineId 透传到最终错误,在该处补齐,但**不改 mountEngineView 签名/返回契约**)。
2. 语义注释更新(hook 顶部 mountError 契约注释):engine = 实际最后失败引擎,message = 对应引擎
   的失败详情。
3. 测试:更新/新增断言 —— 全链失败时 `mountError.engine === 'baidu'`(或测试兜底链的定义引擎,
   按测试 fixture 的引擎顺序写;不要硬编码假设,读 fixture 再写)。
4. 不碰 map-shell.tsx(ws-3 的错误小字消费 `mountError.engine`——语义修正后显示自然变对;
   显示层零改动)。

## 不做(边界)

- 不改 home-map.tsx / amap-api / viewport-search / i18n / tech/;不 merge、不 push、不碰主树。

## 门禁(worktree 内;cd server 运行)

- `npm test` 全绿(基线 1446 pass / 2 skip)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- Conventional Commits(如 `fix(map-engine): mountError.engine 语义改为最后失败引擎`),小步提交

## 回报

`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2/reports/ws-eng-meta.md`:
改动摘要、engineId 透传链路验证(错误对象→mountError 字段)、门禁结果(四项)、遇到的问题。
**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
