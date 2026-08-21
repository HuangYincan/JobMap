# WS-navi — 导航链接可点击 + 正文隐藏动作 JSON(boss 派发)

## 背景

用户实测 agent 对话「导航到深圳腾讯」反馈:「导航功能无法实现」。实证三问题:

1. **amapuri:// 导航链接不可点击**:LLM 输出 `amapuri://navi?sourceApplication=amap_mcp&lon=..&lat=..&dev=1&style=2`,
   markdown 管线(`server/src/lib/markdown-pipeline.ts` 的 link renderer)输出 `href="amapuri://…"`,
   但 **DOMPurify 的 URI 白名单不认 amapuri: scheme → href 被剥 → 链接变纯文本**;浏览器自动翻译还把它
   音译成「阿马普里://纳维?…」乱码。用户点击无任何反应。
2. **动作 JSON 裸奔正文**:LLM 在回复文本里复述 `{"actions":[{"type":"flyTo",...}]}`,用户看到 JSON 原文。
3. 「其他操作」类别过泛(生成导航链接的工具被归 other)。

worktree: `/Users/acccan/dm-wt-agent-navi`(分支 `feature/agent-navi-links`,已从 dev `f6604e2` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/reports/ws-navi.md`

## 任务

### 1. 导航链接渲染成可点击按钮(markdown-pipeline.ts + markdown-text.tsx + module.css + i18n)

- `markdown-pipeline.ts`:
  - 新增导出纯函数 `buildNaviWebUrl(raw: string): string | null`:解析 `amapuri://navi?lon=<lng>&lat=<lat>[&name=<名称>]`
    参数(容错:键名大小写/顺序任意、URL 编码值),返回高德 Web 导航 URL
    `https://uri.amap.com/navigation?to=${lng},${lat},${encodeURIComponent(name||'')}&mode=car&coordinate=gaode`;
    解析失败返回 null(不强行渲染)。
  - link renderer:当 `href` 以 `amapuri://` 开头且 buildNaviWebUrl 成功 →
    输出 `<a class="dm-navi" href="<webUrl>" data-navi="<raw amapuri>" target="_blank" rel="noopener noreferrer">打开高德导航</a>`
    (data-navi 保留原生 URI,DOMPurify 默认允许 data-*;href 为 https,天然通过 URI 白名单——**无需改 DOMPurify 配置**)。
    其余链接行为不变。
- `markdown-text.tsx`:
  - 增加可选 `lang` prop(zh/en,按钮文案经 i18n 新键 `agentOpenNavi`:zh「打开高德导航」/en「Open in AMap」);
  - 渲染容器挂**事件委托** click:命中 `.dm-navi` → `e.preventDefault()`;`/Mobi|Android/i.test(navigator.userAgent)`
    时 `location.href = data-navi`(唤起原生 App),桌面端放行默认 href(Web 导航,任何浏览器可用)。
  - 消毒配置不动;SSR 首渲染策略不变。
- `markdown-text.module.css`:`.dm-navi` 蓝色主题按钮样式(参照 liquid glass:蓝底白字圆角胶囊,
  `#007AFF` 主色、hover 提亮、紧凑 padding,内联于文本流)。

### 2. 正文不再展示动作 JSON(agent-panel-state.ts + agent-panel.tsx + prompts.ts)

- `agent-panel-state.ts` 新增导出纯函数 `stripActionJsonBlocks(text: string): string`:
  扫描 `{\s*"actions"\s*:` 起、花括号配对结束的 JSON 块(与后端 extractActions 同款配对扫描),整块连同
  前置换行移除;多块全清;配对失败(残缺)则保守移除到可配对的最近位置或保留原文不破坏。可单测。
- `agent-panel.tsx`:助手消息 content 渲染进 MarkdownText 前过 `stripActionJsonBlocks`;MarkdownText 传 lang。
- `prompts.ts`(zh/en 动作纪律节各加一句):「动作 JSON 由系统自动提取并执行,严禁在回复正文中复述/展示
  actions JSON——正文只写对用户友好的自然语言」。

### 3. 类别映射补全(run-agent.ts)

- 查 amap/tencent/baidu MCP 工具清单,确认生成 amapuri 导航链接的工具名;
- `TOOL_KIND_RULES` 追加 `navi|uri|url|link|scheme` → `'directions'`(导航类,与 route/direction 同列);
  若该工具已命中现有规则则不重复添加;测试补 1-2 条映射用例。

### 4. 测试

- `markdown-pipeline.test.mjs`(或既有):buildNaviWebUrl 解析矩阵(标准/大小写键/无 name/坏 URL→null);
  renderMarkdown 输出含 `class="dm-navi"` + https href + data-navi 原文;普通 http 链接行为不变。
- `agent-panel-state.test.mjs`:stripActionJsonBlocks(单块/多块/嵌套 payload 配对/前后缀文本保留/残缺容错)。
- `agent-prompts.test.mjs`(或既有):动作纪律节含「不得复述 actions JSON」句(zh/en)。
- 全量回归零漂移。

## 不碰(红线)

引擎/map-shell/executor/bridge/ball、后端 agent 其余逻辑(types/route/llm-provider/mcp-*)、DOMPurify 配置。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-navi/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-navi && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-navi.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
