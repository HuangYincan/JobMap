# Bug Fixes Log

记录所有重要的bug修复，包括问题描述、根本原因、解决方案和相关文件。

## 2026-08-16: 滚动条体验优化

### 问题1：滚动条轨道背景持续显示

**症状**：
- 鼠标移到滚动区域后，滚动条轨道背景变成浅灰色
- 即使鼠标移开，背景色仍然保持显示
- 只有刷新页面才能恢复透明状态

**根本原因**：
- `globals.css` 中 `*:hover::-webkit-scrollbar-track` 和 `*:active::-webkit-scrollbar-track` 规则会在hover/active时给轨道添加背景色
- CSS伪类 `:hover` 和 `:active` 的生命周期是持久的，一旦触发就会保持状态
- 没有明确的"离开"状态来清除背景

**解决方案**：
- 删除了 `*:hover::-webkit-scrollbar-track` 和 `*:active::-webkit-scrollbar-track` 规则
- 滚动条轨道始终保持透明背景
- 只有滚动条thumb本身在hover时变深色，提供足够的视觉反馈

**修改文件**：
- `server/src/app/globals.css` (第100-106行，第120-125行删除)

**测试验证**：
- ✅ 滚动条轨道始终透明
- ✅ 滚动条thumb hover时正确变色
- ✅ 鼠标移开后无残留背景

---

### 问题2：POI列表滚动条弹跳卡顿

**症状**：
- 缓慢滚动POI列表时，卡片正常滚动
- 但滚动条在某个位置上下弹跳，无法平滑移动
- 滚动条位置与实际滚动内容不同步

**根本原因**：
- `poi-list.module.css` 中 `.cardSlot` 使用了 `content-visibility: auto` 和 `contain-intrinsic-size: auto 148px`
- 当卡片滚动到可视区域外时，浏览器使用 `contain-intrinsic-size: 148px` 作为占位高度
- 但实际卡片高度不是固定的148px（有多张照片或多个职位时会更高）
- 导致滚动容器总高度在"实际高度"和"占位高度"之间反复切换
- 滚动条位置计算错误，产生弹跳效果

**解决方案**：
- 从 `.cardSlot` 移除 `content-visibility: auto` 和 `contain-intrinsic-size: auto 148px`
- 让所有卡片保持真实高度，不使用虚拟化占位
- 同时优化滚动条尺寸：
  - 宽度从 10px 增加到 14px
  - border从 2px 增加到 3px
  - 实际可见thumb宽度从 6px 增加到 8px
- 改善了滚动条的可操作性和视觉反馈

**修改文件**：
- `server/src/components/poi-list.module.css` (第14-15行删除)
- `server/src/app/globals.css` (第77-79行，第88-89行，第109-111行修改)
- `server/tests/component-contracts.test.mjs` (第32-33行更新测试用例)

**技术细节**：
- `content-visibility: auto` 是Chrome的性能优化特性，用于跳过不可见内容的渲染
- `contain-intrinsic-size` 提供一个估算高度，但如果估算不准确会导致布局抖动
- 对于内容高度差异较大的列表（如POI卡片），不适合使用这个优化
- 保持真实DOM高度可以确保滚动条位置计算准确

**性能影响**：
- 移除 `content-visibility: auto` 后，所有卡片都会被渲染
- 当前POI列表通常在50-100个卡片范围内，渲染性能影响可接受
- 换来了更好的用户体验（滚动流畅度）
- 如果未来需要优化大列表性能，应考虑使用虚拟滚动库（react-window）而不是content-visibility

**测试验证**：
- ✅ 滚动条平滑移动，不再弹跳
- ✅ 滚动位置与内容完全同步
- ✅ 158个测试通过
- ✅ TypeScript编译无错误

---

### 问题3：卡片圆角处理和头像边框优化

**症状**：
- POI卡片圆角周围有诡异的背景色
- 液态玻璃效果不够精致
- 头像边框过粗（2px），不够优雅

**解决方案**：

**卡片优化**（`poi-card.module.css`）：
- 提升背景透明度：`0.34` → `0.48`（亮色），`0.42` → `0.52`（暗色）
- 提升边框透明度：`0.55` → `0.68`
- 简化阴影效果：移除多余的 `inset` 内阴影
- 优化渐变层透明度：`0.65` → `0.55`，调整渐变位置
- 降低 backdrop-filter 饱和度：`200%` → `180%`

**头像优化**（`map-shell.module.css`）：
- 边框宽度：`2px` → `0.5px`
- 登录用户边框透明度：`0.85` → `0.35`
- 游客边框透明度：`0.45` → `0.25`
- 现在是一道精致的细线，符合苹果设计语言

**修改文件**：
- `server/src/components/poi-card.module.css` (多处透明度和效果调整)
- `server/src/components/map-shell.module.css` (第429-445行头像边框)

**测试验证**：
- ✅ 卡片圆角干净，无异常背景色
- ✅ 液态玻璃效果更精致
- ✅ 头像边框轻盈优雅

---

## 最佳实践

基于这次修复总结的经验：

### 1. CSS性能优化特性的使用场景
- `content-visibility: auto` 适合高度一致的列表
- 不适合高度差异大的动态内容
- 使用前必须提供准确的 `contain-intrinsic-size`
- 如果无法估算准确高度，宁可不用

