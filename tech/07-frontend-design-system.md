# 前端设计系统

## 🎨 核心设计理念

> **Apple 风格 + 液态玻璃质感（卡片）+ 霜面面板 + 响应式移动端**

本项目前端设计遵循 Apple 设计语言,强调:
- **液态玻璃(Liquid Glass)**:只用在岗位/POI 卡片
- **霜面面板**: L2 Explore / L3 JD / Profile 用 `--soft-strong`
- **极简主义**:去除冗余元素,留白充足
- **响应式**:深色/浅色模式自动适应系统设置 + 移动端适配
- **原生感**:接近 macOS/iOS 原生 App 体验
- **不引组件库**: CSS Modules，不装 shadcn / Tailwind / framer / virtuoso / zustand

---

## 📚 技术栈与组件库

### UI 组件库

**Phase 2/4 已定：CSS Modules + 自写组件。不要引入下面这些库。**

1. **液态玻璃** — CSS 复现：`blur + saturate`、内高光、顶缘径向高光；hover 更透而不是更白。
   - **只用在岗位/POI 卡片、搜索框和列表 item hover**。二级 Explore / 三级 JD 面板外壳保持 `--soft-strong` 实底霜面，不要做成 22% 透板
   - 不引入 `liquid-glass-react` / displacement shader / 额外 WebGL

2. **不要 shadcn / Tailwind / Radix** — 筛选、登录、抽屉都是自写 CSS Modules。清单见 `tech/12-bundle-notes.md`。

3. **不要 Framer Motion** — 动画用 CSS `cubic-bezier(0.32, 0.72, 0, 1)`。

4. **不要 react-icons** — 图标是 `map-shell` 里的内联 SVG。

### 地图引擎

- **高德地图 JS API 2.0**（`loadAMap`，不进 npm）
- Mapbox 等备选等 ADR，不要在本阶段加第二套引擎。

---

## 🗺️ 地图布局设计

### 参考:Apple 地图

