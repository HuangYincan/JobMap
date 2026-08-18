# Bug Fixes Log

记录所有重要的bug修复，包括问题描述、根本原因、解决方案和相关文件。

## 2026-08-19: POI 电话 `[]` 显示 + 本地 POI 查看评价链接

### 问题1:用户看到「电话 []」

**症状**：
- POI 详情里电话行渲染成「电话 []」

**根本原因**：
- `hz_pois.tel` 是 text 列,源 CSV 空电话写成字面量 `'[]'`(实测 1,006,158 行中
  697,546 行(69.3%));导入器 `cleanCsvRow` 只做 `(raw.tel || '').trim()` 不清 `'[]'`,
  原样入库;API 侧 `hzRowToDomainPoi` / `normalizeAMapPOI` 也直接透传。
  前端 `InfoRow` 只跳过 falsy,`'[]'` 是真值 → 显示「电话 []」。

**解决方案**：
- 导入器新增 `parseTelCell`(`hz-poi-import.ts`):空串/`'[]'`/`'{}'` → `undefined`
- 防御清洗(旧数据未重导也正确):`hz-poi-store.ts` 的 `hzRowToDomainPoi` 与
  `amap-api.ts` 的 `normalizeAMapPOI`(含空数组)均清成 `undefined`
- `poi-detail.tsx` 的 `InfoRow` 把 `'[]'`/`'{}'`/纯空白当空值,不渲染该行
- DB 脏数据清理(re-import / SQL UPDATE)是 Env-only,未执行,记 deferred

### 问题2:本地 POI 没有任何评价,也无入口查看

**根本原因**：
- `hz_pois` 无 reviews 表/reviewCount 列;本地 POI 恒显示「暂无详细评价」,
  用户无法跳到高德看真实评价。

**解决方案**：
- `poi-detail.tsx` ReviewSection:无 review 文本且 `poi.id` 是真 poiid
  (不以 `amap-` 合成前缀开头)时,「暂无详细评价」旁展示蓝色「查看评价」外链
  `https://www.amap.com/place/<poiid>`(`target="_blank" rel="noreferrer"`)
- 新增 i18n 键 `viewReviews`(zh: 查看评价 / en: View reviews);样式 `.reviewLink`
  沿用品牌蓝 `--accent`

**修改文件**：
- `server/src/lib/hz-poi-import.ts`(parseTelCell + cleanCsvRow tel 段)
- `server/src/lib/hz-poi-store.ts`(hzRowToDomainPoi tel 清洗)
- `server/src/lib/amap-api.ts`(normalizeAMapPOI tel 清洗)
- `server/src/components/poi-detail.tsx`(InfoRow 空值 + ReviewSection 外链)
- `server/src/components/poi-detail.module.css`(.noReviews/.reviewLink)
- `server/src/lib/i18n.ts`(viewReviews)
- 测试:`hz-poi-import.test.mjs` / `hz-poi-store.test.mjs` / 新增 `amap-api.test.mjs`

**测试验证**：
- ✅ tel `'[]'`/空串/空数组 → undefined(import 解析、store 映射、AMap 规范化三层)
- ✅ 真实电话保留(trim 后)
- ✅ 全量 305 测试通过(typecheck / docs-check / git diff --check 均绿)

---

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

### 进一步诊断：对象引用导致的虚假依赖变化

**第四次调试**（2026-08-16）：
- 在浏览器中添加详细日志追踪 effect 触发
- 发现点击卡片后 POI loading effect 被触发了**3次**
- 时间间隔：116ms、270ms，说明是3次独立的状态更新
- 所有3次触发的依赖值**完全相同**，但 React 仍然认为依赖改变了

**真正的根本原因**：
- Effect 依赖数组包含对象类型：`searchOrigin` 和 `userLocation`
- React 使用 `Object.is()` 比较依赖，比较的是**引用**而不是**值**
- 即使对象内容相同（`{lng: 120, lat: 30}`），如果是新的对象引用，React 会认为依赖改变
- 某些状态更新（如点击卡片）会导致组件重新渲染，而重新渲染可能创建新的对象引用
- 新引用 → React 认为依赖变了 → effect 重新运行