### 2. 滚动条样式设计原则
- 轨道背景应保持透明或极浅色
- 避免使用 `:hover` 状态给轨道添加持久背景
- thumb是主要的交互元素，应该在hover时提供明确反馈
- 宽度建议 12-16px，thumb可见部分至少 6-8px

### 3. 液态玻璃效果调优
- 背景透明度不要过低（< 0.3），否则显得脏
- 边框透明度应该高于背景（0.6-0.8范围）
- backdrop-filter 饱和度不要过高（150-180%合适）
- 渐变层的透明度要比背景低，才能产生高光效果

### 4. 测试验证流程
- 修改CSS后必须在浏览器中实际测试
- 滚动相关的bug必须手动滚动验证
- 更新测试用例以匹配新实现
- 确保TypeScript编译通过

---

## 2026-08-16: 地图初始化期间点击卡片导致重新加载

### 问题描述

**症状**：
- 在地图尚未完全初始化加载时点击侧控栏的POI卡片
- 地图会重新开始加载，而不是持续当前的加载流程
- 导致加载进度丢失，用户体验不连贯

**根本原因**：
- POI加载effect（`map-shell.tsx` 565-661行）依赖 `mapReady` 和 `geoSettled` 状态
- 这两个状态在地图初始化过程中从 `false` 过渡到 `true`
- 当用户点击卡片时，会触发多个状态更新导致组件重新渲染
- 重新渲染时，如果 `mapReady` 或 `geoSettled` 刚好完成过渡，React检测到依赖变化
- 这导致POI加载effect重新执行，`load()` 函数重新运行，造成加载重启
- 这是一个经典的React effect竞态条件（race condition）

**问题核心**：
- 点击卡片会触发两个状态更新路径：
  1. `POIList` → `onSelect` → `handleSelect` → `setSelectedId(poi.id)`
  2. `POIList` → `onSelect` → `openDetail` → `onOpenDetail` → `setDetailPoi(poi)`
- 即使 `handleSelect` 有守卫，`onOpenDetail` 中的 `setDetailPoi` 仍然会执行
- 在初始化未完成时更新任何状态都会在关键时刻触发不必要的重新渲染
- 虽然 `selectedId` 和 `detailPoi` 不在effect依赖数组中，但重新渲染本身会让effect重新评估依赖

**解决方案**：

在所有会触发状态更新的卡片点击回调中添加初始化状态守卫：

```typescript
// map-shell.tsx 967-971行 - handleSelect
const handleSelect = useCallback((poi: POI) => {
  // 地图初始化期间不处理选中，避免触发重新加载
  if (!mapReady || !geoSettled) return;
  setSelectedId(poi.id);
}, [mapReady, geoSettled]);

// map-shell.tsx 1583-1588行 - onOpenDetail
onOpenDetail={(poi) => {
  // 地图初始化期间不处理详情打开，避免触发重新加载
  if (!mapReady || !geoSettled) return;
  setDetailPoi(poi);
  if (poi.location) flyToLocation(mapInstance.current, poi.location.lng, poi.location.lat);
}}
```

**关键点**：
1. 在地图完全就绪之前（`mapReady && geoSettled`），忽略所有卡片交互
2. 两个状态更新路径都需要守卫，缺一不可
3. 将 `mapReady` 和 `geoSettled` 加入 `useCallback` 依赖数组
4. 这确保回调始终检查最新的初始化状态
5. 用户在初始化期间点击卡片不会有任何副作用

**修改文件**：
- `server/src/components/map-shell.tsx` (第967-971行，第1583-1588行)

**技术细节**：

React effect依赖的竞态条件：
- Effect有依赖数组 `[mode, query, mapReady, geoSettled, ...]`
- 当依赖变化时，effect会重新运行
- 组件重新渲染时，React会重新评估所有effect的依赖
- 如果在渲染的**同一时刻**依赖刚好变化（如 `mapReady` 从 `false` → `true`），effect会重新执行
- 这就是为什么即使 `selectedId` 和 `detailPoi` 不在依赖数组中，点击卡片仍会触发重新加载

多路径状态更新：
- `SecondarySidebar` 的 `openDetail` 函数内部调用了两个回调：
  - `onSelect?.(poi)` → `handleSelect` → `setSelectedId`
  - `onOpenDetail?.(poi)` → 内联箭头函数 → `setDetailPoi`
- 第一次修复只在 `handleSelect` 中添加了守卫，但遗漏了 `onOpenDetail`
- `onOpenDetail` 直接更新 `setDetailPoi`，仍然会在初始化期间触发重新渲染
- 必须在两个路径都添加守卫才能完全阻止竞态条件

防御性编程原则：
- 异步状态转换期间，阻止所有可能触发重新渲染的用户交互
- 在所有回调中添加状态守卫，而不是依赖React的渲染时机
- 对于涉及异步初始化的组件，始终在交互处理器中检查就绪状态
- 跟踪所有状态更新路径，确保没有遗漏的入口

**测试验证**：
- ✅ 158个测试通过
- ✅ TypeScript编译无错误
- ✅ 生产构建成功
- ⏳ 需要在浏览器中验证实际交互

**用户体验改进**：
- 地图初始化期间点击卡片不会中断加载
- 加载流程保持连贯，不会重新开始
- 用户在地图就绪后点击卡片仍然正常工作

---

## 相关文档

- 设计系统：`tech/07-frontend-design-system.md`
- 组件开发指南：`.claude/skills/frontend-component-dev/skill.md`
- 测试规范：`server/tests/component-contracts.test.mjs`
