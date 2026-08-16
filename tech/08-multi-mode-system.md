# 多模式系统设计文档

**文档版本:** 1.1  
**创建日期:** 2026-08-15  
**状态:** Phase 2 已落地（Domain + Work；实习/校招/社招是筛选插件）  
**优先级:** Phase 2 核心功能

---

## 概述

Domain Map 是一个多模式地图应用，用户可以在不同场景下切换模式，每种模式有其专属的 POI 类型、筛选维度和展示逻辑。

### 核心理念

**"一个地图，多种视角"** - 同一个地图引擎，通过模式切换呈现不同领域的空间数据。

---

## 模式定义

### 1. Domain 模式（地图）

**用途:** 通用地图应用，日常生活场景。默认打开的是 **工作模式**；Domain 由用户主动切换。

**POI 类型:**
- 餐饮美食
- 购物商场
- 休闲娱乐
- 交通设施
- 公共服务

**数据源:**
- 高德地图 POI API
- 用户自定义标注

**筛选维度:**
- 分类（菜系、业态）
- 价格区间
- 评分排序
- 距离缓冲区
- 营业状态（营业中/已打烊）

**二级侧控栏展示:**
- POI 名称、分类
- 评分、人均消费
- 营业时间、距离
- 图片预览（2-3张）
- 评论摘要

### 2. 工作模式（默认）

**用途:** 找实习 / 校招 / 社招。实习、秋招、社招是工作模式上的筛选插件，不是独立地图模式。默认打开此模式。

**POI 类型:**
- 科技公司
- 金融机构
- 咨询公司
- 制造企业
- 创业公司

**数据源:**
- 公司位置（高德 POI）
- 实习岗位数据（爬虫/API）
- 公司评价（看准网、脉脉）

**筛选维度:**
- 行业类型（互联网、金融、咨询...）
- 公司规模（大厂、独角兽、创业公司）
- 岗位类型（技术、产品、运营、设计...）
- 薪资范围
- 距离学校/住址的缓冲区
- 是否提供住宿/班车

**二级侧控栏展示:**
- 公司名称、Logo
- 公司简介（一句话）
- 在招实习岗位列表（岗位名、部门、薪资）
- 公司评分、员工评价
- 交通方式、通勤时间

### 3. 秋招模式

**用途:** 应届生秋季校园招聘

**POI 类型:** 同实习模式

**数据源:**
- 校招岗位（官网、牛客、应届生求职网）
- 宣讲会时间地点
- 往年录取数据

**筛选维度:**
- 公司类型（互联网大厂、银行、国企、外企）
- 岗位类型
- 学历要求（本科、硕士、博士）
- 专业限制
- HC 数量
- 是否有内推

**二级侧控栏展示:**
- 公司名称、行业
- 校招岗位（岗位名、部门、Base地、薪资包）
- 宣讲会信息（时间、地点、是否需要预约）
- 投递状态（未投递、已投递、已笔试、已面试）
- 往年数据（录取率、面试难度）

### 4. 春招模式

**用途:** 春季补招、实习转正

**特点:** 与秋招类似，但岗位数量较少，竞争更激烈

**筛选维度:** 秋招基础上增加：
- 实习经历匹配度
- 是否接受往届生

### 5. 社招模式

**用途:** 社会招聘、跳槽

**POI 类型:** 同秋招，但包含更多中小公司

**筛选维度:**
- 工作年限要求（0-1年、1-3年、3-5年、5年+）
- 技能要求（编程语言、框架、工具）
- 薪资范围（面议、10-15K、15-25K、25K+）
- 福利待遇（五险一金、股票期权、年终奖）
- 加班情况（965、996、大小周）

**二级侧控栏展示:**
- 岗位详情（JD、要求、薪资）
- 团队信息（团队规模、技术栈、业务方向）
- 面试流程（轮次、周期）
- 员工评价（工作强度、成长空间、氛围）

### 6. 高考模式

**用途:** 高考志愿填报、院校选择

**POI 类型:**
- 985/211 高校
- 双一流大学
- 一本/二本院校
- 专科院校
- 民办大学

**数据源:**
- 教育部高校数据
- 阳光高考网
- 各省教育考试院
- QS 排名、软科排名
- CSRank（计算机专业排名）

**筛选维度:**
- 院校层级（C9、985、211、双一流、一本）
- 地理位置（省份、城市、气候）
- 专业类别（工科、理科、文科、医科...）
- 录取分数线（往年数据）
- 就业率、升学率
- 综合排名（QS、软科、USNews）
- 专业排名（学科评估、ESI）