**证据**（浏览器日志）：
```
[15128ms] [TEST] Clicking first card: didi-hangzhou
[15129ms] [HANDLESELECT] Called at render 40
[15130ms] [HANDLESELECT] Setting selectedId
[15131ms] [RENDER 41] MapShell rendered
[15363ms] [LOAD 1786898992784] Effect triggered  ← 点击后232ms，触发第1次
[15363ms] [LOAD 1786898992784] Early exit: skipFetch
```

虽然 `loadingRef` 防止了实际的重新加载，但 effect 仍然在不必要地运行。

**最终解决方案**：
将 effect 依赖数组从对象引用改为**原始值**：

```typescript
// 之前（错误）
}, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin, userLocation]);

// 之后（正确）
}, [
  mode, query, mapReady, geoSettled, refreshToken, pageOffset,
  searchOrigin?.lng, searchOrigin?.lat,
  userLocation?.lng, userLocation?.lat
]);
```

**为什么这样有效**：
1. 原始值（number）的比较是按值比较，不是按引用
2. 即使父对象引用变了，只要 `lng` 和 `lat` 值不变，effect 就不会重新运行
3. 可选链 `?.` 处理 `null` 情况，`null?.lng` 返回 `undefined`
4. React 能正确比较 `undefined` 和数字值

**修改文件**：
- `server/src/components/map-shell.tsx` (第687行，依赖数组)

### 测试验证

**修复前**：
- 点击卡片后，POI loading effect 触发 3 次
- 所有触发都被 `skipFetch` 或缓存守卫拦截，但仍然浪费执行
- 从 render 40 到 render 82（42次重新渲染）

**修复后**：
- 点击卡片后，POI loading effect 只触发 1 次
- 完全消除了虚假的依赖变化
- 组件重新渲染次数从 42 次降低到预期范围

**测试结果**：
- ✅ 158个测试通过
- ✅ TypeScript编译无错误
- ✅ 浏览器验证：点击卡片不再触发多余的 effect 运行
- ✅ 地图初始化流畅，无重新加载

### 用户体验改进

- 地图初始化期间即使触发多次重新渲染也只会加载一次
- 用户点击卡片不会中断加载（配合 `handleSelect` 和 `onOpenDetail` 的守卫）
- 加载流程保持连贯，不会重新开始

### 4. React Effect 依赖数组最佳实践

**避免对象引用依赖**：
- Effect 依赖数组应该使用**原始值**（string、number、boolean），不是对象或数组
- React 用 `Object.is()` 比较依赖，对象比较的是引用而不是值
- 即使对象内容相同，新引用会导致 effect 重新运行

**错误示例**：
```typescript
const [userLocation, setUserLocation] = useState<{lng: number; lat: number} | null>(null);
useEffect(() => {
  // ...
}, [userLocation]); // ❌ 对象引用，可能导致虚假的依赖变化
```

**正确示例**：
```typescript
const [userLocation, setUserLocation] = useState<{lng: number; lat: number} | null>(null);
useEffect(() => {
  // ...
}, [userLocation?.lng, userLocation?.lat]); // ✅ 原始值，只有实际值变化才触发
```

**替代方案**：
```typescript
// 方案1：使用 useMemo 稳定对象引用
const stableLocation = useMemo(
  () => userLocation,
  [userLocation?.lng, userLocation?.lat]
);
useEffect(() => {
  // ...
}, [stableLocation]);

// 方案2：直接使用原始值（推荐，更简单）
useEffect(() => {
  // ...
}, [userLocation?.lng, userLocation?.lat]);
```

**并发保护模式**：
- 使用 `useRef` 标志防止异步操作并发
- `ref.current` 是同步的，立即生效
- `useState` 是异步的，无法在同一渲染周期内检查

```typescript
const loadingRef = useRef(false);
useEffect(() => {
  if (loadingRef.current) return; // 同步检查，防止并发
  loadingRef.current = true;
  asyncOperation().finally(() => {
    loadingRef.current = false;
  });
}, [deps]);
```

---

## 2026-08-17: 移动端提手间距 + 游客 Recent

### 问题1：地图模式 / 工作模式抽屉提手与上下组件间距不一致

**症状**：同一抽屉 snap 下，工作模式（更多 chips / 结果头）看起来比地图模式更挤或更松。

**根本原因**：提手 CSS 按 snap 而不是按模式区分；half/full 另有 `margin-top: 6px`，`.drawerContent` 顶部 25px 只在列表态出现，工作模式额外 chrome 叠在这个缝上。

