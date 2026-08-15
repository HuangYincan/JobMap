# 二级侧控栏设计规范

**文档版本:** 1.0  
**创建日期:** 2026-08-15  
**状态:** 设计阶段  
**设计语言:** Apple Maps 风格

---

## 设计理念

### 核心原则

**"优雅、简洁、信息清晰"**

参考 Apple 地图的二级侧控栏设计，使用：
- **液态玻璃卡片** (Glassmorphism) - 透明、模糊、层次感
- **信息分层** - 列表视图（简洁）→ 详情视图（完整）
- **流畅动画** - 展开、收起、切换的平滑过渡
- **响应式布局** - 桌面侧栏、移动端全屏

---

## 布局结构

### 桌面端布局

```
┌─────────────────────────────────────────────────┐
│  [← 返回]  搜索结果 (23个)          [筛选] [排序] │  ← 顶栏
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 🏢 阿里巴巴                                 │ │
│  │ 互联网 · 杭州市                             │ │
│  │ ⭐ 4.2 · 在招 12 个岗位                    │ │  ← 卡片 1（简洁视图）
│  │ [图片][图片][图片]                          │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 🏢 字节跳动                                 │ │
│  │ 互联网 · 杭州市                             │ │  ← 卡片 2
│  │ ⭐ 4.5 · 在招 8 个岗位                     │ │
│  │ [图片][图片][图片]                          │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ 🏢 网易                                     │ │  ← 卡片 3
│  │ ...                                        │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  [加载更多...]                                  │  ← 底部
└─────────────────────────────────────────────────┘
```

**尺寸规范:**
- 侧控栏宽度: 420px (可调整 360-480px)
- 卡片高度: 自适应内容，最小 120px
- 卡片间距: 12px
- 内边距: 16px
- 圆角: 16px

### 移动端布局

```
┌─────────────────────┐
│  [← 返回]  搜索结果  │  ← 固定顶栏
├─────────────────────┤
│                     │
│  [筛选] [排序]      │  ← 筛选栏（sticky）
│                     │
├─────────────────────┤
│                     │
│  ┌───────────────┐  │
│  │ 🏢 阿里巴巴    │  │
│  │ 互联网·杭州    │  │  ← 卡片（全宽）
│  │ ⭐ 4.2 · 12岗 │  │
│  │ [图][图][图]   │  │
│  └───────────────┘  │
│                     │
│  ┌───────────────┐  │
│  │ 🏢 字节跳动    │  │
│  │ ...           │  │
│  └───────────────┘  │
│                     │
│  ... (向下滚动)     │
│                     │
└─────────────────────┘
```

**移动端特点:**
- 全屏展示（覆盖地图）
- 向下滑动加载更多
- 点击卡片 → 展开详情页
- 向下拉 → 最小化到底部抽屉

---

## 卡片设计

### 液态玻璃效果 (Glassmorphism)

```css
.poi-card {
  /* 半透明背景 */
  background: rgba(255, 255, 255, 0.72);
  
  /* 模糊效果 */
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
  
  /* 边框 */
  border: 1px solid rgba(255, 255, 255, 0.72);
  
  /* 圆角 */
  border-radius: 16px;
  
  /* 阴影 */
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.06);
  
  /* 过渡动画 */
  transition: all 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}

/* Hover 状态 */
.poi-card:hover {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 
    0 4px 16px rgba(0, 0, 0, 0.12),
    0 2px 4px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

/* Active 状态 */
.poi-card:active {
  transform: translateY(0);
  box-shadow: 
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.06);
}

/* 暗黑模式 */
@media (prefers-color-scheme: dark) {
  .poi-card {
    background: rgba(28, 28, 30, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
}
```

### 卡片结构（列表视图）

```tsx
<Card className="poi-card">
  {/* 头部 */}
  <CardHeader>
    <Icon src={poi.logo} />
    <div>
      <Title>{poi.name}</Title>
      <Subtitle>{poi.category} · {poi.location}</Subtitle>
    </div>
    <Badge color={poi.status}>{poi.statusText}</Badge>
  </CardHeader>
  
  {/* 关键信息 */}
  <CardMeta>
    <Rating>⭐ {poi.rating}</Rating>
    <Divider />
    <Highlight>{poi.highlight}</Highlight>
  </CardMeta>
  
  {/* 图片预览（可选）*/}
  <CardImages>
    <Image src={poi.images[0]} />
    <Image src={poi.images[1]} />
    <Image src={poi.images[2]} />
  </CardImages>
  
  {/* 快速操作（可选）*/}
  <CardActions>
    <Button variant="primary">导航</Button>
    <Button variant="secondary">收藏</Button>
  </CardActions>
</Card>
```

