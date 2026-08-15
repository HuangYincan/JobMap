# 前端设计系统

## 🎨 核心设计理念

> **Apple 风格 + 液态玻璃质感 + 现代化组件库**

本项目前端设计遵循 Apple 设计语言,强调:
- **液态玻璃(Liquid Glass)**:半透明、毛玻璃、流动感
- **极简主义**:去除冗余元素,留白充足
- **响应式**:深色/浅色模式自动适应系统设置
- **原生感**:接近 macOS/iOS 原生 App 体验
- **复用优先**:使用现代化组件库,避免重复造轮子

---

## 📚 技术栈与组件库

### UI 组件库

**优先使用现代化组件库,避免从零造轮子**:

1. **[liquid-glass-react](https://github.com/rdev/liquid-glass-react)** - 液态玻璃组件(核心)
   - 提供卡片、面板、按钮等液态玻璃风格组件
   - 自动适配深色/浅色模式
   - 使用:`npm install liquid-glass-react`

2. **[shadcn/ui](https://ui.shadcn.com/)** - 可定制的 React 组件
   - 输入框、下拉框、对话框、表单等
   - 基于 Radix UI + Tailwind CSS
   - 使用:`npx shadcn-ui@latest add <component>`

3. **[Framer Motion](https://www.framer.com/motion/)** - 动画库
   - 页面过渡、悬停效果、手势交互
   - 使用:`npm install framer-motion`

4. **[React Icons](https://react-icons.github.io/react-icons/)** - 图标库
   - 集成 SF Symbols 风格图标
   - 使用:`npm install react-icons`

### 地图引擎

- **高德地图 JS API 2.0**(国内):[https://lbs.amap.com/api/javascript-api-v2/summary](https://lbs.amap.com/api/javascript-api-v2/summary)
- **Mapbox GL JS**(国外备选):[https://docs.mapbox.com/mapbox-gl-js/](https://docs.mapbox.com/mapbox-gl-js/)

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

展开状态:
┌─────────────────────────────────────────────────────────┐
│  [侧边栏 - 280px]        地图区域                          │
│  ┌────────────┐                              [指南针]      │
│  │  搜索框    │                              [底图]       │
│  ├────────────┤                                          │
│  │ 最近大厂   │                                           │
│  │ 我的收藏   │                                           │
│  │ 插件管理   │                                           │
│  │ ...        │                                           │
│  │            │                                           │
│  │            │                                  [缩放]    │
│  │            │                                  [定位]    │
│  │ [用户头像] │                              [比例尺]     │
│  └────────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

### 组件定位与样式

#### 1. 左侧侧边栏(常驻)

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

#### 2. 右上角工具组

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

#### 3. 右下角工具组

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

#### 4. 比例尺(展示性)

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

**使用 `liquid-glass-react`**:
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

**使用 `shadcn/ui`**:
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

**使用 `shadcn/ui`**:
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

**使用 `shadcn/ui`**:
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

### 侧边栏响应式

- **桌面(`>= 1024px`)**:默认展开,可折叠
- **平板(`768px - 1023px`)**:默认折叠,点击展开
- **手机(`< 768px`)**:抽屉式,从左侧滑出

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

**示例布局示意图**:
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
- 响应式:桌面默认展开,移动端抽屉式
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
