# 搜索筛选系统设计

**文档版本:** 1.1  
**创建日期:** 2026-08-15  
**状态:** Phase 2 已落地（`parseSearchQuery` / `runPOIPipeline` / `trendingForMode`）  
**优先级:** Phase 2 核心功能

---

## 概述

搜索筛选系统是多模式地图应用的核心交互入口，提供：
- **全文搜索** - 按名称、关键词快速定位 POI
- **多维度筛选** - 按标签、属性、范围精准过滤
- **空间筛选** - 距离缓冲区、行政区划
- **智能排序** - 距离、评分、相关性
- **实时反馈** - 输入即搜索，地图同步更新

---

## 搜索功能

### 1. 搜索框设计

#### 桌面端

```
┌──────────────────────────────────────────────┐
│  🔍  搜索公司、岗位...          [筛选] [清空] │
└──────────────────────────────────────────────┘
     ↓ (输入后显示建议)
┌──────────────────────────────────────────────┐
│  🔍  阿里                                     │
├──────────────────────────────────────────────┤
│  💡 搜索建议                                  │
│  🏢 阿里巴巴 - 互联网公司                     │
│  🏢 阿里云计算 - 云服务                       │
│  💼 阿里巴巴 - 后端开发                       │
│  💼 阿里云 - 算法工程师                       │
├──────────────────────────────────────────────┤
│  🕐 最近搜索                                  │
│  阿里巴巴  字节跳动  网易                     │
└──────────────────────────────────────────────┘
```

#### 移动端

```
┌─────────────────────┐
│  🔍  搜索...   [×]  │  ← 点击展开全屏搜索
└─────────────────────┘
     ↓ (点击后)
┌─────────────────────┐
│  [←]  阿里   [清空] │  ← 全屏搜索页
├─────────────────────┤
│  💡 搜索建议         │
│  🏢 阿里巴巴         │
│  🏢 阿里云计算       │
│  ...                │
├─────────────────────┤
│  🕐 最近搜索         │
│  [阿里巴巴] [字节]  │
└─────────────────────┘
```

### 2. 搜索类型

#### 按名称搜索（全文搜索）

**Domain 模式:**
- 搜索 POI 名称："星巴克"、"肯德基"
- 支持模糊匹配、拼音搜索
- 支持别名（`西湖` = `West Lake` / `westlake`；`灵隐` = `lingyin`）

**招聘模式:**
- 搜索公司名："阿里巴巴"、"字节跳动"
- 搜索岗位名："后端开发"、"算法工程师"
- 支持职位别名（`lib/search.ts` `JOB_ALIAS_GROUPS`：`前端` = `FE` = `frontend`；`后端` = `backend`；`算法` = `ML`；`产品` = `PM`）
- 支持公司别名（`COMPANY_ALIAS_GROUPS`：`alibaba` = 阿里巴巴；`bytedance` = 字节跳动；`tencent` / `netease` / `huawei` 同理）
- `#在招` / 筛选开关 `onlyOpen` 只保留至少有一个 `status=open` 岗位的公司
- `#住宿` 对应 `providesHousing` 开关（`#班车` 已随 `providesShuttle` 筛选移除，退化为关键词）
- `#本科` / `#硕士` / `#博士` 对应学历多选 `education`
- `#技术` / `#产品` / `#运营` / `#设计` 对应职能多选 `roleFamily`（与 intern/campus/social 的 `jobTaxonomy` 分开）
- 申请截止日期筛选 `deadline`：保留该日仍未截止（或无日期）的岗位

**高考模式:**
- 搜索院校名："浙江大学"、"清华"
- 搜索专业名："计算机科学与技术"
- 支持简称（"浙大" = "浙江大学"）

#### 按标签搜索

**招聘模式标签:**
- 公司规模：`#大厂` `#独角兽` `#创业公司`
- 岗位类型：`#实习` `#校招` `#社招`（taxonomy 路径）
- 职能：`#技术` `#产品` `#运营` `#设计`
- 学历：`#本科` `#硕士` `#博士`
- 说明：行业 / 行政区 / 班车标签已随对应筛选移除（`industry` / `district` / `providesShuttle`），`#互联网`、`#西湖区` 等退化为普通关键词，仍按公司行业文本 / 地址文本匹配。