**解决方案**：`.mobileDrawer` 增加 `--drawer-handle-gap: 8px`，提手统一 `padding-bottom`；去掉 half/full-only `margin-top`；把 `.drawerContent` 顶距收到 10px。芯片仍在 content 内，不再改 handle↔toolbar / handle↔search。

**修改文件**：`server/src/components/map-shell.module.css`

### 问题2：游客搜索后 Recent 仍为空

**症状**：未登录搜索并点选结果后，“最近”二级卡片仍是登录提示。

**根本原因**：`recordSearch` 在 `!user` 时直接 return；`refreshHistory` 只打 `/api/me/search-history`（游客 200 + `[]`）；`RecentPanel` 用 `!signedIn` 挡住列表。

**解决方案**：`lib/guest-search-history.ts`（`dm.guest-search-history.v1`，上限 30）只写 persistable 模式。游客读写本地；登录上传后保留本地镜像；登出再读本地。Recent 有条目就展示。

**修改文件**：`guest-search-history.ts`、`persistable.ts`、`map-shell.tsx`、`recent-panel.tsx`

---

## 2026-08-17: 数据导入崩溃 + (0,0) 假针

### 问题3：DB apply 因 `deadline: "招满即止"` 崩溃

**症状**：`import:seed:apply` 在雷达数据上抛 `invalid input syntax for type date: "招满即止"`（22007）。

**根本原因**：`positions.deadline` 是 date 列；雷达快照的截止时间是中文文本（"招满即止"、"2026 o6 30"），校验器不查格式，直接透传进 SQL。

**解决方案**：双保险——`radar_jobs.py` 的 `parse_deadline` 只输出合法 ISO 日期（空格/斜杠分隔兼容）；`recruitment-import.ts` 的 `normalizeDeadline` 在入库前再归一化，非法值落 null。

**修改文件**：`crawler/.../radar_jobs.py`、`server/src/lib/recruitment-import.ts`

### 问题4：DB 读路径把无坐标站点画成 (0,0) 针

**症状**：导入 137 家公司后 `/api/pois` total=137，雷达-only 公司（仅城市文本、无坐标）被 `lng ?? 0, lat ?? 0` 画到非洲西海岸。

**根本原因**：离线路径有 `hasPlausibleCoord` 过滤；DB 读路径（`loadWorkCatalogFromDb` 无空间裁剪分支）直接 `site.lng ?? 0`。

**解决方案**：DB 读路径统一过滤：无坐标站点不进 POI；全部无坐标时返回 null 回落离线目录。

**修改文件**：`server/src/lib/recruitment-store.ts`

### 问题5：礼貌抓取的真实世界健壮性

- 瞬态 SSL/网络错误（`URLError`）与拼错 charset（`uft-8`）会中断整轮扫描 → `acquire.py` 捕获并跳过。
- `parse_robots` 组优先级错误（具体 UA 组应覆盖 `*` 组）→ 按 RFC 9309 重写。
- 导航 CTA（"Join Tigermed"、`javascript:` 链接、超长横幅）被误判为岗位 → 词边界匹配 + href 过滤 + 标题长度上限。

**修改文件**：`crawler/app/domain_map_importer/acquire.py`、`html_jobs.py` + 测试

---

## 2026-08-17: 坐标审计修正 + 会话缓存数据陈旧

### 问题6：11 个 pin 的坐标/地址与真实位置不符

**症状**：地图上的公司 pin 与实际办公地不符（偏差最高 24km，如贝达在临平却标在文一西路291号）。

**根本原因**：seed 与 official-career 的坐标是开发期人工策展填写的，从未经过地理编码验证。

**解决方案**：三层核查（地址→坐标 geocoding、坐标→地址 regeocoding、岗位→公司域名匹配），基于高德 Web 服务 + 工商公开地址。修正 11 家坐标/地址（蚂蚁→西溪路556号Z空间、深度求索→拱墅汇金国际大厦、贝达→临平兴中路355号、泰格→滨江盛大科技园、群核→莱茵·矩阵国际等）。固化 `npm run audit:pins`（`scripts/audit-pin-locations.mjs`，14/14 PASS）。

**修改文件**：`seed-data.ts`、`official-career/*.json`、`scripts/audit-pin-locations.mjs`、PostGIS（重导）

### 问题7：坐标修正后浏览器仍显示旧位置