### 信息层级

#### 一级信息（列表视图，必须展示）
- POI 名称（大标题）
- 分类标签（副标题）
- 关键指标（评分、距离）
- 状态标识（营业中、在招、已截止）

#### 二级信息（列表视图，可选展示）
- 简短描述（1-2 句话）
- 图片预览（2-3 张）
- 快速操作按钮

#### 三级信息（详情视图，完整展示）
- 详细介绍
- 完整图片集
- 用户评价
- 详细数据（岗位列表、专业列表等）

---

## 详情视图

### 展开方式

**桌面端:**
- 点击卡片 → 侧控栏宽度扩展到 640px
- 动画: 300ms cubic-bezier ease-out
- 详情页覆盖列表视图（可返回）

**移动端:**
- 点击卡片 → 全屏详情页从右侧滑入
- 动画: iOS 风格右滑进入
- 支持手势返回

### 详情页结构

```
┌─────────────────────────────────────────┐
│  [← 返回列表]                    [收藏] │  ← 顶栏
├─────────────────────────────────────────┤
│                                         │
│  🏢 阿里巴巴                             │  ← 大标题
│  互联网 · 杭州市                         │
│  ⭐ 4.2 (1234 评价) · 距离 2.3km       │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ [大图] [大图] [大图]             │   │  ← 图片轮播
│  └─────────────────────────────────┘   │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │  ← 分隔线
│                                         │
│  📍 详细地址                             │
│  浙江省杭州市余杭区文一西路969号          │
│                                         │
│  🚇 交通方式                             │
│  地铁2号线 文一西路站 步行10分钟          │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                         │
│  💼 在招岗位 (12)                       │  ← 岗位列表
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 后端开发工程师 - Java               │ │
│  │ 技术部 · 实习 · 200-300元/天       │ │
│  │ 本科+ · 计算机相关专业               │ │
│  │ [查看详情]                          │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 前端开发工程师 - React              │ │
│  │ ...                                │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                         │
│  💬 员工评价                             │
│  "工作节奏快，成长空间大..."             │
│  [查看全部 234 条评价]                   │
│                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                         │
│  🏢 公司简介                             │
│  阿里巴巴集团创立于1999年...             │
│                                         │
└─────────────────────────────────────────┘
│  [导航过去]  [分享]  [投简历]          │  ← 底部操作栏
└─────────────────────────────────────────┘
```

---

## 模式特定卡片设计

### Domain 模式（餐厅 POI）

**列表卡片:**
```
┌─────────────────────────────────┐
│ 🍜 桃记·实在东北烤肉              │
│ 烤肉 · 杭州市 · 人均¥56          │
│ ⭐ 4.2 · 2 大众点评              │
│ 📍 位于 六塘公寓                 │
│                                 │
│ [图片] [图片] [图片]             │
│                                 │
│ [导航]  [收藏]                   │
└─────────────────────────────────┘
```

**详情页关键信息:**
- 菜系、人均消费
- 营业时间、电话
- 评分、评论摘要
- 推荐菜品（精品牛五花、安格斯牛肋条...）
- 门店照片、菜品照片

### 实习/招聘模式（公司 POI）

**列表卡片:**
```
┌─────────────────────────────────┐
│ 🏢 阿里巴巴                       │
│ 互联网 · 杭州市                   │
│ ⭐ 4.2 · 在招 12 个岗位          │
│ 📍 距离 2.3km · 地铁2号线         │
│                                 │
│ 💼 后端开发 | 前端开发 | 算法...  │
│ 💰 200-300元/天 · 提供班车       │
│                                 │
│ [查看详情]  [收藏]               │
└─────────────────────────────────┘
```

**详情页关键信息:**
- 公司简介、行业、规模
- 在招岗位列表（岗位名、部门、薪资、要求）
- 办公环境照片
- 员工评价（工作强度、成长空间、团队氛围）
- 福利待遇（住宿、班车、餐补、健身房）
- 通勤信息（地铁站、公交线路、步行时间）

### 高考模式（院校 POI）

**列表卡片:**
```
┌─────────────────────────────────┐
│ 🎓 浙江大学                       │
│ 985 · 211 · 双一流               │
│ 📊 QS 排名 54 · 软科 3           │
│ 📍 杭州市 · 综合类                │
│                                 │
│ 🏆 王牌专业: 计算机、自动化...    │
│ 📈 2025录取: 最低分670 位次800   │
│                                 │
│ [查看详情]  [对比]  [收藏]       │
└─────────────────────────────────┘
```