**高考模式标签:**
- 院校层级：`#C9` `#985` `#211` `#双一流`
- 院校类型：`#综合` `#理工` `#师范`
- 学科：`#工科` `#理科` `#文科`

#### 组合搜索

```
"阿里 #技术岗"
→ 筛选: 公司名包含"阿里" AND 职能=技术

"985 #浙江"
→ 筛选: 院校层级=985 AND 省份=浙江
```

### 3. 搜索建议（Autocomplete）

#### 数据源优先级

1. **热门搜索** - 平台统计的高频搜索词
2. **最近搜索** - 用户历史搜索（localStorage / 数据库）
3. **推荐搜索** - 基于用户位置、偏好
4. **实时匹配** - 输入文本的前缀匹配

#### 建议结果结构

```typescript
interface SearchSuggestion {
  type: 'poi' | 'position' | 'tag' | 'area';
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  highlight?: string;  // 高亮匹配部分
}

// 示例
const suggestions: SearchSuggestion[] = [
  {
    type: 'poi',
    id: 'alibaba-hz',
    title: '阿里巴巴',
    subtitle: '互联网 · 杭州市',
    icon: '🏢',
    highlight: '阿里',  // 用户输入
  },
  {
    type: 'position',
    id: 'backend-alibaba',
    title: '阿里巴巴 - 后端开发',
    subtitle: '技术岗 · 200-300元/天',
    icon: '💼',
    highlight: '阿里',
  },
  {
    type: 'tag',
    id: 'tag-bigtech',
    title: '#大厂',
    subtitle: '123 个公司',
    icon: '🏷️',
  },
];
```

#### 防抖与缓存

```typescript
// 300ms 防抖
const debouncedSearch = useDebouncedCallback(
  async (query: string) => {
    // 检查缓存
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.results;
    }
    
    // 调用 API
    const results = await fetchSuggestions(query);
    
    // 缓存结果（5分钟）
    searchCache.set(query, { results, timestamp: Date.now() });
    
    return results;
  },
  300
);
```

### 4. 搜索结果展示

#### 结果计数

```tsx
<SearchHeader>
  <BackButton />
  <Title>搜索结果 ({totalCount})</Title>
  <SortButton />
</SearchHeader>
```

#### 空结果处理

```
┌─────────────────────────────┐
│  🔍  未找到 "xxxx"          │
│                             │
│  💡 建议:                    │
│  · 检查拼写                  │
│  · 尝试其他关键词            │
│  · 调整筛选条件              │
│                             │
│  🔥 热门搜索:               │
│  [阿里巴巴] [字节跳动]       │
│  [网易] [华为]              │
└─────────────────────────────┘
```

#### 搜索历史

- Recent 只记 **persistable** 已提交查询（`lib/persistable.ts`：`work` / `internship`）。地图模式 / AMap 关键词不落库。
- 已登录：`POST /api/me/search-history`。
- 游客：`lib/guest-search-history.ts`，键 `dm.guest-search-history.v1`，上限 30。不要再用 `search_history` / `MAX_HISTORY 20`。
- 登录时上传游客 persistable 行后清空本地；登出再读本地列表。
- 空搜索框不展示 `trendingForMode`；Recent L2 仍展示热门芯片。

---

## 筛选功能

### 1. 筛选器类型

#### 单选筛选器 (Select)

> 招聘模式的行业（`industry`）/ 行政区（`district`）/ 班车（`providesShuttle`）筛选已移除（见 §移除清单），示例以高考模式省份单选为准。

```tsx
<FilterSelect
  label="省份"
  options={[
    { value: 'zhejiang', label: '浙江' },
    { value: 'jiangsu', label: '江苏' },
    { value: 'guangdong', label: '广东' },
  ]}
  value={filters.province}
  onChange={(value) => updateFilter('province', value)}
/>
```

**UI 展示:**
```
省份: [浙江 ▼]
      ↓
      浙江 ✓
      江苏
      广东
```

