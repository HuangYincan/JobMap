# WS-pinfix2 — 百度/腾讯引擎 content marker 通用修复(boss 派发)

## 背景

用户反馈(2026-08-22):百度/腾讯底图上,agent 导航后不显示目标点。

Explore 根因(带 SDK 级证据):
- **百度**:`server/src/lib/map-engine/baidu/baidu-engine.ts:665`(配 :713-729)`raw.setContent?.(opts.content)`
  在 BMapGL v1.0 SDK 是**空操作**(脚本实证:`setContent:function(e){this.content=e||""}` 只存字符串,
  msTarget DOM 渲染不存在)→ content marker 只渲染 1×1 透明图标,**目标点完全不可见**;
- **腾讯**:`server/src/lib/map-engine/tencent/tencent-engine.ts:703-733` 浏览器端 TMap v1.exp 无单点 Marker
  (装配表只有 MultiMarker),agent 的 content+offset 无 icon 样式被 `resolveMultiStyle` 生成无
  src/width/height 的 `MarkerStyle({anchor})` → GL 校验 `width 属性无效` 拒绝渲染;**content 同时被降级**
  (MultiMarker 无 HTML 渲染)。

**共性**:两个引擎的 createMarker 都不支持 HTML content 渲染(百度 API 空操作;腾讯 GL 无 DOM marker)。
此缺陷不只影响 agent 蓝点——**POI 徽章/城市聚合等所有 content marker 在百度/腾讯下同样不显示**(既有潜在问题)。

修复裁决:**引擎层通用修复** —— content 存在时,百度/腾讯的 createMarker 用各自官方的 **DOM 覆盖物机制**
渲染 HTML(content 锚定 = lngLat 转容器像素 - offset):百度 BMapGL 自定义 Overlay(initialize/draw),腾讯
TMap DOMOverlay(或项目现有 SDK 实证的等价机制)。三引擎 content 语义一致;amap 原生 content 支持不动。

worktree: `/Users/acccan/dm-wt-agent-pinfix2`(分支 `fix/engine-content-overlay`,已从 dev `df4b26d` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-bugfix/reports/ws-pinfix2.md`

## 任务

1. **`server/src/lib/map-engine/baidu/baidu-engine.ts`**:
   - createMarker:opts.content 存在时走 DOM overlay 路径(自定义 Overlay 子类):
     - 构造 HTML 容器(content 原文注入,注意**转义边界**:content 是引擎调用方可信的 HTML——与 amap 同语义,
       仍原样注入;这是既有契约);尺寸 = content 实际尺寸(挂载后测量或由调用方 offset 补偿);
     - draw() 内 `lngLatToContainerPoint`(bd09 坐标)→ 容器像素 - offset 定位;
     - 移除时容器摘除;与现有 marker 簿记/remove 语义一致;
   - 无 content 路径(纯 position/offset/icon 场景)保持现有行为;opts.onClick 在 overlay 上绑定;
   - 防御性守卫:SDK 无 Overlay 能力 → 回退现有 setContent 路径(不抛错)。
2. **`server/src/lib/map-engine/tencent/tencent-engine.ts`**:
   - createMarker:content 存在时走 TMap DOM overlay(项目实证可用机制;若无 DOMOverlay,用 MultiMarker
     的 icon 化降级并明确注释限制):
     - draw/onAdd 定位:lngLat 转容器像素 - offset;内容原样注入;
     - 移除 = overlay 摘除;click 绑定;
   - 无 content 路径不变;防御性守卫同上。
3. **锚定一致性**:两个引擎的 overlay 定位都按「content 左上角 - offset 元组」与 amap 语义对齐
   (agent 蓝点 offset [-10,-10] → 圆心对准坐标,行为与高德一致)。
4. 测试:
   - 引擎层现有测试(mock SDK)若可扩展:overlay 路径断言(构造/定位/移除);不可行则**契约测试**:
     断言 baidu/tencent 引擎源码含 DOM overlay 渲染路径(正则,如 Overlay/DOMOverlay/自定义 overlay 类名)
     且 content 分支不再只依赖 setContent;
   - agent 侧无需改(bridge 契约不变);
   - 全量回归零漂移(amap 路径不动)。

## 不碰(红线)

amap 引擎、agent 前端全套、POI 控制器(map-markers.ts——content 语义不变,由引擎层统一生效)、
后端 agent、markdown。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-pinfix2/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-pinfix2 && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(map-engine): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-pinfix2.md`(改动摘要 + SDK 证据复核 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
