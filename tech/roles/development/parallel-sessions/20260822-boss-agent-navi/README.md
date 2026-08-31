# Batch Manifest — 20260822-boss-agent-navi

## 目标

用户实测「导航到深圳腾讯」反馈「导航功能无法实现」。三修复:
1. `amapuri://` 导航链接渲染成可点击按钮(DOMPurify URI 白名单剥 href 的根因修复;Web 兜底 URL 桌面可用);
2. 动作 JSON 不再裸奔正文(前端剥离 + prompt 约束);
3. 工具类别映射补全(navi/uri/link → directions)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report |
|---|---|---|---|---|---|
| navi | 导航链接可点击 + 正文隐藏动作 JSON + 类别映射 | `feature/agent-navi-links` | (已清理) | `prompts/ws-navi.md` | `reports/ws-navi.md` |
| navi2 | 裸 amapuri:// URL 预扫描修复(渲染 bug) | `feature/agent-navi-bare-url` | `../dm-wt-agent-navi2` | `prompts/ws-navi2.md` | `reports/ws-navi2.md` |
| bubble | 删空白气泡与思考提示 | `feature/agent-drop-think-ui` | (已清理) | `prompts/ws-bubble.md` | `reports/ws-bubble.md` |
| done | 完成/停止显式 UI + 清屏 | `feature/agent-completion-ui` | `../dm-wt-agent-done` | `prompts/ws-done.md` | `reports/ws-done.md` |

**合并顺序**:navi(已合)→ navi2(已合)→ bubble(已合)→ done。

拥有:done = `agent-panel.tsx` + `agent-map-executor.ts` + i18n + module.css + 测试。

## 门禁

- `cd server && npm test`(1001+ 零漂移 + 新增)+ `npm run typecheck`
- 根 `make docs-check` + `git diff --check`

## 合并后(boss/merger)

绿 → merger 合并 → 重建重启 3005 → 冒烟(SSE 无裸 JSON 泄漏项;导航按钮契约)→ 批次入库 → 汇报(deferred:Playwright 视觉验证)。