#### 多选筛选器 (Multi-select)

```tsx
<FilterMultiSelect
  label="院校层级"
  options={[
    { value: 'c9', label: 'C9' },
    { value: '985', label: '985' },
    { value: '211', label: '211' },
    { value: 'first-class', label: '双一流' },
  ]}
  values={filters.levels}
  onChange={(values) => updateFilter('levels', values)}
/>
```

**UI 展示:**
```
院校层级: [C9] [985] [211] [双一流 ✓]
          已选 1 项 [清空]
```

#### 范围筛选器 (Range)

```tsx
<FilterRange
  label="薪资范围"
  min={0}
  max={50}
  step={1}
  unit="K/月"
  values={filters.salary}
  onChange={(values) => updateFilter('salary', values)}
/>
```

**UI 展示:**
```
薪资范围:
[━━━━●━━━━━━━━━●━━━━] 
15K/月 - 30K/月
```

#### 滑块筛选器 (Slider)

```tsx
<FilterSlider
  label="距离"
  min={0}
  max={50}
  step={1}
  unit="km"
  value={filters.distance}
  onChange={(value) => updateFilter('distance', value)}
/>
```

**UI 展示:**
```
距离:
[━━━━━━━━●━━━━━━━━━] 
5km 以内
```

#### 开关筛选器 (Toggle)

```tsx
<FilterToggle
  label="仅看在招岗位"
  checked={filters.onlyOpen}
  onChange={(checked) => updateFilter('onlyOpen', checked)}
/>
```

**UI 展示:**
```
仅看在招岗位: [●━━━━] OFF
             [━━━━●] ON
```

#### 日期筛选器 (Date)

```tsx
<FilterDate
  label="申请截止日期"
  value={filters.deadline}
  onChange={(date) => updateFilter('deadline', date)}
/>
```

**UI 展示:**
```
申请截止日期: [2025-03-31 ▼]
             ↓ 日历选择器
```

### 2. 筛选器布局

#### 桌面端 - 侧控栏顶部

```
┌─────────────────────────────────────┐
│  🔍 搜索                    [筛选▼] │
├─────────────────────────────────────┤
│  📊 筛选器                          │
│                                     │
│  行业类型: [互联网▼]                │
│  公司规模: [全部▼]                  │
│  岗位类型: [技术] [产品] [运营]     │
│                                     │
│  薪资范围:                          │
│  [━━━━●━━━━━━●━━━] 100-500元/天    │
│                                     │
│  距离:                              │
│  [━━━━━━━━●━━━] 5km以内            │
│                                     │
│  [重置] [应用(23)]                  │
└─────────────────────────────────────┘
```

#### 移动端 - 底部抽屉

```
┌─────────────────────┐
│  [筛选] [排序]      │  ← 顶部按钮
└─────────────────────┘
     ↓ (点击筛选)
┌─────────────────────┐
│  筛选条件   [×关闭] │  ← 全屏抽屉
├─────────────────────┤
│  行业类型            │
│  [互联网▼]          │
│                     │
│  公司规模            │
│  [全部▼]            │
│                     │
│  薪资范围            │
│  [滑块]             │
│                     │
│  距离                │
│  [滑块]             │
│                     │
│  ... (滚动更多)     │
│                     │
├─────────────────────┤
│  [重置] [查看23个]  │  ← 固定底部
└─────────────────────┘
```

### 3. 模式特定筛选器

#### Domain 模式

```typescript
const domainFilters: Filter[] = [
  { type: 'select', key: 'category', label: '分类', options: CATEGORIES },
  { type: 'range', key: 'minRating', label: '评分区间', min: 0, max: 5, step: 0.5, unit: '分' },
  { type: 'range', key: 'price', label: '人均消费', min: 0, max: 5000, step: 100, unit: '元' },
  { type: 'slider', key: 'distance', label: '距离', min: 0, max: 50, step: 1, unit: 'km' },
];
```

