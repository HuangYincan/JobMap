# Batch Manifest — 20260822-boss-agent-navi

## 目标

用户实测「导航到深圳腾讯」反馈「导航功能无法实现」。三修复:
1. `amapuri://` 导航链接渲染成可点击按钮(DOMPurify URI 白名单剥 href 的根因修复;Web 兜底 URL 桌面可用);
2. 动作 JSON 不再裸奔正文(前端剥离 + prompt 约束);
3. 工具类别映射补全(navi/uri/link → directions)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report |
|---|---|---|---|---|---|
| navi | 导航链接可点击 + 正文隐藏动作 JSON + 类别映射 | `feature/agent-navi-links` | `../dm-wt-agent-navi` | `prompts/ws-navi.md` | `reports/ws-navi.md` |

拥有:`server/src/lib/markdown-pipeline.ts` + `server/src/components/markdown-text.tsx(+module.css)` + `server/src/lib/i18n.ts`(新键)+ `server/src/lib/agent-panel-state.ts` + `server/src/components/agent-panel.tsx` + `server/src/lib/agent/prompts.ts` + `server/src/lib/agent/run-agent.ts`(仅 TOOL_KIND_RULES 追加)+ 相关测试。

## 门禁

- `cd server && npm test`(1001+ 零漂移 + 新增)+ `npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

绿 → merger 合并 → 重建重启 3005 → 冒烟(SSE 无裸 JSON 泄漏项;导航按钮契约)→ 批次入库 → 汇报(deferred:Playwright 视觉验证)。
