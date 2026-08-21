# WS-navi2 — 裸 amapuri:// URL 不触发按钮渲染(boss 派发,mini worker)

## 背景

用户实测:「导航按钮渲染有bug」。boss 代码级定位(铁证):

ws-navi 的全部集成测试用 `[导航](amapuri://...)` **链接语法**输入 → marked 的 link renderer 被调用 →
`dm-navi` 按钮渲染 → 测试全绿。但 LLM 真实输出是**裸 URL 文本**:
`amapuri://navi?sourceApplication=amap_mcp&lon=113.934497&lat=22.540517&dev=1&style=2` 直接裸露在句子里,
而 marked 的裸 URL 自动链接规则(内联 `url` 规则)**只认 https?/ftp/www 前缀** —— `amapuri://` 裸链接
不被识别为链接 → link renderer 从未触发 → 保持纯文本,按钮不渲染。

worktree: `/Users/acccan/dm-wt-agent-navi2`(分支 `feature/agent-navi-bare-url`,已从 dev `c5dd6fd` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/reports/ws-navi2.md`

## 任务(1 文件 + 测试)

### `server/src/lib/markdown-pipeline.ts`

在 `renderMarkdown` 内、`parser.parse` **之前**加**裸 URL 预扫描**:

- 正则匹配裸 `amapuri://navi?...` URL:`/(?<![\w])amapuri:\/\/navi\?[^\s<>"'()]+/gi`
  (lookbehind 排除作为链接语法 `](url)` 或已有 `<a>` 一部分的命中;URL 终止于空白/引号/尖括号/括号;
  尾随句点/逗号等标点若紧贴 → 交给 buildNaviWebUrl 解析失败则整体保留原样,不做标点剥离猜断——保守优先);
- 对每个命中:先**剔除尾部多余闭合括号/标点**做一次尝试(如 `...style=2)` → `style=2`),`buildNaviWebUrl` 成功 →
  整段替换为按钮锚:`<a class="dm-navi" href="<webUrl>" data-navi="<raw>" target="_blank" rel="noopener noreferrer"><label></a>`
  (label 为 opts.naviLabel ?? NAVI_DEFAULT_LABEL,escapeAttr 转义;href/data-navi 同 escapeAttr);
  失败 → 保持原文不替换(不改动任何现有文本)。
- 预扫描替换产物与 renderer 路径一致(同构按钮锚);renderer 路径(链接语法形态)保留不动。
- 纯函数导出(如 `preprocessNaviUrls(text, label): string`),可单测。

### 测试 `tests/markdown-pipeline.test.mjs` 追加

- 裸 URL(LLM 真实形态,含 sourceApplication/dev/style 额外参数)→ 输出含 `class="dm-navi"` + https href + data-navi 原文;
- 裸 URL 出现在句子中间(前后有中文)→ 按钮就位、其余文本原样;
- 多个裸 URL → 全部替换;
- 尾部带句号/右括号 → 正确剥离并替换;
- 坏 URL(lon=abc)→ 原样保留,不产出按钮;
- 链接语法形态(已有用例)回归不破坏。

## 不碰(红线)

其余一切(markdown-text.tsx 组件/事件委托、i18n、panel、prompts、后端 agent)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-navi2/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-navi2 && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-navi2.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