**二级侧控栏展示:**
- 院校名称、校徽
- 院校简介（建校时间、学校性质）
- 重点学科/王牌专业
- 往年录取分数线（最高分、最低分、平均分、位次）
- 招生计划（总人数、分省计划）
- 就业去向（升学率、就业率、主要去向）
- 校园环境（图片、视频）

### 7. 留学模式

**用途:** 出国留学院校选择

**POI 类型:**
- 海外高校（美国、英国、加拿大、澳洲、欧洲、亚洲）
- 语言学校
- 预科项目

**数据源:**
- QS World University Rankings
- Times Higher Education
- US News Global Rankings
- 各国使馆教育处
- 留学中介数据

**筛选维度:**
- 国家/地区
- 院校排名（QS、THE、US News）
- 专业排名
- 学费范围
- 申请难度（GPA、托福/雅思、GRE/GMAT）
- 奖学金机会
- 地理位置（大城市、小镇、气候）
- 安全指数

**二级侧控栏展示:**
- 院校名称、Logo、排名
- 院校简介（建校时间、地理位置）
- 热门项目（学位、学制、学费）
- 申请要求（GPA、语言成绩、推荐信、文书）
- 申请截止日期
- 录取数据（录取率、中国学生比例）
- 毕业去向（就业率、起薪、主要雇主）

---

## 模式切换机制

### 用户界面

**桌面端:**
```
顶部工具栏：[Domain] [实习] [秋招] [春招] [社招] [高考] [留学]
点击切换，当前模式高亮
```

**移动端:**
```
底部导航栏或顶部下拉菜单
[图标] 模式名称
```

### 切换行为

1. **视觉反馈:** 模式切换按钮高亮，地图加载动画
2. **数据切换:** 清空当前 POI，加载新模式 POI
3. **UI 适配:** 侧控栏内容重新渲染，筛选器更新
4. **地图状态:** 
   - 选项 A: 保持当前视图（中心点、缩放级别）
   - 选项 B: 飞行到推荐视图（如高考模式飞到用户所在省会）
5. **URL 更新:** `/map?mode=recruitment` (支持直接链接分享)

### 状态持久化

```typescript
// 用户偏好存储（localStorage / 数据库）
{
  lastMode: 'recruitment',  // 上次使用的模式
  modePreferences: {
    recruitment: {
      filters: { industry: ['tech'], distance: 5000 },
      favoriteCompanies: ['alibaba', 'tencent'],
    },
    college: {
      filters: { level: ['985', '211'], province: 'zhejiang' },
      savedSchools: ['zju', 'fudan'],
    },
  }
}
```

---

## 数据模型

### 通用 POI 结构

```typescript
interface BasePOI {
  id: string;                // 唯一标识
  name: string;              // 名称
  location: {
    lng: number;
    lat: number;
    address: string;
  };
  mode: MapMode;             // 所属模式
  source: string;            // 数据源（amap / custom / api）
  updatedAt: Date;           // 更新时间
}
```

### 模式特定扩展

#### Domain POI
```typescript
interface DomainPOI extends BasePOI {
  category: string;          // 餐饮、购物、娱乐...
  subcategory: string;       // 川菜、火锅、烧烤...
  rating: number;            // 评分
  priceLevel: number;        // 价格等级 1-4
  openHours: string;         // 营业时间
  photos: string[];          // 图片 URLs
  reviews: {
    count: number;
    summary: string;
  };
}
```

#### Recruitment POI
```typescript
interface RecruitmentPOI extends BasePOI {
  company: {
    name: string;
    logo: string;
    industry: string[];      // 互联网、金融...
    scale: 'startup' | 'unicorn' | 'bigtech' | 'enterprise';
    rating: number;          // 公司评分
  };
  positions: Position[];     // 在招岗位列表
  benefits: string[];        // 福利：住宿、班车、餐补...
  commute: {
    fromSchool: string;      // 从学校出发的通勤时间
    methods: string[];       // 地铁、公交、步行
  };
}

interface Position {
  id: string;
  title: string;             // 岗位名称
  department: string;        // 部门
  type: 'intern' | 'campus' | 'social';
  salary: {
    min: number;
    max: number;
    currency: 'CNY' | 'USD';
  };
  requirements: {
    education: string;       // 本科、硕士...
    major: string[];         // 计算机、软件工程...
    skills: string[];        // Java、Python...
  };
  deadline: Date;            // 投递截止日期
  status: 'open' | 'closed' | 'paused';
}
```