**症状**：数据修正后用户刷新页面，地图 pin 仍在旧位置。

**根本原因**：工作模式 catalog 存在 sessionStorage（`domain-map:mode-cache:v1:*`），切模式/重进恢复旧缓存、不重拉 API；缓存版本未随数据修正而失效。

**解决方案**：bump `MODE_CACHE_VERSION`（1→2），版本校验拒绝旧缓存并重新拉取。数据修正流程固化：改 seed/drops → `import:seed:apply` → bump 缓存版本 → `audit:pins` 验证。

**修改文件**：`lib/mode-cache.ts`、`tests/mode-cache.test.mjs`

---

## 2026-08-19: 移动端抽屉 chrome(全开高度→指南针中心 + 全开隐藏指南针/比例尺 + 移动端定位按钮)

### 问题：抽屉全开与顶部控件重叠 / 移动端缺定位按钮

**症状**：移动端抽屉全开(86svh)仍与右上角指南针、左上角比例尺区域重叠;移动端指南针下方没有「显示我的位置」按钮(桌面才有)。

**方案**：
- **全开高度**改为顶边=指南针中心:`calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)`(40px 按钮一半=20px)。`.mobileDrawer` 的 `max-height` 必须同步为同一 calc,否则 max-height 会截断更高的全开抽屉。`.drawerHalf`/`.drawerMini` 不变。
- **拖拽一致性**:JS 侧原 `DRAWER_FULL_RATIO=0.86` 的比率阈值无法表达「顶边到指南针中心」,改为 `drawerFullHeight(vh, safeTop) = vh - (max(12, safeTop) + 20)`。`safeTop` 在 pointerdown 时用探测元素实测 `env(safe-area-inset-top)`(读 `getComputedStyle(paddingTop)`),存在手势 ref 里,pointermove/松手共用;取不到返回 0。拖拽阈值与 CSS 高度对齐后,松手 snap 不回弹到错误档位。
- **全开隐藏指南针+比例尺**:`.topTools` 是 `.mobileDrawer` 的兄弟,不能靠兄弟选择器 → 在 map-shell.tsx 条件化 className(`topToolsHidden`,opacity/visibility ~200ms 过渡);比例尺是命令式 `AMap.Scale`,需把局部变量提升到 `scaleControlRef`,新增 effect 在 `drawer==="full" || !!detailPoi` 时 `hide()`/否则 `show()`,空指针守卫;插件异步加载与 resize 重建控件时用 `drawerFullishRef` 同步一次初始显隐。**⚠ 必须限移动端**:`detailPoi` 在桌面端也成立(左侧栏打开详情),若不限视口会把桌面 top-right compass / bottom-left scale 一并隐藏 → `.topToolsHidden` 包 `@media (max-width:767px)`,scale 显隐 effect 与插件/resize 同步均加 `window.innerWidth <= 767` 守卫。
- **移动端定位按钮**:`.topTools` 内 compass 后加同款 `.toolButton .locateButton`,移动端 40×40(继承 `.topTools>.toolButton`)+ `box-shadow:var(--shadow)`;桌面端 `@media (min-width:768px){ .topTools .locateButton{ display:none } }`(避免与右下角 `.mapControls` 定位按钮重复)。

**修改文件**:`server/src/components/map-shell.tsx`、`server/src/components/map-shell.module.css`

**测试验证**：typecheck 通过;`npm test` 全绿;文档 `tech/07` 抽屉/工具组/比例尺节同步。

## 2026-08-19: 移动端二级卡片交互(返回滚动保留 + 边缘点选取消)

### 问题1：详情返回后列表滚动位置重置

**症状**：移动端(≤767px frost 抽屉)选中一张二级卡片 → 进详情 → 返回列表后,列表滚回顶部,
刚选中的卡片滚出视野(蓝色选中态仍在,只是看不见)。

**根本原因**：`.drawerContent`(`map-shell.tsx`)是滚动容器(`overflow:auto`),但无 ref、无
scrollTop 保存/恢复。打开详情时 `detailPoi` 三元组让 `.drawerContent` + `POIList` 整体卸载,
返回时重挂载,`scrollTop` 归零。

**解决方案**：
- `.drawerContent` 挂 `ref={drawerContentRef}`(`useRef<HTMLDivElement>`),配 `drawerScrollRef`
  (`useRef(0)`)。
