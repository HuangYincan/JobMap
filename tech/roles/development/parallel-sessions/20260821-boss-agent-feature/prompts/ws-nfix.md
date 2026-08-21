# WS-nfix — 悬浮球四向吸附 + 面板垂直锚定(boss 派发,mini worker)

## 背景

用户反馈(2026-08-21,必须满足):

> 悬浮球移动后松手一定要自动吸附在边缘(上下左右)上,现在在视角中央松手不会自动吸附!

根因:`server/src/components/agent-ball.tsx` 松手逻辑只吸附左右 ——
`const edge = finalLeft < window.innerWidth / 2 ? "left" : "right"`(约 L120),top 只做 clamp 不吸附,
在视口中央松手即停在原地。同步地,`server/src/lib/agent-panel-placement.ts` 只支持水平锚定
(球在左/右半区 → 面板在球右/左侧,垂直仅 clamp),需要配套支持**垂直锚定**(球贴上/下边缘 → 面板在球下/上方)。

worktree: `/Users/acccan/dm-wt-agent-nfix`(分支 `feature/agent-snap-fix`,已从 dev `7f33be4` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-nfix.md`

## 任务(3 文件 + 测试 + 文档)

### 1. 四向吸附(agent-ball.tsx,只改松手吸附与初始位恢复,不动拖拽/点击/面板本身)

松手时按「球心到四边距离最近」吸附,并保留正交方向上的松手坐标:

- 距离:左 = centerX,右 = viewportW - centerX,上 = centerY,下 = viewportH - centerY;取最小者。
  平局打破顺序固定为 左→右→上→下(确定性,可测)。
- 吸附位置(EDGE_MARGIN=12 保持,球 44px):
  - left:left=12,top=松手 top,clamp [12, viewportH-56]
  - right:left=viewportW-56,top=松手 top,clamp 同上
  - top:top=12,left=松手 left,clamp [12, viewportW-56]
  - bottom:top=viewportH-56,left=松手 left,clamp 同上
- 吸附动画沿用现有 transition(0.35s cubic-bezier(0.32,0.72,0,1))。
- localStorage 持久化格式扩展:`{edge:'left'|'right'|'top'|'bottom', top, left?}`
  (left/right 沿用 {edge,top};top/bottom 新增 left 存水平位置)。**向后兼容**:旧值
  {edge:'left'|'right', top} 必须仍能正确恢复;新 edge 值解析不了时按默认位处理。
- **吸附决策抽成纯函数**(放 `server/src/lib/agent-panel-placement.ts` 或同目录新文件均可,
  几何全部走参数,零 DOM):`computeBallSnap(drop: {left, top}, viewport: {width, height},
  ballSize: number, margin: number) => {edge, left, top}` —— 必须可单测。

### 2. 垂直锚定(agent-panel-placement.ts)

`computePanelPlacement(ball, panel, viewport, edge?)` 增加可选第 4 参(edge 缺省 → 现有行为
= 按球心左右半区水平锚定 + 垂直 clamp,保证旧调用/旧测试语义不变)。edge 语义:

- `'left'`:面板在球右(pickPanelSide 现有机制);`'right'`:面板在球左 —— 现有逻辑,不动。
- `'top'`(球贴顶):首选面板在球**下方**(panel top = ball.bottom + 8);下方放不下(panel 底
  超出 viewportH-12)→ 翻转到球上方(panel bottom = ball.top - 8);上/下都放不下(panel 高
  + 8 + 24 > viewportH)→ mode 'sheet'。
- `'bottom'`(球贴底):对称 —— 首选上方,溢出翻转下方,都放不下 → sheet。
- 垂直锚定时水平方向:面板水平居中于球心,clamp [12, viewportW - panelW - 12](flip 后同样)。
- 移动端 ≤767px 恒 sheet 不变(最先判断)。
- 返回值结构不变(`{mode:'side', left, top, flipped}` | `{mode:'sheet'}`),flipped 语义照旧。

### 3. agent-panel.tsx

调用 `computePanelPlacement` 时把当前吸附 edge 传入(拖拽中/未吸附 → 不传,沿用现有行为;
面板在拖拽中跟随球的逻辑保持)。仅此一处消费方。

### 4. 测试(agent-panel-placement.test.mjs 扩展,或同目录新测试文件)

- computeBallSnap:四边各一例(含正交坐标保留)、四角附近、视口中央(上/下胜出)、
  平局打破顺序、clamp 边界(贴边坐标、极小视口)。
- computePanelPlacement 新增 edge 矩阵:top/bottom 首选侧 + 翻转 + 都放不下 → sheet +
  水平居中 clamp;'left'/'right' 与 edge 缺省行为回归(旧用例不动,保持通过)。
- 现有 13 个用例不许改坏。

### 5. 文档

`tech/24-agent-feature.md` 前端设计节:悬浮球「吸附最近边缘(left/right)」改为
「四向吸附(上下左右,球心最近边)」;面板锚定补垂直语义(贴上→面板下方/贴下→面板上方 +
翻转 + sheet)。只改相关小节,不重写文档。

`tech/24-agent-feature.md` §6.4(历史裁剪描述):补一句「裁剪按整轮删除(user + assistant
[+ 其 tool 结果组]),保持 tool_calls↔tool 配对」(ws-trimfix 实现已改,文档滞后)。

## 不碰(红线)

agent 后端(agent/{types,config,llm-provider,run-agent,mcp-*,tools/*}、/api/agent/chat)、
agent-map-executor、agent-chat-client、markdown-text、i18n 键(无新增文案)、map-engine/**、
其他组件。`agent-panel-placement.test.mjs` 旧用例只读不改(新增用例用追加)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-nfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-nfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-nfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