> 价格匹配：有真实 `cost`（元）的 POI 按真实值过滤；否则按 `priceLevel` 档位中点 `[50, 200, 800, 3000]`（tech/22 价格档位）。评分区间为双向 `[lo, hi]`（旧 slider 数值仍兼容作下限）。

#### 招聘模式（实习/秋招/社招）

```typescript
const recruitmentFilters: Filter[] = [
  { type: 'taxonomy', key: 'jobTaxonomy', label: '岗位类型', options: JOB_FAMILY_PLUGIN },
  { type: 'multi-select', key: 'roleFamily', label: '职能', options: ['技术', '产品', '运营', '设计'] },
  { type: 'multi-select', key: 'scale', label: '公司规模', options: ['大厂', '独角兽', '创业公司'] },
  { type: 'multi-select', key: 'education', label: '学历要求', options: ['本科', '硕士', '博士'] },
  { type: 'range', key: 'salary', label: '薪资范围', min: 0, max: 50, step: 1, unit: 'K/月' },
  { type: 'slider', key: 'distance', label: '距离', min: 0, max: 50, step: 1, unit: 'km' },
  { type: 'toggle', key: 'onlyOpen', label: '仅看在招岗位' },
  { type: 'toggle', key: 'providesHousing', label: '提供住宿' },
  { type: 'date', key: 'deadline', label: '申请截止日期' },
];
```

> 行业（`industry`）、行政区（`district`）、班车（`providesShuttle`）筛选已移除；后端匹配器保留，供 API / 历史筛选回放。

#### 高考模式

```typescript
const collegeFilters: Filter[] = [
  { type: 'multi-select', key: 'level', label: '院校层级', options: ['C9', '985', '211', '双一流', '一本'] },
  { type: 'select', key: 'province', label: '省份', options: PROVINCES },
  { type: 'select', key: 'city', label: '城市', options: CITIES },
  { type: 'multi-select', key: 'type', label: '院校类型', options: ['综合', '理工', '师范', '医药', '财经'] },
  { type: 'range', key: 'score', label: '录取分数线', min: 400, max: 700, unit: '分' },
  { type: 'range', key: 'rank', label: '最低位次', min: 0, max: 50000 },
  { type: 'multi-select', key: 'major', label: '专业类别', options: MAJOR_CATEGORIES },
];
```

#### 留学模式

```typescript
const overseasFilters: Filter[] = [
  { type: 'multi-select', key: 'country', label: '国家/地区', options: COUNTRIES },
  { type: 'range', key: 'qsRank', label: 'QS 排名', min: 1, max: 500 },
  { type: 'range', key: 'tuition', label: '学费', min: 0, max: 100, unit: 'K USD/年' },
  { type: 'select', key: 'degree', label: '学位类型', options: ['本科', '硕士', '博士'] },
  { type: 'range', key: 'gpa', label: 'GPA 要求', min: 2.0, max: 4.0, step: 0.1 },
  { type: 'range', key: 'toefl', label: '托福要求', min: 60, max: 120 },
  { type: 'toggle', key: 'hasScholarship', label: '提供奖学金' },
];
```

### 4. 空间筛选

#### 距离缓冲区

**交互方式 A: 滑块控制**

```tsx
<DistanceFilter
  center={userLocation || mapCenter}
  radius={filters.distance}
  unit="km"
  onChange={(radius) => {
    updateFilter('distance', radius);
    
    // 地图显示缓冲圈
    map.showCircle({
      center: [lng, lat],
      radius: radius * 1000,  // km → m
      fillColor: 'rgba(0, 122, 255, 0.1)',
      strokeColor: '#007AFF',
    });
  }}
/>
```

**交互方式 B: 地图拖拽**

```typescript
// 用户在地图上拖动圆圈调整半径
map.on('circle-resize', (e) => {
  const radiusKm = e.radius / 1000;
  updateFilter('distance', radiusKm);
  refetchPOIs();
});
```

**视觉效果:**
- 半透明蓝色圆圈覆盖
- 圆圈边缘可拖动调整
- 实时显示半径数值

#### 行政区划筛选