- 移动端卡片 onClick 链(`onSelect`)在 `setDetailPoi(poi)` 之前
  `drawerScrollRef.current = drawerContentRef.current?.scrollTop ?? 0`。
- 返回恢复用 `useLayoutEffect`(key 为 `detailPoi`):当其变为 `null` 且 ref 存在时
  `drawerContentRef.current.scrollTop = drawerScrollRef.current`。layout effect 在重挂载
  DOM 更新后、绘制前执行,保证容器已存在;任意 `detailPoi→null` 路径(抽屉把手 / `onBack` /
  手势下推)都覆盖。
- 清理时机:模式切换(`handleModeChange`)、新搜索(`openExploreSearch`)、刷新本处
  (`handleRefreshHere`)、桌面 `onOpenDetail` 都清零 `drawerScrollRef`,避免把旧视野的滚动
  带到新列表/移动端。

**修改文件**：
- `server/src/components/map-shell.tsx`

### 问题2：点卡片边缘空隙无法取消选中

**症状**：卡片显示蓝色已选态时,点卡片周围的空隙(卡片间 12px margin/列表空白)不会取消选中;
只有点地图才能取消(移动端抽屉盖住地图下半,点地图罕见)。

**解决方案**：
- `poi-list.tsx`:`POIList` 新增可选 prop `onDeselect?: () => void`;`.cardSlot` 与 `.list`
  容器都接 `onClick`(仅 `onDeselect` 传入时)。`.cardSlot` 的 onClick 带 `stopPropagation`
  避免与 `.list` 双重触发。`.list` 容器级 onClick 是为了兜住卡片间的 12px flex gap(该 gap
  实际属于 `.list`,不属于 `.cardSlot`)。
- `poi-card.tsx`:`<article>` onClick 加 `e.stopPropagation()`,点卡片自身不冒泡到 cardSlot/list
  触发取消,仍走原 select + 进详情逻辑。
- `map-shell.tsx`:移动端 `POIList` 传 `onDeselect={() => { setSelectedId(null);
  setHighlightedId(null); }}`(与桌面点地图取消口径 647-652 一致);桌面 `secondary-sidebar`
  不传,行为不变。

**修改文件**：
- `server/src/components/poi-list.tsx`
- `server/src/components/poi-card.tsx`
- `server/src/components/map-shell.tsx`
- `server/tests/component-contracts.test.mjs`

**测试验证**：
- ✅ 组件契约测试新增:POICard stopPropagation、POIList onDeselect 接线、map-shell
  drawerScroll 保存/恢复。
- ✅ 全量 `npm test` 297 通过 / 0 失败(2 跳过)。
- ✅ `npm run typecheck` 无错误。

### 注意：桌面 secondary-sidebar 行为不变

桌面 L2 复用同一个 `POIList`,但不传 `onDeselect`,`.list` / `.cardSlot` 的 onClick 均为
`undefined`,无取消选中交互;`stopPropagation` 只阻断卡片点击继续冒泡到容器,桌面无依赖
该冒泡的 handler,行为保持不变。

---

## 2026-08-19: 移动端微修(打开 profile 滚动重置 + 侧控栏搜索框失焦丢文本)

### 问题1:移动端打开 profile 继承列表滚动位置

**症状**:移动端滚过 POI 列表后点头像打开 account 面板,面板不是从顶部开始,而是停留在列表的滚动位置。

**根本原因**:抽屉滚动容器 `.drawerContent`(`map-shell.tsx:2394`)常驻挂载(`overflow:auto`),
`mobileSheet` 切换只换内容不卸载容器,`scrollTop` 被带到 account 面板;`openMobileAccount`
(`map-shell.tsx:1681-1694`)只设 `mobileSheet="account"` / `drawer="full"` / 清 detailPoi、
mobileJd,无滚动重置;全库无 `scrollTo(0)`。

**方案**:`openMobileAccount` 打开 account 分支末尾重置
`if (drawerContentRef.current) drawerContentRef.current.scrollTop = 0`。头像按钮只在
`!detailPoi` 分支渲染,不会与详情返回的 `useLayoutEffect` 滚动恢复(detailPoi→null)打架。

**修改文件**:`server/src/components/map-shell.tsx`(openMobileAccount,~1694)

### 问题2:展开侧控栏,搜索框有文本失焦后文本不可见

**症状**:侧控栏展开、搜索框有查询文本时点击别处(失焦),文本消失;重新聚焦又出现,状态并未丢失。

