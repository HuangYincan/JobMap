# WS-navi3 — 导航按钮文字不可见修复(boss 派发,mini worker)

## 背景

用户反馈(2026-08-22):导航按钮「初始状况不显示文本」。

boss 根因定位(CSS 特异性):
- `server/src/components/markdown-text.module.css:76` `.md a { color: #007aFF }` 特异性 (0,1,1);
- `:global(.dm-navi) { color: #fff; background: #007aff }`(L85)特异性 (0,1,0);
- `.md a` 胜出 → **按钮文字 = #007AFF 蓝,背景同为 #007AFF 蓝 → 蓝字蓝底,文字不可见**(hover #3395ff 仍低对比)。
- 附:href 的 `to=lng,lat,` 空 name 尾逗号(`markdown-pipeline.ts` buildNaviWebUrl:name 空时拼接多一个逗号)。

worktree: `/Users/acccan/dm-wt-agent-navi3`(分支 `fix/agent-navi-css`,已从 dev `ef20c09` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-inputbar/reports/ws-navi3.md`

## 任务

1. `server/src/components/markdown-text.module.css`:
   - `.dm-navi` 系列规则(hover/active 一并)选择器改为 **`.md :global(.dm-navi)`**(特异性 0,2,0 稳压 `.md a`),
     或等价更高特异性写法;确保 `.md a` 的 color/underline 不覆盖按钮(按钮保持白字无下划线);
   - 注释说明特异性原因(防回归)。
2. `server/src/lib/markdown-pipeline.ts`:
   - `buildNaviWebUrl`:name 为空时输出 `to=lng,lat`(去掉尾逗号);name 非空时 `to=lng,lat,name` 不变;
   - 纯函数测试补齐(空 name / 非空 name 两种断言,含现有用例回归)。
3. 契约测试:断言 `.md :global(.dm-navi)`(或等价)选择器存在且 `.md a` 之后定义(正则);`buildNaviWebUrl` 空 name 无尾逗号。
4. 全量回归零漂移。

## 不碰(红线)

其他一切(agent-panel/会话/记忆——ws-inputbar 在改;引擎;后端 agent)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-navi3/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-navi3 && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-navi3.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
