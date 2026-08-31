# WS-pinfix — agent 定位点显式锚定修复(boss 派发,mini worker)

## 背景

用户反馈(2026-08-21):「展示的poi点不会固定在地图上,随着视角的变化,poi会偏移」——
已澄清:**AI 助手的蓝色定位点,缩放时偏移**(平移不报)。多选排除其他类型:地图原有 pin 正常。

根因分析:`server/src/lib/agent-map-bridge.ts` 的 `addMarkers` 调 `view.createMarker({position, content})`
**不设 offset**。全代码库其余 marker(距离手柄 `[-9,-9]`、POI 图钉 `[-w/2,-h]`、徽章 `[-s/2,-s/2]`、城市聚合
`[-s/2,-s/2]`)全部显式设了锚点偏移,唯独 agent 点没有。AMap 对无 offset 的 content marker 依赖内容
**实测尺寸**做锚定(有 label 时是 flex 竖排,高度约 44px 且含非整数 2.5px 边框),缩放重排/动画期间
锚点计算错位 → 点与底图漂移。

worktree: `/Users/acccan/dm-wt-agent-pinfix`(分支 `feature/agent-pin-anchor`,已从 dev `4f73104` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/reports/ws-pinfix.md`

## 任务(1 文件 + 测试)

### 1. `server/src/lib/agent-map-bridge.ts` 的 addMarkers 重写 content 与锚点

- **内容固定尺寸**:外层 wrapper 固定 `width:20px;height:20px`(即圆点本体),圆点不再单独撑高;
  label(有则)**绝对定位**出流(不占布局):`position:absolute;bottom:calc(100% + 2px);left:50%;
  transform:translateX(-50%)`,样式保持蓝底白字圆角标签。
  效果:无论有无 label,content 尺寸恒为 20×20,锚点可精确计算。
- **显式锚点**:`offset: [-10, -10]` —— 圆点**圆心**锚定地理坐标(与距离手柄 18px 点 `[-9,-9]`
  同款语义)。经 MapMarkerOptions.offset 元组,三引擎适配器(amap Pixel / baidu Size / tencent {x,y})
  均已支持,零引擎改动。
- 保留:escapeHtml(label)、清理函数语义、非法点跳过、循环结构。

### 2. 测试

- 新增/扩展契约测试(建议 `server/tests/agent-bridge-contract.test.mjs` 或并入既有
  component-contracts):正则断言 addMarkers 的 createMarker 调用**包含 `offset: [-10, -10]`**
  且 content 外层为固定 20×20 wrapper(不含 flex 竖排撑高结构)。旧断言若锁定了 flex 布局 → 同步更新。
- 全量回归:`npm test` 零漂移。

## 不碰(红线)

其他一切(引擎适配器、POI 控制器、map-shell、agent-panel/executor、i18n)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-pinfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-pinfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-pinfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