```tsx
<AreaFilter
  type="province | city | district"
  value={filters.area}
  onChange={(area) => {
    updateFilter('area', area);
    
    // 地图飞行到该区域
    map.flyToBounds(area.bounds);
    
    // 高亮区域边界
    map.highlightArea(area.code);
  }}
/>
```

**示例:**
```
省份: [浙江省▼]
  ↓
  浙江省 ✓
  江苏省
  上海市
  ...

城市: [杭州市▼]
  ↓
  杭州市 ✓
  宁波市
  温州市
  ...
```

#### 自定义多边形（高级功能，Phase 3+）

用户在地图上绘制多边形区域：

```typescript
map.drawPolygon({
  onComplete: (polygon) => {
    updateFilter('customArea', polygon);
    refetchPOIs({ bounds: polygon.bounds });
  },
});
```

---

## 排序功能

### 1. 排序选项

#### Domain 模式

```typescript
const domainSortOptions = [
  { key: 'distance', label: '距离最近', icon: '📍' },
  { key: 'relevance', label: '相关性', icon: '🎯' },
  { key: 'rating', label: '评分最高', icon: '⭐' },
  { key: 'popularity', label: '人气最高', icon: '🔥' },
  { key: 'priceAsc', label: '价格从低到高', icon: '💰' },
  { key: 'priceDesc', label: '价格从高到低', icon: '💎' },
];
```

> Domain 模式 `defaultSort='distance'`，`distance` 排在选项第一位（下拉默认即距离）。

#### 招聘模式

```typescript
const recruitmentSortOptions = [
  { key: 'relevance', label: '综合排序', icon: '🎯' },
  { key: 'distance', label: '距离最近', icon: '📍' },
  { key: 'salaryDesc', label: '薪资最高', icon: '💰' },
  { key: 'rating', label: '公司评分', icon: '⭐' },
  { key: 'positionCount', label: '岗位数量', icon: '💼' },
  { key: 'deadline', label: '截止时间', icon: '⏰' },
];
```

#### 高考模式

```typescript
const collegeSortOptions = [
  { key: 'qsRank', label: 'QS 排名', icon: '📊' },
  { key: 'ruankeRank', label: '软科排名', icon: '📈' },
  { key: 'distance', label: '距离最近', icon: '📍' },
  { key: 'scoreAsc', label: '录取分从低到高', icon: '📉' },
  { key: 'scoreDesc', label: '录取分从高到低', icon: '📈' },
  { key: 'employmentRate', label: '就业率', icon: '💼' },
];
```

### 2. 排序 UI

#### 桌面端

```
搜索结果 (23个)  [排序: 距离最近 ▼]
                     ↓
                     综合排序
                     距离最近 ✓
                     薪资最高
                     公司评分
```

#### 移动端

```
┌─────────────────────┐
│  [筛选] [排序▼]     │
└─────────────────────┘
     ↓ (点击排序)
┌─────────────────────┐
│  排序方式   [×关闭] │
├─────────────────────┤
│  ○ 综合排序         │
│  ● 距离最近         │
│  ○ 薪资最高         │
│  ○ 公司评分         │
│  ○ 岗位数量         │
└─────────────────────┘
```

### 3. 多级排序

```typescript
// 主排序 + 次排序
const sortConfig = {
  primary: 'distance',    // 距离最近
  secondary: 'rating',    // 评分作为第二排序
};

// 排序逻辑
function sortPOIs(pois: POI[], config: SortConfig) {
  return pois.sort((a, b) => {
    // 主排序
    const primaryCompare = compare(a, b, config.primary);
    if (primaryCompare !== 0) return primaryCompare;
    
    // 次排序
    return compare(a, b, config.secondary);
  });
}
```

---

## 实时搜索

### 1. 输入即搜索

```typescript
// 用户输入触发搜索
const handleSearchInput = useDebouncedCallback(
  async (query: string) => {
    if (query.length < 2) return;  // 至少 2 个字符
    
    setLoading(true);
    
    try {
      const results = await searchPOIs({
        query,
        mode: currentMode,
        filters: currentFilters,
        bounds: map.getBounds(),
      });
      
      setPOIs(results);
      updateMapMarkers(results);
    } catch (error) {
      showError('搜索失败，请重试');
    } finally {
      setLoading(false);
    }
  },
  300  // 300ms 防抖
);
```

