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

### 调试历程

**第一次尝试**：在 `handleSelect` 中添加 `!mapReady || !geoSettled` 守卫
- ❌ 问题依旧存在

**第二次尝试**：补充 `onOpenDetail` 回调中的守卫
- 发现卡片点击触发两个状态更新路径，第一次修复遗漏了 `onOpenDetail`
- ❌ 问题依旧存在

**第三次诊断**：深入分析 effect 依赖和初始化流程
- 发现真正的根本原因：初始化过程中的**多次连续 setState** 触发并发加载

### 根本原因

**初始化时的状态更新序列**（`map-shell.tsx` 365-380行）：
```typescript
setMapReady(true);                              // 第1次setState
getCurrentPosition(map).then((loc) => {
  map.setCenter([lng, lat]);
  map.setZoom(15);
  setMapCenter({ lng, lat });                   // 第2次setState
  setUserLocation({ lng, lat });                // 第3次setState
  setSearchOrigin((prev) => prev ?? { lng, lat }); // 第4次setState
  setGeoSettled(true);                          // 第5次setState
});
```

**effect依赖数组**（661行）：
```typescript
}, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin, userLocation]);
```

**竞态条件的完整流程**：
1. `setMapReady(true)` 触发effect，但 `geoSettled=false`，guard返回
2. `setUserLocation` 改变 `userLocation` 依赖，触发effect，但 `geoSettled` 可能还是 `false`
3. `setGeoSettled(true)` 触发effect，此时 `mapReady=true && geoSettled=true`，开始加载
4. **关键问题**：第2步到第3步之间如果用户点击卡片或发生其他重新渲染，会导致effect在 `geoSettled` 刚变 `true` 时再次执行
5. 更严重的是，初始化过程中的5次 setState 可能在不同的渲染周期完成，每次都重新评估effect依赖
6. 即使没有用户交互，React批处理的边界也可能导致effect被多次触发

**为什么前两次修复无效**：
- 阻止用户交互只能防止手动触发的重新渲染
- 但无法防止初始化本身的多次 setState 触发并发加载
- effect的依赖包含 `userLocation`，这个值在初始化的第3步才设置
- 当 `setUserLocation` 触发重新渲染时，如果 `geoSettled` 恰好也变成 `true`，effect会执行两次

### 解决方案

使用 `loadingRef` 标志防止并发加载，在 `load()` 开始时检查并设置标志，完成后重置：

```typescript
// 添加 ref 跟踪加载状态 (154行)
const loadingRef = useRef(false);

// POI加载effect (594-656行)
async function load() {
  if (!mapReady || !geoSettled) return;
  if (loadingRef.current) return; // 防止初始化期间多次setState触发并发加载
  if (skipFetchRef.current) {
    skipFetchRef.current = false;
    return;
  }
  // ... 缓存检查 ...
  loadingRef.current = true;  // 标记加载开始
  setLoading(true);
  try {
    // ... 加载逻辑 ...
  } finally {
    if (!signal.cancelled) {
      setLoading(false);
      loadingRef.current = false;  // 标记加载结束
    }
  }
}
```

**关键点**：
1. `loadingRef` 是同步的，在 effect 重新运行时立即检查
2. 即使 React 在初始化期间多次触发 effect，第二次执行会立即返回
3. `finally` 块确保无论加载成功或失败都重置标志
4. 配合 `signal.cancelled` 检查，避免组件卸载后的状态更新

### 修改文件

- `server/src/components/map-shell.tsx` (154行，594行，652-655行)
- `tech/16-bug-fixes.md` (本文档)

### 技术细节

**React批处理和effect触发时机**：
- React 18 自动批处理同步代码中的 setState
- 但 `getCurrentPosition` 是异步的，其回调中的 setState 可能在不同的批次
- 这导致初始化的5次 setState 可能触发1-5次重新渲染
- 每次重新渲染都会重新评估 effect 依赖
- 如果依赖在两次渲染之间变化，effect 会重新运行

**为什么用ref而不是state**：
- `useState` 的更新是异步的，无法在同一个渲染周期内立即检查
- `useRef` 是同步的，修改后立即生效
- effect 在同一个渲染周期内多次检查 `loadingRef.current` 会得到最新值
- 这是防止并发的正确模式

**与skipFetchRef的区别**：
- `skipFetchRef`：跳过整个加载逻辑（用于缓存恢复）
- `loadingRef`：防止并发执行（用于竞态保护）
- 两个标志互补，解决不同的问题

### 测试验证

- ✅ 158个测试通过
- ✅ TypeScript编译无错误
- ⏳ 需要在浏览器中验证实际交互

### 用户体验改进

- 地图初始化期间即使触发多次重新渲染也只会加载一次
- 用户点击卡片不会中断加载（配合 `handleSelect` 和 `onOpenDetail` 的守卫）
- 加载流程保持连贯，不会重新开始

---

## 相关文档

- 设计系统：`tech/07-frontend-design-system.md`
- 组件开发指南：`.claude/skills/frontend-component-dev/skill.md`
- 测试规范：`server/tests/component-contracts.test.mjs`