**详情页关键信息:**
- 院校简介、建校年份、学校类型
- 综合排名（QS、软科、USNews）
- 重点学科/王牌专业（A+ 学科列表）
- 往年录取数据（分数线、位次、招生计划）
- 就业数据（升学率、就业率、平均起薪）
- 校园环境（照片、视频）
- 专业列表（按学科分类，显示学科评估等级）

### 留学模式（海外院校 POI）

**列表卡片:**
```
┌─────────────────────────────────┐
│ 🎓 Stanford University           │
│ 美国 · 加州                       │
│ 📊 QS 排名 3 · THE 排名 4        │
│                                 │
│ 💰 学费 $50K/年 · 有奖学金       │
│ 📅 申请截止: 2025-01-05          │
│                                 │
│ [查看详情]  [对比]  [收藏]       │
└─────────────────────────────────┘
```

**详情页关键信息:**
- 院校简介、地理位置、气候
- 综合排名、专业排名
- 热门项目（学位、学制、学费）
- 申请要求（GPA、托福/雅思、GRE/GMAT、文书）
- 申请截止日期、录取数据
- 奖学金机会（Merit-based、Need-based）
- 毕业去向（就业率、起薪、主要雇主）

---

## 交互设计

### 卡片状态

```typescript
type CardState = 
  | 'default'      // 默认状态
  | 'hover'        // 鼠标悬停
  | 'active'       // 按下
  | 'selected'     // 选中（地图同步高亮）
  | 'visited'      // 已访问过
  | 'favorited';   // 已收藏

// 状态样式差异
const cardStyles = {
  default: { opacity: 1 },
  hover: { transform: 'translateY(-2px)', shadow: 'elevated' },
  active: { transform: 'scale(0.98)' },
  selected: { border: '2px solid var(--primary)', background: 'highlighted' },
  visited: { opacity: 0.7 },
  favorited: { badge: '⭐' },
};
```

### 动画时序

**卡片进入动画:**
```css
@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.poi-card {
  animation: card-enter 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  animation-delay: calc(var(--index) * 0.05s);  /* 错峰进入 */
}
```

**展开到详情页:**
```css
/* 侧控栏宽度变化 */
.sidebar {
  transition: width 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}

.sidebar.detail-mode {
  width: 640px;
}

/* 列表淡出 */
.card-list {
  transition: opacity 0.2s ease-out;
}

.sidebar.detail-mode .card-list {
  opacity: 0;
  pointer-events: none;
}

/* 详情页淡入 */
.detail-view {
  opacity: 0;
  transition: opacity 0.25s ease-out 0.1s;  /* 延迟 100ms */
}

.sidebar.detail-mode .detail-view {
  opacity: 1;
}
```

### 地图联动

**卡片 Hover → 地图高亮:**
```typescript
function handleCardHover(poiId: string) {
  // 地图 Marker 高亮
  map.highlightMarker(poiId, {
    scale: 1.3,
    color: 'var(--primary)',
    shadow: 'elevated',
  });
  
  // 可选：显示信息气泡
  map.showTooltip(poiId, { title: poi.name, distance: '2.3km' });
}

function handleCardLeave(poiId: string) {
  map.unhighlightMarker(poiId);
  map.hideTooltip(poiId);
}
```

**卡片点击 → 地图飞行:**
```typescript
function handleCardClick(poi: POI) {
  // 展开详情页
  setDetailPOI(poi);
  
  // 地图飞行到 POI 位置
  map.flyTo({
    center: [poi.lng, poi.lat],
    zoom: 16,
    pitch: 45,  // 3D 视角
    duration: 800,
  });
  
  // 高亮 Marker
  map.selectMarker(poi.id);
}
```

**地图 Marker 点击 → 侧控栏滚动:**
```typescript
function handleMarkerClick(poiId: string) {
  // 侧控栏滚动到对应卡片
  const card = document.getElementById(`card-${poiId}`);
  card.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
  
  // 高亮卡片
  setSelectedCard(poiId);
  
  // 300ms 后自动展开详情（给用户反应时间）
  setTimeout(() => {
    setDetailPOI(getPOI(poiId));
  }, 300);
}
```

---

## 响应式设计

### 断点定义

```typescript
const BREAKPOINTS = {
  mobile: 767,      // 移动端
  tablet: 1024,     // 平板
  desktop: 1440,    // 桌面
  wide: 1920,       // 宽屏
};
```

### 布局适配

**桌面端 (>1024px):**
- 侧控栏固定宽度 420px（详情页 640px）
- 卡片双列或单列（根据宽度）
- Hover 效果完整

**平板 (768-1024px):**
- 侧控栏宽度 360px
- 卡片单列
- 图片预览减少到 2 张