#### College POI
```typescript
interface CollegePOI extends BasePOI {
  school: {
    name: string;
    logo: string;
    level: string[];         // ['C9', '985', '211', '双一流']
    type: '综合' | '理工' | '师范' | '医药' | '财经' | '政法' | '艺术';
    founded: number;         // 建校年份
  };
  rankings: {
    qs: number;              // QS 排名
    ruanke: number;          // 软科排名
    usnews: number;
  };
  majors: Major[];           // 专业列表
  admission: {
    province: string;
    year: number;
    scores: {
      min: number;
      max: number;
      avg: number;
      rank: number;          // 最低位次
    };
    plan: number;            // 招生计划人数
  }[];
  employment: {
    rate: number;            // 就业率
    furtherStudy: number;    // 升学率
    avgSalary: number;       // 平均起薪
  };
}

interface Major {
  name: string;
  code: string;              // 专业代码
  category: string;          // 工学、理学、文学...
  level: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-';  // 学科评估
  csRank?: number;           // CSRank（仅计算机类）
}
```

#### Overseas POI
```typescript
interface OverseasPOI extends BasePOI {
  university: {
    name: string;
    logo: string;
    country: string;
    city: string;
  };
  rankings: {
    qs: number;
    the: number;
    usnews: number;
  };
  programs: Program[];
  tuition: {
    amount: number;
    currency: string;
    per: 'year' | 'semester';
  };
  admission: {
    gpa: number;
    toefl?: number;
    ielts?: number;
    gre?: number;
    deadline: Date;
  };
  scholarships: {
    available: boolean;
    types: string[];         // Merit-based, Need-based...
  };
}
```

---

## 模式优先级与实现阶段

### Phase 2 (MVP)
- ✅ **Domain 模式** - 通用地图，高德 POI 集成
- ✅ **实习模式** - 第一个招聘场景，验证架构

### Phase 3
- 🔄 **秋招模式** - 复用实习模式架构
- 🔄 **社招模式** - 扩展筛选维度

### Phase 4
- ⏸️ **高考模式** - 新数据源，复杂筛选
- ⏸️ **留学模式** - 国际化，多语言

### Phase 5+
- ⏸️ **春招模式** - 补充招聘场景
- ⏸️ 其他自定义模式（考研、租房、医疗...）

---

## 技术架构

### 前端模式管理

```typescript
// lib/modes.ts
export type MapMode = 
  | 'domain' 
  | 'work'            // 工作：实习 / 校招 / 社招是 FilterPlugin，不是地图模式
  | 'internship'      // work 的兼容别名
  | 'college' 
  | 'overseas';

export interface ModeConfig {
  id: MapMode;
  name: string;               // 显示名称
  icon: string;               // 图标
  color: string;              // 主题色
  poiIcon: string;            // POI 默认图标
  filters: FilterConfig[];    // 可用筛选器
  sortOptions: SortOption[];  // 排序选项
}

export const MODES: Record<MapMode, ModeConfig> = {
  domain: {
    id: 'domain',
    name: '地图',
    icon: 'map',
    color: '#007AFF',
    poiIcon: 'marker',
    filters: [
      { key: 'category', type: 'select', options: ['餐饮', '购物', ...] },
      { key: 'price', type: 'range', min: 0, max: 500 },
      { key: 'distance', type: 'slider', max: 5000 },
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'rating', label: '评分最高' },
      { key: 'popularity', label: '人气最高' },
    ],
  },
  work: {
    id: 'work',
    name: '工作',
    icon: 'briefcase',
    color: '#007AFF',
    poiIcon: 'company',
    filters: [
      { key: 'jobTaxonomy', type: 'taxonomy' }, // FilterPlugin：实习/校招/社招
      { key: 'industry', type: 'multi-select', options: ['互联网', '金融', ...] },
      { key: 'scale', type: 'select', options: ['大厂', '独角兽', '创业公司'] },
      { key: 'salary', type: 'range', min: 0, max: 10000 },
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'salary', label: '薪资最高' },
      { key: 'rating', label: '评分最高' },
    ],
  },
  // ... 其他模式配置
};
```

### 后端 API 设计

```
GET  /api/pois?mode=work&filters={...}&bounds={...}
     - 获取指定模式和筛选条件的 POI 列表
     
GET  /api/pois/:id?mode=work
     - 获取单个 POI 详情
     
GET  /api/modes
     - 获取所有可用模式及其配置
     
POST /api/search?mode=college&q=浙江大学
     - 跨模式搜索
```

### 数据库设计

```sql
-- POI 基础表
CREATE TABLE pois (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  mode VARCHAR(50) NOT NULL,
  location GEOGRAPHY(POINT, 4326),
  address TEXT,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 模式特定属性表（JSONB 存储灵活数据）
CREATE TABLE poi_attributes (
  poi_id UUID REFERENCES pois(id),
  attributes JSONB NOT NULL,  -- 模式特定字段
  PRIMARY KEY (poi_id)
);

-- 索引
CREATE INDEX idx_pois_mode ON pois(mode);
CREATE INDEX idx_pois_location ON pois USING GIST(location);
CREATE INDEX idx_poi_attributes_gin ON poi_attributes USING GIN(attributes);
```