**根本原因**:CSS 可见性问题——`.searchBox input`(`map-shell.module.css:391-397`)
`opacity:0` + `position:absolute`,仅 `.searchBox:focus-within input`(:399-401)显示;fallback
标签「搜索」只在 `!query` 时渲染(`map-shell.tsx:1944`)。于是 有文本+失焦 → input 透明 且
label 不渲染 → 看起来文本消失。

**方案**:CSS-only 最小 diff——`.sidebarOpen .searchBox input:not(:placeholder-shown) {
opacity: 1 }`。`query` 非空时 placeholder 不占位(`:not(:placeholder-shown)` 命中),展开态
失焦也常显;折叠态不挂 `.sidebarOpen`,仍只显示图标;空查询仍走 label,行为不变。与既有
`.sidebarOpen .searchLabel` 规则同构。

**修改文件**:`server/src/components/map-shell.module.css`(`.searchBox` 区,~403)

**测试验证**:
- ✅ 组件契约测试新增:「mobile account open resets drawer scroll; expanded search keeps
  query text visible」(map-shell.tsx 重置断言 + CSS `:not(:placeholder-shown)` 断言)。
- ✅ 全量 `npm test` / `npm run typecheck` 通过。

## 2026-08-19: 比例尺控件崩溃(地图销毁后 resize 摸已销毁实例)

### 问题：控制台 `Cannot read properties of undefined (reading 'removeChild')` / `appendChild`

**症状**：组件卸载 / Next dev Fast Refresh 重挂载 / 路由重挂后,窗口 resize 偶发抛
`removeChild`/`appendChild` 错误,或地图区域出现**两个比例尺**。

**根本原因**：
- `handleResize`(map-shell.tsx ~630)在 resize 时 `map.removeControl(scaleControl)` +
  `map.addControl(...)`。window resize 监听在 `createMap` 里注册,但 `initMap` 调用
  `createMap(...)` **没有接收返回值**——cleanup(含 `removeEventListener('resize')`)成了
  孤儿永不执行。
- 地图销毁后,泄漏的 `handleResize` 仍引用已销毁的 map/容器 → 下一次 resize 摸到销毁
  实例 → removeChild/appendChild 崩溃。
- 附带竞态:`AMap.Scale` 插件回调若在 resize 之后完成,会**第二次 addControl**,产生两个
  比例尺。

**方案**：
- `initMap` 持有 `createMap` 返回的 cleanup(`mapCleanup = createMap(...)`);effect cleanup
  先 `mapCleanup?.()`(移除 resize/主题/鼠标监听)再 `map.destroy()`——顺序反了会在销毁
  实例上 removeEventListener。
- `handleResize` 加保护:`mapInstance.current` 为 null / `map.isDestroyed?.()` → 直接 return;
  `scaleControlRef.current` 未就绪(插件未加载完)由插件回调创建,不抢建。
- 双 addControl 竞态:统一 `addScaleControl()` 创建函数,插件回调里
  `if (scaleControlRef.current) return`;resize 先 remove 再置 null 再重建。

**修改文件**：`server/src/components/map-shell.tsx`(initMap ~485、Scale 区域 ~616-660、
effect cleanup ~692)

**测试验证**：组件契约测试新增 scale 静态断言(cleanup 接线 / 销毁保护 / 无双 addControl);
`npm test` 全绿;typecheck 通过。

---

## 2026-08-19: POI 停止加载/不新增(A/B/C/D)+ 加载更多按钮

### 症状

滚动到底后列表停在「── 没有更多结果 ──」不再新增;或一次瞬时网络/AMap 错误后哨兵
永久失效;或叠加模式切换缓存恢复后列表冻结;桌面探索侧栏无手动「加载更多」入口。

### 根本原因(A-D)

- **(A) 一次失败永久 noMore,无重试**:domain 路径错误静默 `return existing`、work 路径
  失败返回 `[]` → 主 load 的 `noMore = beforeLen>0 && data.length<=beforeLen` 置 true →
  `handleNeedMore` 在 `noMoreRef` 为 true 时硬返回。一次瞬时错误 = 哨兵永久失效。
- **(B) `loadingRef` 无限卡死,AMap 无超时**:`searchPOI` 只等 `complete`/`error` 事件,
  PlaceSearch 永远不回调(配额/脚本异常)时 `load()` 永久 await,后续一切加载被堵死。