**设计参考**:[https://maps.apple.com.cn/](https://maps.apple.com.cn/)

### 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  [侧边栏]                 地图区域(100vh 全屏)             │
│  折叠状态                                    [指南针]      │
│  (60px)                                      [底图]       │
│                                                           │
│                                                           │
│                                                           │
│                                                           │
│                                                           │
│                                                           │
│                                                  [缩放]    │
│                                                  [定位]    │
│  [用户]                                      [比例尺]     │
└─────────────────────────────────────────────────────────┘

展开状态（从折叠轨道长出，不插入品牌字标）:
┌─────────────────────────────────────────────────────────┐
│  [侧边栏 - 276px]        地图区域                          │
│  ┌────────────┐                              [指南针]      │
│  │ ☰          │                              [底图]       │
│  │ 🔍 搜索框  │  ← 折叠搜索图标点击后展开并聚焦           │
│  │ 图层/收藏  │                                           │
│  │ 探索/最近  │                                           │
│  │            │  ← Profile 在底部，无 Settings 行         │
│  │            │                                           │
│  │            │                                  [缩放]    │
│  │            │                                  [定位]    │
│  │ [用户头像] │                              [比例尺]     │
│  └────────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

### 组件定位与样式

#### 响应式布局策略

**断点定义**:
- 桌面端(Desktop): `≥768px`
- 移动端(Mobile): `<768px`

**布局切换**:
- **桌面端**: 左侧边栏 + 全屏地图
- **移动端**: 底部抽屉 + 全屏地图(参考 Apple Maps)

---

#### 1. 左侧侧边栏(桌面端 ≥768px)

**位置**:
- 左上角固定
- 距离页边:`top: 12px; left: 12px; bottom: 12px`
- 宽度:
  - 折叠状态:`60px`
  - 展开状态:`280px`

**样式**(液态玻璃):
```css
{
  background: rgba(255, 255, 255, 0.7); /* 浅色模式 */
  backdrop-filter: blur(20px) saturate(180%);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  background: rgba(30, 30, 30, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
```

**内容结构**(展开状态):
```
┌──────────────────┐
│   [搜索框]       │  ← 顶部固定
├──────────────────┤
│  🏢 最近大厂     │  ← 可滚动区域
│  ⭐ 我的收藏     │
│  🧩 插件管理     │
│  📍 历史记录     │
│  ⚙️ 设置         │
│                  │
│  (滚动内容)      │
│                  │
├──────────────────┤
│  [👤 用户头像]   │  ← 底部固定
└──────────────────┘
```

**折叠/展开交互**:
- 折叠状态:仅显示图标(垂直排列)+ 底部用户头像
- 展开:点击任意图标或用户头像
- 收起:点击侧边栏外的地图区域
- 动画:`transition: width 0.3s ease-in-out`

---

#### 2. 底部抽屉(移动端 <768px)

**参考**: [Apple Maps 移动端](https://maps.apple.com.cn/)

**三态设计**:

**状态 1: 最小化(默认)**
- 位置:`bottom: 0`,固定底部
- 高度:`~80px`
- 内容:仅显示搜索框
- 样式:液态玻璃,顶部圆角(`border-radius: 16px 16px 0 0`)
- 拖动把手:顶部中央灰色横条

```
┌─────────────────────────────────┐
│         ▬▬▬ (拖动把手)          │  ← 顶部圆角
│  🔍  搜索地点或地址             │
└─────────────────────────────────┘
```

**状态 2: 半展开(中间态)**
- 位置:`bottom: 0`
- 高度:`~40vh` (视口高度的 40%)
- 内容:搜索框 + 快捷入口("搜索附近"分类卡片)
- 拖动行为:
  - 向上滑动 > 阈值(30%) → 自动吸附到**全展开**
  - 向下滑动 > 阈值(30%) → 自动吸附到**最小化**
  - 释放时若未达阈值 → 回弹到当前状态
- 过渡动画：使用 `transform` 在稳定容器上实现 350ms `cubic-bezier(0.4, 0, 0.2, 1)` 吸附，避免持续动画 `height`。

```
┌─────────────────────────────────┐
│         ▬▬▬ (拖动把手)          │
│  🔍  搜索地点或地址             │
├─────────────────────────────────┤
│                                 │
│  搜索附近                       │
│  ┌────────┐  ┌────────┐        │
│  │ 🏢 大厂 │  │ 🍜 美食 │        │
│  └────────┘  └────────┘        │
│  ┌────────┐  ┌────────┐        │
│  │ 🏠 租房 │  │ ☕ 咖啡 │        │
│  └────────┘  └────────┘        │
│                                 │
└─────────────────────────────────┘
```

**状态 3: 全展开**
- 位置:`bottom: 0`
- 高度:`~85vh` (留出顶部空隙显示地图)
- 内容:搜索框 + 完整列表(大厂/收藏/插件/历史/设置)+ 用户头像(底部)
- 与顶部边距:`~8vh` (约等于状态栏高度 + 安全区域)
- 滚动:内容区域可滚动,搜索框和用户头像固定

```
┌─────────────────────────────────┐
│         ▬▬▬ (拖动把手)          │  ← 与顶部留空隙
│  🔍  搜索地点或地址             │  ← 固定
├─────────────────────────────────┤
│  🏢 最近大厂                     │  ← 可滚动区域开始
│  ⭐ 我的收藏                     │
│  🧩 插件管理                     │
│  📍 历史记录                     │
│  ⚙️ 设置                         │
│                                 │
│  (更多滚动内容...)              │
│                                 │
├─────────────────────────────────┤
│  👤 用户信息                     │  ← 固定底部
└─────────────────────────────────┘
```

**抽屉交互细节（live,WS-U5 跟手动画）**:

1. **拖动手势（跟手）**:
   - 监听 grabber 的 `pointerdown/move/up`(pointer capture 全程跟踪),`touch-action: none` 只加在 grabber,不加在列表。
   - 拖拽中直接写 `.mobileDrawer` 的 inline `height`(px),并挂 `.drawerDragging` class 禁用 `transition`——不做缓动,手指到哪抽屉到哪;越界由 CSS `min/max-height` 钳制。
   - 内容可见性随手指越过档位切换(越过 mini↔half 即显示 toolbar/content)。

2. **松手判定(位置 + 速度)**:
   - 速度 EMA 由 pointermove 采样(px/s),阈值 `DRAWER_FLING_V = 900px/s`。
   - 向上快滑(vel < −900)→ `full`;向下快滑(vel > +900)→ `mini`;慢拖 → 按当前位置就近三态(中点分段)。
   - 内容栈优先:详情/JD 打开时,下拉过半(或快滑)→ 收内容(关 JD→`full` / 关详情→`half`),否则回弹 `full`;非 explore 子页快下拉 → 回 explore。
   - 点按(位移 ≤ 8px)保留 onClick 的 cycle/内容弹出逻辑,拖动后抑制 click。

3. **吸附动画参数**:
   - 缓动:`cubic-bezier(0.32, 0.72, 0, 1)`,时长 `0.32s`,作用于 `height`。
   - 手势结束后 rAF 清空 inline height,交给 CSS class(svh)过渡从手指位置平滑收尾。
   - `prefers-reduced-motion: reduce` → `transition: none`,瞬时吸附。

**样式**(液态玻璃):
```css
{
  background: rgba(255, 255, 255, 0.85); /* 浅色模式,移动端更不透明 */
  backdrop-filter: blur(30px) saturate(200%);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  border-top: 1px solid rgba(255, 255, 255, 0.5);
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  background: rgba(20, 20, 20, 0.85);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}
```

**拖动把手（live）**:

- Sheet: mini `96px` / half `42svh` / full `86svh`, frost `--soft-strong`.
- Grabber pill: mini `42×4`, half/full `64×6`.
- Shared gap token `--drawer-handle-gap: 8px` on `.mobileDrawer` — handle `padding-bottom` is the same in domain and work. Do not let work chips or `.drawerContent` top padding change handle↔toolbar / handle↔search.
- Swipe: 位移 ≤ 8px 视为点按(cycle),超过即拖拽并抑制 click。`touch-action: none` on the grabber, not the list.

---

#### 3. 右上角工具组(桌面端 + 移动端)

**指南针**:
- 位置:`top: 12px; right: 12px`
- 尺寸:`48×48px`
- 样式:液态玻璃圆形
- 功能:点击恢复正北方向

**底图选择器**:
- 初始状态:小 Logo(高德/Mapbox),位置:`top: 12px; right: 72px`
- 点击后:展开卡片显示底图选项(标准/卫星/路况/地形)
- 卡片位置:Logo 左侧临近展开
- 尺寸:Logo `32×32px`,卡片 `160×200px`

#### 4. 右下角工具组(桌面端 + 移动端)

**缩放按钮**:
- 位置:`bottom: 80px; right: 12px`
- 尺寸:`48×48px`(上下堆叠)
- 样式:液态玻璃圆形
- 内容:`+` / `-`

**定位按钮**:
- 位置:`bottom: 24px; right: 12px`
- 尺寸:`48×48px`
- 样式:液态玻璃圆形
- 功能:获取用户位置并居中

#### 5. 比例尺(展示性,桌面端 + 移动端)

**位置**:`bottom: 24px; left: 侧边栏宽度 + 24px`
**样式**:
- 不显眼,半透明
- 文字:`12px, rgba(0,0,0,0.4)` / `rgba(255,255,255,0.4)`
- 无背景(或极淡背景)
- 高度:`20px`

---

## 🎨 颜色系统

### Apple 风格色板

**浅色模式**(Light Mode):
```css
--background: rgba(255, 255, 255, 1);
--foreground: rgba(0, 0, 0, 0.88);

--primary: rgba(0, 122, 255, 1);        /* Apple Blue */
--secondary: rgba(142, 142, 147, 1);    /* Apple Gray */
--accent: rgba(255, 149, 0, 1);         /* Apple Orange */

--success: rgba(52, 199, 89, 1);        /* Apple Green */
--warning: rgba(255, 204, 0, 1);        /* Apple Yellow */
--danger: rgba(255, 59, 48, 1);         /* Apple Red */

--glass-bg: rgba(255, 255, 255, 0.7);
--glass-border: rgba(0, 0, 0, 0.1);
--glass-shadow: rgba(0, 0, 0, 0.08);
```

**深色模式**(Dark Mode):
```css
--background: rgba(0, 0, 0, 1);
--foreground: rgba(255, 255, 255, 0.92);

--primary: rgba(10, 132, 255, 1);       /* Apple Blue (darker) */
--secondary: rgba(142, 142, 147, 1);    /* Apple Gray */
--accent: rgba(255, 159, 10, 1);        /* Apple Orange (darker) */

--success: rgba(48, 209, 88, 1);        /* Apple Green (darker) */
--warning: rgba(255, 214, 10, 1);       /* Apple Yellow (darker) */
--danger: rgba(255, 69, 58, 1);         /* Apple Red (darker) */

--glass-bg: rgba(30, 30, 30, 0.7);
--glass-border: rgba(255, 255, 255, 0.1);
--glass-shadow: rgba(0, 0, 0, 0.3);
```

### 地图 POI 标记色

```css
--poi-recruitment: rgba(0, 122, 255, 1);   /* 招聘(蓝色) */
--poi-housing: rgba(52, 199, 89, 1);       /* 租房(绿色) */
--poi-university: rgba(175, 82, 222, 1);   /* 院校(紫色) */
--poi-highlight: rgba(255, 149, 0, 1);     /* 推荐(橙色) */
```

---

## 🔤 字体系统

### 字体族

**Apple 原生字体栈**:
```css
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 
             'Helvetica Neue', 'Noto Sans SC', sans-serif;
```

**等宽字体**(代码/数据):
```css
font-family: 'SF Mono', 'Monaco', 'Menlo', 
             'Courier New', monospace;
```

### 字号层级

| 用途 | 字号 | 行高 | 粗细 |
|---|---|---|---|
| 大标题(H1) | 32px | 1.2 | 700 |
| 中标题(H2) | 24px | 1.3 | 600 |
| 小标题(H3) | 20px | 1.4 | 600 |
| 正文(Body) | 16px | 1.5 | 400 |
| 说明(Caption) | 14px | 1.4 | 400 |
| 标签(Label) | 12px | 1.3 | 500 |

---

## 🧩 组件规范

### 1. 液态玻璃卡片(Liquid Glass Card)

**候选实现（必须先审查实际版本源码/API；不是无条件依赖）**:
```tsx
import { GlassCard } from 'liquid-glass-react';

<GlassCard
  blur={20}
  opacity={0.7}
  borderRadius={16}
  padding={16}
>
  <h3>公司名称</h3>
  <p>招聘信息...</p>
</GlassCard>
```

**样式参数**:
- `blur`: 毛玻璃模糊度(20px)
- `opacity`: 背景透明度(0.7)
- `borderRadius`: 圆角(12-16px)
- 阴影:`0 8px 32px rgba(0, 0, 0, 0.08)`

### 2. 按钮(Button)

**候选实现（必须先审查实际版本源码/API）**:
```bash
npx shadcn-ui@latest add button
```

**变体**:
- `primary`: 填充色按钮(主要动作)
- `secondary`: 轮廓按钮(次要动作)
- `ghost`: 透明按钮(辅助功能)

**Apple 风格定制**:
```css
.btn-primary {
  background: rgba(0, 122, 255, 1);
  color: white;
  border-radius: 12px;
  padding: 10px 20px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: rgba(0, 112, 245, 1);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 122, 255, 0.3);
}
```

### 3. 输入框(Input)

**候选实现（必须先审查实际版本源码/API）**:
```bash
npx shadcn-ui@latest add input
```

**Apple 风格定制**:
```css
.input {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 16px;
  transition: all 0.2s ease;
}

.input:focus {
  border-color: rgba(0, 122, 255, 1);
  box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
  outline: none;
}
```

### 4. 标签(Tag/Badge)

**候选实现（必须先审查实际版本源码/API）**:
```bash
npx shadcn-ui@latest add badge
```

**Apple 风格定制**:
```css
.tag {
  background: rgba(0, 122, 255, 0.1);
  color: rgba(0, 122, 255, 1);
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
}
```

### 5. POI 标记(Map Marker)

**自定义图标组件**:
```tsx
<MapMarker
  type="recruitment" // recruitment | housing | university
  highlighted={false}
  icon={<BuildingIcon />}
>
  <GlassCard>
    <CompanyInfo />
  </GlassCard>
</MapMarker>
```

**样式**:
- 默认:圆形图标(32×32px)+ 领域颜色
- 高亮:放大 1.2x + 橙色外圈 + 脉冲动画
- 点击:展开详情卡片(液态玻璃)

---

## 🎭 动画与交互

### 动画原则

遵循 Apple Human Interface Guidelines:
- **快速**:动画时长 200-300ms
- **自然**:使用缓动函数 `ease-in-out`
- **有目的**:动画服务于理解,不是炫技

### 常见动画

**1. 侧边栏折叠/展开**:
```tsx
<motion.div
  initial={{ width: 60 }}
  animate={{ width: isOpen ? 280 : 60 }}
  transition={{ duration: 0.3, ease: 'easeInOut' }}
>
  {/* 侧边栏内容 */}
</motion.div>
```

**2. 卡片悬停**:
```tsx
<motion.div
  whileHover={{ y: -4, scale: 1.02 }}
  transition={{ duration: 0.2 }}
>
  <GlassCard />
</motion.div>
```

**3. 移动端抽屉滑动**:
```tsx
<motion.div
  drag="y"
  dragConstraints={{ top: 0, bottom: 0 }}
  dragElastic={0.1}
  onDragEnd={(event, info) => {
    const velocity = info.velocity.y;
    const offset = info.offset.y;
    
    // 向上滑动且达到阈值 → 展开
    if (offset < -50 || velocity < -500) {
      expandDrawer();
    }
    // 向下滑动且达到阈值 → 收起
    else if (offset > 50 || velocity > 500) {
      collapseDrawer();
    }
    // 否则回弹
    else {
      snapBack();
    }
  }}
  animate={{ height: drawerHeight }}
  transition={{ 
    type: 'spring',
    stiffness: 300,
    damping: 30,
    duration: 0.35
  }}
>
  {/* 抽屉内容 */}
</motion.div>
```

**4. POI 标记点击**:
```css
.card {
  transition: all 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}
```

**3. 地图飞行**:
```tsx
map.flyTo({
  center: [lng, lat],
  zoom: 15,
  duration: 1500,
  essential: true
});
```

**4. POI 脉冲高亮**:
```css
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
}

.marker-highlight {
  animation: pulse 1.5s ease-in-out infinite;
}
```

---

## 📱 响应式设计

### 断点

| 断点 | 尺寸 | 设备 |
|---|---|---|
| `sm` | 640px | 手机(竖屏) |
| `md` | 768px | 平板(竖屏) |
| `lg` | 1024px | 平板(横屏) |
| `xl` | 1280px | 桌面 |
| `2xl` | 1536px | 大屏桌面 |

### 布局响应式

**桌面端(`≥768px`)**:
- 左侧边栏:常驻且默认折叠(60px),可展开至 280px
- 用户头像:侧边栏底部
- 地图:占据剩余空间
- 地图工具:右上角(指南针+底图)+ 右下角(缩放+定位)

**移动端(`<768px`)**:
- 底部抽屉:三态(最小化 80px → 半展开 40vh → 全展开 85vh)
- 用户头像:抽屉底部(全展开状态可见)
- 地图:全屏(100vh)
- 地图工具:保持右上/右下,但尺寸缩小(40×40px)

**响应式代码示例**:
```tsx
// 侦测屏幕宽度
const isMobile = useMediaQuery('(max-width: 767px)');

return (
  <>
    {isMobile ? (
      <BottomDrawer /> // 移动端抽屉
    ) : (
      <Sidebar /> // 桌面端侧边栏
    )}
    <MapContainer />
  </>
);
```

---

## 🖼️ 布局审查流程

### ⚠️ 前端开发铁律

> **任何前端代码编写之前,必须先创建文字符号图片让用户审查整体布局**

这条规则适用于:
- ✅ 新页面开发
- ✅ 新组件开发
- ✅ 布局调整
- ✅ 交互流程变更

### 工作流程

#### 1. 创建文字符号图片(AI Agent)

当接到前端开发任务时:

```markdown
**任务**: 实现招聘地图主界面

**步骤**:
1. ❌ 不要直接写代码!
2. ✅ 使用 ASCII 艺术或简单文字符号创建布局示意图
3. ✅ 标注关键尺寸、颜色、交互
4. ✅ 通知用户:"布局示意图已创建,请审查"
5. ⏸️ 暂停,等待用户反馈
```

**示例布局示意图**(桌面端):
```
┌────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────┐                                        [指]  [图]  │ ← 12px 边距
│  │     │                                                     │
│  │ [搜]│                 地图区域(100vh)                     │
│  │     │                                                     │
│  │ 🏢  │                 (高德地图 JS API)                   │
│  │ ⭐  │                                                     │
│  │ 🧩  │                                                     │
│  │     │                                                     │
│  │     │                                         [+]         │
│  │     │                                         [-]         │
│  │ [👤]│                                         [📍]        │
│  └─────┘                                     [——— 100m]     │
│  60px折叠                                                    │
│  280px展开                                                   │
└────────────────────────────────────────────────────────────┘

组件说明:
- 侧边栏:液态玻璃,16px 圆角,12px 边距
- 指南针[指]:48×48px 圆形,右上角
- 底图切换[图]:32×32px,点击展开卡片
- 缩放按钮[+][-]:48×48px 圆形,堆叠
- 定位按钮[📍]:48×48px 圆形
- 比例尺[——— 100m]:半透明,不显眼

颜色:
- 侧边栏背景:rgba(255,255,255,0.7) + blur(20px)
- 按钮背景:同上
- 主色调:Apple Blue #007AFF

交互:
- 点击侧边栏任意图标 → 展开到 280px
- 点击地图区域 → 收起到 60px
- 点击底图 Logo → 展开底图选择卡片
```

**示例布局示意图**(移动端):
```
状态 1: 最小化 (默认)
┌──────────────────────────┐
│                          │
│      地图区域(100vh)      │
│                          │
│   [指]              [图] │ ← 右上角工具
│                          │
│                          │
│                          │
│                    [+]   │
│                    [-]   │
│                    [📍]  │ ← 右下角工具
├──────────────────────────┤
│     ▬▬▬ (拖动把手)       │ ← 顶部圆角,液态玻璃
│  🔍 搜索地点或地址       │ 
└──────────────────────────┘
    ↑ 高度 ~80px

状态 2: 半展开 (40vh)
┌──────────────────────────┐
│      地图区域             │
│   [指]              [图] │
│                          │
│                    [+]   │
│                    [-]   │
│                    [📍]  │
├──────────────────────────┤
│     ▬▬▬ (拖动把手)       │
│  🔍 搜索地点或地址       │
├──────────────────────────┤
│  搜索附近                │
│  ┌──────┐  ┌──────┐    │
│  │🏢大厂│  │🍜美食│    │
│  └──────┘  └──────┘    │
│  ┌──────┐  ┌──────┐    │
│  │🏠租房│  │☕咖啡│    │
│  └──────┘  └──────┘    │
└──────────────────────────┘
    ↑ 高度 ~40vh
    
    拖动阈值: 30% 距离或快速滑动 → 自动吸附

状态 3: 全展开 (85vh)
┌──────────────────────────┐
│   地图区域(留出顶部空隙)  │ ← ~8vh 顶部边距
├──────────────────────────┤
│     ▬▬▬ (拖动把手)       │
│  🔍 搜索地点或地址       │ ← 固定
├──────────────────────────┤
│  🏢 最近大厂             │ ← 可滚动区域
│  ⭐ 我的收藏             │
│  🧩 插件管理             │
│  📍 历史记录             │
│  ⚙️ 设置                 │
│                          │
│  (更多内容...)          │
│                          │
├──────────────────────────┤
│  👤 用户信息             │ ← 固定底部
└──────────────────────────┘
    ↑ 高度 ~85vh

拖动逻辑:
- 向上滑距离 ≥ 48px 或速度 ≥ 500px/s → 吸附到更高状态
- 向下滑距离 ≥ 48px 或速度 ≥ 500px/s → 吸附到更低状态
- 未达阈值 → 回弹到当前状态
- 动画: cubic-bezier(0.4, 0, 0.2, 1), 350ms
```

#### 2. 用户审查与反馈

用户会进行以下操作之一:
- ✅ **批准**:"布局看起来不错,可以开始编码"
- 🔄 **要求修改**:"侧边栏太宽了,改成 240px"
- ❌ **拒绝**:"这个布局不对,重新设计"

#### 3. 迭代调整(如需要)

如果用户要求修改:
1. 根据反馈调整文字符号图片
2. 再次通知用户审查
3. 重复直到批准

#### 4. 获得批准后开始编码

用户明确批准后:
```markdown
用户: "批准了,可以开始写代码"

AI Agent 行动:
1. ✅ 记录批准时间到实施文档
2. ✅ 按照布局示意图编写代码
3. ✅ 使用 liquid-glass-react + shadcn/ui 组件
4. ✅ 参考 Apple Maps 风格
5. ✅ 完成后截图对比:代码实现 vs 布局示意图
```

#### 5. 文档记录

每个 Phase 的实施文档需要包含:

```markdown
## UI/UX 设计

### 布局示意图
[ASCII 艺术图片]

### 审查记录
- **创建时间**: 2026-08-16 10:00
- **审查状态**: ✅ 已批准(2026-08-16 14:00)
- **批准者**: 用户
- **修改历史**:
  - v1: 初始版本(侧边栏 320px)
  - v2: 调整侧边栏宽度为 280px
  - v3: ✅ 最终批准版本

### 设计说明
- 采用 Apple Maps 风格布局
- 液态玻璃组件(liquid-glass-react)
- 深色/浅色模式自动适应系统设置
- 响应式:桌面默认折叠,移动端抽屉式
```

---

## 📋 开发检查清单

### 开发前检查

- [ ] 我创建了文字符号布局图吗?
- [ ] 布局图是否包含所有页面/组件/尺寸/交互?
- [ ] 我已通知用户审查了吗?
- [ ] 用户明确批准了吗?
- [ ] 布局图已记录到实施文档中了吗?

如果任何一项为"否",**不要写代码**。

### 编码中检查

- [ ] 我使用了 `liquid-glass-react` 组件库吗?
- [ ] 我使用了 `shadcn/ui` 而不是从零造轮子吗?
- [ ] 颜色/字体/间距/圆角是否遵循 Apple 风格?
- [ ] 深色/浅色模式是否都测试了?
- [ ] 动画是否流畅自然(200-300ms)?
- [ ] 是否参考了 Apple Maps 布局?

### 完成后检查

- [ ] 截图对比:代码实现 vs 布局示意图
- [ ] 所有页面/组件都截图了吗?
- [ ] 发现任何不一致之处了吗?→ 修复后再提交
- [ ] 布局图 + 对比截图已附加到 PR 中了吗?
- [ ] 深色/浅色模式都截图验证了吗?

---

## ♿ 可访问性、兼容性与性能验收

- 目标为 WCAG 2.2 AA：所有文本、图标、焦点环在浅色/深色和代表性地图背景上满足对比度要求。
- 抽屉使用可命名的 landmark/dialog 语义，具备 `aria-expanded`、`aria-controls`、Escape 关闭、焦点移入/恢复、键盘方向键/Home/End 状态切换和状态播报。拖动把手必须是最小 44×44px 的可操作控件。
- 使用 `env(safe-area-inset-top/bottom)` 与 `100dvh`；工具组的 bottom 偏移必须加上当前抽屉高度和安全区，不能被抽屉遮挡。
- 支持 `prefers-reduced-motion`：关闭非必要动画。`backdrop-filter` 不可用时使用不透明 token；支持 `forced-colors: active`。
- 拖动优先使用 transform/稳定容器，避免持续动画 height 造成重排；只在手势期间设置 will-change。目标设备上保持接近 60fps，并记录截图和性能证据。
- 地图必须有列表/文本替代视图、加载/空/错误状态和键盘可达路径。

## 🎯 总结

**核心原则**:
1. **Apple 风格为王**:参考 [Apple Maps](https://maps.apple.com.cn/)
2. **液态玻璃质感**:使用 [liquid-glass-react](https://github.com/rdev/liquid-glass-react)
3. **复用组件**:优先 shadcn/ui,不重复造轮子
4. **系统适配**:深色/浅色模式自动切换
5. **布局先行**:文字符号图片审查通过后再编码

**记住**:
> 💡 布局图 5 分钟,编码 2 小时。方向错了,布局图白画 5 分钟;代码白写 2 小时。
> 
> 所以:**先布局图,后代码**。永远。

---

**参考资源**:
- Apple Maps:[https://maps.apple.com.cn/](https://maps.apple.com.cn/)
- liquid-glass-react:[https://github.com/rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)
- shadcn/ui:[https://ui.shadcn.com/](https://ui.shadcn.com/)
- Apple Human Interface Guidelines:[https://developer.apple.com/design/human-interface-guidelines/](https://developer.apple.com/design/human-interface-guidelines/)