**移动端 (<768px):**
- 全屏底部抽屉或全屏页面
- 卡片全宽
- 图片预览 1 张（轮播）
- 简化信息层级

---

## 性能优化

### 虚拟滚动

对于大量卡片（>100个），使用虚拟滚动：

```typescript
import { Virtuoso } from 'react-virtuoso';

<Virtuoso
  data={pois}
  itemContent={(index, poi) => (
    <POICard key={poi.id} poi={poi} />
  )}
  overscan={5}  // 预渲染 5 个卡片
  style={{ height: '100%' }}
/>
```

### 图片懒加载

```typescript
<Image
  src={poi.image}
  loading="lazy"
  placeholder={<Skeleton />}
  onError={(e) => e.target.src = FALLBACK_IMAGE}
/>
```

### 防抖搜索

```typescript
const debouncedSearch = useDebouncedCallback(
  (query) => fetchPOIs(query),
  300  // 300ms 防抖
);
```

---

## 可访问性 (A11y)

### 键盘导航

```typescript
// 卡片列表支持上下键导航
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    focusNextCard();
  } else if (e.key === 'ArrowUp') {
    focusPreviousCard();
  } else if (e.key === 'Enter') {
    openCardDetail();
  } else if (e.key === 'Escape') {
    closeDetail();
  }
}
```

### ARIA 属性

```tsx
<div
  role="list"
  aria-label="POI 搜索结果"
>
  <article
    role="listitem"
    aria-label={`${poi.name}, ${poi.category}, 评分 ${poi.rating}`}
    tabIndex={0}
    onClick={handleCardClick}
    onKeyDown={handleKeyDown}
  >
    {/* 卡片内容 */}
  </article>
</div>
```

### 屏幕阅读器

- 卡片有清晰的 `aria-label`
- 图片有 `alt` 描述
- 按钮有明确的文本或 `aria-label`
- 状态变化有 `aria-live` 通知

---

## 设计资产

### 图标库

使用 SF Symbols 风格图标（Apple 设计语言）:
- 公司: `building.2`
- 院校: `graduationcap`
- 评分: `star.fill`
- 距离: `location`
- 导航: `arrow.triangle.turn.up.right.circle`
- 收藏: `heart` / `heart.fill`

### 颜色令牌

```css
:root {
  /* 卡片背景 */
  --card-bg: rgba(255, 255, 255, 0.72);
  --card-bg-hover: rgba(255, 255, 255, 0.85);
  --card-border: rgba(255, 255, 255, 0.72);
  
  /* 文本 */
  --text-primary: rgb(31, 41, 55);
  --text-secondary: rgb(107, 114, 128);
  --text-muted: rgb(156, 163, 175);
  
  /* 强调色 */
  --primary: #007AFF;
  --success: #34C759;
  --warning: #FF9500;
  --error: #FF3B30;
  
  /* 暗黑模式 */
  @media (prefers-color-scheme: dark) {
    --card-bg: rgba(28, 28, 30, 0.72);
    --card-border: rgba(255, 255, 255, 0.15);
    --text-primary: rgb(229, 231, 235);
    --text-secondary: rgb(156, 163, 175);
  }
}
```

---

## 实现清单

### Phase 2.1 - 基础侧控栏
- [ ] 侧控栏容器组件
- [ ] 液态玻璃卡片组件
- [ ] 列表视图布局
- [ ] 虚拟滚动（>100 卡片）
- [ ] 响应式适配（桌面/移动）

### Phase 2.2 - 详情视图
- [ ] 详情页展开动画
- [ ] 详情页内容布局
- [ ] 图片轮播组件
- [ ] 返回按钮
- [ ] 移动端手势返回

### Phase 2.3 - 地图联动
- [ ] 卡片 Hover → Marker 高亮
- [ ] 卡片点击 → 地图飞行
- [ ] Marker 点击 → 侧控栏滚动
- [ ] 选中状态同步

### Phase 2.4 - 模式特化
- [ ] Domain 模式卡片模板
- [ ] 招聘模式卡片模板
- [ ] 高考模式卡片模板（Phase 3）
- [ ] 留学模式卡片模板（Phase 3）

---

## 参考资料

- Apple Maps UI/UX
- Google Maps 侧边栏
- Glassmorphism Design Trend
- iOS Human Interface Guidelines - Maps

---

**下一步:**
- 实现基础侧控栏组件
- 创建 POICard 可复用组件
- 集成地图联动逻辑

**相关文档:**
- `tech/08-multi-mode-system.md` - 多模式系统设计
- `tech/10-search-filter.md` - 搜索筛选系统
- `tech/07-frontend-design-system.md` - 前端设计系统