- **(C) `skipFetch` 提前 return 吞掉待重放的视口刷新**:skipFetch 分支在 try/finally 之前
  return,视口刷新 pending 的重放逻辑被跳过 → 列表冻结到下一次地图移动。
- **(D) domain noMore 误判**:noMore 用**原始 catalog** 长度比较,可见列表是**过滤后**的
  memo;且 domain-local 带 common 过滤与 offset 上限 1000,DB 返回 0 新行时误判 noMore,
  即使视口内还有合法 POI。

### 方案

- **(A) 错误 ≠ 没有更多**:`poi-service.ts` 三条失败路径(domain 关键词/AMap 回退/本地库
  高德兜底)一律 `throw`,不再静默 `return existing`;`viewport-search.ts` non-ok 抛错
  (不再返回 `[]`);map-shell `load()` catch 置 `error` 态(不碰 `noMoreRef`),成功清 error;
  POIList footer 错误态显示「加载失败,点击重试」玻璃按钮(`onRetry` 清缓存 + refreshToken+1,
  同一 pageOffset 重拉,不跳过失败批次);哨兵在错误态不自动重发(等显式重试)。
- **(B) AMap 超时**:`amap-api.ts` 新增 `withTimeout` + `SEARCH_TIMEOUT_MS=15_000`,`searchPOI`
  的 promise 包超时,超时以 error 形态 settle → 走任务 A 的重试路径,绝不永久 await。
- **(C) skipFetch 不吞视口刷新**:skipFetch 提前 return 前,`viewportRefreshPendingRef` 已
  置位则直接 `viewportLoaderRef.current?.schedule()` 补跑。
- **(D) noMore 用服务端 total**:`fetchPOIsForMode` 返回 `{ pois, noMore? }`;domain-local
  用响应 `total` 判 `offset + rows.length >= total`(过滤导致可见列表不变不再误判);
  work 的 `/api/pois` 同样透出 `total`(`loadWorkViewport` 满页但已取完 → noMore,不白打
  后续页);无 total 的降级路径(高德回退/关键词)保持本地长度判断。
- **加载更多按钮**(桌面 secondary-sidebar resultHeader 右端,移动抽屉不加):蓝色文字按钮
  (12px 小字 `--blue-ink` `#0062CC`,玻璃底),`onLoadMore` → `handleNeedMore`(与滚动哨兵
  同一路径 pageOffset+1);noMore/atCap/空列表隐藏;loadingMore 禁用显示「加载中…」;
  错误态变「重试」(`onRetry`)。i18n 新键 `loadMore`/`loadingMore`/`retry`/`loadFailedRetry`。

**修改文件**：`server/src/components/map-shell.tsx`(load/skipFetch ~748-883、handleNeedMore
~1222、handleRetry ~1238、POIList/SecondarySidebar props 接线)、`server/src/components/
secondary-sidebar.tsx`(resultHeader ~437-457 + props)、`secondary-sidebar.module.css`、
`poi-list.tsx`(footer 错误重试 + 哨兵错误门控)、`poi-list.module.css`(`.retryBtn`)、
`server/src/lib/poi-service.ts`、`server/src/lib/viewport-search.ts`、`server/src/lib/
amap-api.ts`(withTimeout ~309-334)、`server/src/lib/i18n.ts`、`server/tests/poi-service
.test.mjs`(新)、`server/tests/viewport-search.test.mjs`、`server/tests/component-contracts
.test.mjs`。

**测试验证**：
- ✅ `poi-service.test.mjs`(新):withTimeout 超时 error settle、total 判 noMore(未到/到底)、
  本地库失败抛错。
- ✅ `viewport-search.test.mjs`:透出服务端 total、non-ok 抛错、total 判 noMore 不白打后续页、
  失败上抛不置 noMore。
- ✅ `component-contracts.test.mjs`:scale cleanup 静态断言 + resultHeader 加载更多按钮/
  错误重试/i18n 键断言。
- ✅ 全量 `npm test` 307 通过 / 0 失败(2 跳过);`npm run typecheck` 无错误。

---

## 相关文档

- 设计系统：`tech/07-frontend-design-system.md`
- 组件开发指南：`.claude/skills/frontend-component-dev/skill.md`
- 测试规范：`server/tests/component-contracts.test.mjs`