### 2. 地图联动

```typescript
// 搜索结果 → 地图标记
function updateMapMarkers(pois: POI[]) {
  // 清除旧标记
  map.clearMarkers();
  
  // 添加新标记
  pois.forEach(poi => {
    map.addMarker({
      id: poi.id,
      position: [poi.lng, poi.lat],
      icon: getModeIcon(currentMode),
      color: poi.isSelected ? '#007AFF' : '#666',
    });
  });
  
  // 调整视野包含所有标记
  if (pois.length > 0) {
    map.fitBounds(calculateBounds(pois));
  }
}

// 筛选器变化 → 重新搜索
function handleFilterChange(key: string, value: any) {
  updateFilter(key, value);
  
  // 立即反馈（乐观更新）
  const optimisticResults = filterLocalPOIs(pois, { ...filters, [key]: value });
  setPOIs(optimisticResults);
  
  // 后台重新获取
  refetchPOIs();
}
```

### 3. 地图移动触发

```typescript
// 用户拖动地图时重新搜索
map.on('moveend', () => {
  const bounds = map.getBounds();
  
  // 避免频繁请求
  if (shouldRefetch(bounds)) {
    refetchPOIs({ bounds });
  }
});

function shouldRefetch(newBounds: Bounds): boolean {
  // 视野变化超过 50% 才重新搜索
  const overlap = calculateOverlap(oldBounds, newBounds);
  return overlap < 0.5;
}
```

---

## API 设计

### 1. 搜索 API

```
GET /api/search

Query Parameters:
- q: string              // 搜索关键词
- mode: MapMode          // 地图模式
- filters: JSON          // 筛选条件
- sort: string           // 排序方式
- bounds: string         // 地图边界 "minLng,minLat,maxLng,maxLat"
- page: number           // 分页
- pageSize: number       // 每页数量

Response:
{
  total: 123,
  page: 1,
  pageSize: 20,
  results: POI[],
  aggregations: {        // 聚合信息（用于筛选器）
    industries: { "互联网": 45, "金融": 23, ... },
    priceRange: { min: 50, max: 5000 },
  }
}
```