---

## 设计规范

### 模式视觉识别

每个模式有专属主题色和图标，用于：
- 模式切换按钮
- POI Marker 颜色
- 侧控栏卡片强调色
- 筛选器高亮色

**色彩方案:**
- 全模式 UI 主题色统一为蓝色 `#007AFF`（hover、返回、Apply、选中、招聘 POI 点、标签）
- 语义信息可保留绿色：营业时间、薪资数字等，不作为主题色

### 模式一致性

所有模式共享：
- 地图交互逻辑（缩放、平移、旋转）
- 侧控栏布局结构
- 筛选器 UI 组件
- 搜索框样式
- 卡片设计语言

每个模式特化：
- POI 数据结构
- 筛选维度
- 排序逻辑
- 详情页字段

---

## 用户体验考量

### 模式发现

**首次使用:**
- 欢迎页介绍各模式用途
- 引导用户选择常用模式

**老用户:**
- 记住上次使用的模式
- 智能推荐（毕业季推荐秋招、6月推荐高考）

### 模式切换成本

**最小化切换成本:**
- 保持地图视图（避免突然跳转）
- 渐进式加载新 POI
- 平滑动画过渡

**避免混淆:**
- 模式切换时清空搜索结果
- 重置筛选器为默认值
- 显著的模式标识

### 跨模式功能

**收藏系统:**
- 用户可跨模式收藏
- "我的收藏"页面按模式分组

**对比功能:**
- 院校对比（高考/留学模式）
- 公司对比（招聘模式）
- 最多 3-5 个并排对比

---

## 性能考量

### POI 数量级

- Domain: 10K - 100K POI（城市级别）
- 招聘: 1K - 10K POI（公司 + 岗位）
- 高考: ~3K POI（全国高校）
- 留学: ~5K POI（全球高校）

### 优化策略

1. **地图视口加载:** 仅加载当前可见区域 POI
2. **Marker 聚合:** 缩小时聚合，放大时展开
3. **分页加载:** 侧控栏列表虚拟滚动
4. **缓存策略:** 
   - 静态数据（高校、公司基础信息）缓存 7 天
   - 动态数据（岗位、招聘信息）缓存 1 小时
5. **数据库索引:** 
   - 地理空间索引（PostGIS GIST）
   - 全文搜索索引
   - 筛选字段索引

---

## 安全与隐私

### 数据敏感性

**公开数据:**
- Domain POI（餐厅、景点）
- 公司位置
- 高校信息

**半公开数据:**
- 招聘岗位（需登录查看薪资）
- 院校录取数据（往年统计）

**用户私密数据:**
- 收藏列表
- 投递记录
- 浏览历史

### 权限控制

```typescript
// 不同模式的访问权限
const MODE_PERMISSIONS = {
  domain: 'public',        // 任何人可访问
  work: 'public',          // 公开，但详细薪资需登录
  college: 'public',       // 公开
  overseas: 'public',      // 公开
};
```

---

## 国际化

### 多语言支持

**Phase 2:** 中文 + 英文
**Phase 3+:** 日语、韩语、西班牙语

**模式名称本地化:**
```json
{
  "en": {
    "mode.domain": "Map",
    "mode.work": "Work",
    "mode.college": "College"
  },
  "zh": {
    "mode.domain": "地图",
    "mode.work": "工作",
    "mode.college": "高考"
  }
}
```

### 地区适配

- 高考模式：仅中国大陆
- 留学模式：全球
- 招聘模式：分地区（国内/海外）

---

## 未来扩展

### 自定义模式（Phase 5+）

允许用户创建自定义模式：
- 租房模式（POI = 小区、中介）
- 医疗模式（POI = 医院、药店）
- 考研模式（POI = 高校研究生院）

### 社区贡献

- 用户可补充 POI 信息
- 众包数据审核机制
- 贡献积分系统

---

## 总结

多模式系统是 Domain Map 的核心差异化特性。通过统一的地图引擎 + 模式特定的数据和 UI，为用户提供专业、聚焦的场景化体验。

**关键设计原则:**
1. **一致性** - 跨模式的交互逻辑统一
2. **专业性** - 每个模式深入垂直场景
3. **简洁性** - 模式切换低成本，UI 清晰
4. **可扩展** - 架构支持未来新增模式

---

**下一步:**
- Phase 2 实现 Domain + 实习两个模式
- 验证架构可行性
- 收集用户反馈迭代

**相关文档:**
- `tech/08-poi-system.md` - POI 数据模型详细设计
- `tech/09-secondary-sidebar.md` - 二级侧控栏设计规范
- `tech/10-search-filter.md` - 搜索筛选系统设计