> **输入上限(2026-08-23,quality-scan #12)**:现路径为 `GET /api/pois`(与 `POST /api/search` 共用校验规则):`q` ≤ 100 字符(超限 400 `Q_TOO_LONG`)、`page` 整数 1..10000、`pageSize` 整数 1..100(超限 400 `INVALID_PAGE` / `INVALID_PAGE_SIZE`,先于缓存 key 构造);分页参数缺失/空串回退默认 `page=1`/`pageSize=20`。

### 2. 建议 API

```
GET /api/suggest

Query Parameters:
- q: string              // 输入文本
- mode: MapMode          // 地图模式
- limit: number          // 返回数量（默认 10）

Response:
{
  suggestions: SearchSuggestion[],
  recentSearches: string[],
  hotSearches: string[],
}
```

### 3. 筛选器选项 API

```
GET /api/filter-options

Query Parameters:
- mode: MapMode          // 地图模式

Response:
{
  filters: FilterConfig[],
  // 动态选项（如城市列表、专业列表）
  options: {
    cities: { code: string, name: string }[],
    majors: { code: string, name: string }[],
  }
}
```

---

## 性能优化

### 1. 前端缓存

```typescript
// LRU 缓存搜索结果
const searchCache = new LRUCache<string, SearchResult>({
  max: 100,  // 最多缓存 100 个查询
  ttl: 5 * 60 * 1000,  // 5 分钟过期
});

function getCacheKey(params: SearchParams): string {
  return JSON.stringify({
    q: params.query,
    mode: params.mode,
    filters: params.filters,
    sort: params.sort,
  });
}
```

### 2. 后端索引

```sql
-- 全文搜索索引
CREATE INDEX idx_poi_fulltext ON pois 
USING GIN(to_tsvector('simple', name || ' ' || COALESCE(description, '')));

-- 地理空间索引
CREATE INDEX idx_poi_location ON pois USING GIST(location);

-- 筛选字段索引
CREATE INDEX idx_poi_mode_category ON pois(mode, category);
CREATE INDEX idx_poi_rating ON pois(rating DESC);

-- 复合索引
CREATE INDEX idx_recruitment_industry_salary ON poi_attributes 
USING BTREE((attributes->>'industry'), (attributes->>'salary'));
```

### 3. 分页策略

```typescript
// 无限滚动 + 游标分页
const [pois, setPOIs] = useState<POI[]>([]);
const [cursor, setCursor] = useState<string | null>(null);
const [hasMore, setHasMore] = useState(true);

async function loadMore() {
  const { results, nextCursor } = await fetchPOIs({
    ...filters,
    cursor,
    pageSize: 20,
  });
  
  setPOIs(prev => [...prev, ...results]);
  setCursor(nextCursor);
  setHasMore(!!nextCursor);
}
```

---

## 用户体验优化

### 1. 加载状态

```tsx
{loading && (
  <LoadingState>
    <Spinner />
    <Text>搜索中...</Text>
  </LoadingState>
)}

{!loading && pois.length === 0 && (
  <EmptyState>
    <Icon>🔍</Icon>
    <Text>未找到结果</Text>
    <Suggestions />
  </EmptyState>
)}
```

### 2. 错误处理

```typescript
try {
  const results = await searchPOIs(params);
} catch (error) {
  if (error.code === 'NETWORK_ERROR') {
    showToast('网络连接失败，请检查网络');
  } else if (error.code === 'TIMEOUT') {
    showToast('搜索超时，请重试');
  } else {
    showToast('搜索失败，请稍后重试');
  }
  
  // 降级：显示缓存结果
  const cached = getCachedResults(params);
  if (cached) {
    setPOIs(cached);
    showToast('显示缓存结果', { type: 'info' });
  }
}
```

### 3. 智能提示

```tsx
{query && pois.length > 0 && (
  <SmartTip>
    💡 试试调整筛选条件可以找到更多结果
  </SmartTip>
)}

{filters.distance < 5 && pois.length < 10 && (
  <SmartTip>
    📍 扩大搜索范围可能有更多选择
    <Button onClick={() => updateFilter('distance', 50)}>
      扩大到 50km
    </Button>
  </SmartTip>
)}
```

---

## 实现清单

### Phase 2.1 - 基础搜索
- [x] 搜索框组件
- [x] 搜索建议（Autocomplete）
- [x] 搜索历史存储（登录后 `/api/me/search-history`）
- [x] 全文搜索 API
- [x] 搜索结果展示

### Phase 2.2 - 筛选系统
- [x] 筛选器组件库（Select、Range、Slider、Toggle）
- [x] 筛选器容器（桌面/移动）
- [x] 筛选逻辑实现
- [x] 筛选 API
- [x] 筛选器动态加载（`GET /api/filter-options` + `MODES`）

### Phase 2.3 - 空间筛选
- [x] 距离缓冲区滑块
- [x] 地图圆圈可视化
- [x] 行政区划选择器（地址文本 + 粗框）
- [ ] 空间查询 API（PostGIS）

### Phase 2.4 - 排序与优化
- [x] 排序选择器
- [x] 多级排序逻辑（`relevance` / 距离 / 薪资 / 评分 / 岗位数 / 截止；Domain 另有价格）
- [x] 实时搜索防抖
- [x] 搜索结果缓存（公开 API 30s；客户端 suggest LRU 100 / 5min）
- [x] 无限滚动分页

---

## 参考资料

- Apple Maps Search UX
- Google Maps Filters
- Airbnb Search & Filters
- 高德地图 POI 搜索 API

---

**下一步:**
- 实现搜索框和建议组件
- 构建筛选器组件库
- 集成地图空间查询

**相关文档:**
- `tech/08-multi-mode-system.md` - 模式定义
- `tech/09-secondary-sidebar.md` - 搜索结果展示
- `tech/02-data-model.md` - POI 数据模型
