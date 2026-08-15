# 03 - 插件系统开发指南

## 概述

插件是 Domain Map Platform 的核心。新增领域只需要:
1. 定义领域 schema(entity/item 字段)
2. 写后端插件(数据加载)
3. 写前端组件(UI 展示)
4. 写爬虫插件(可选,数据源)

## 快速开始:复制模板

```bash
bash scripts/new-plugin.sh university
```

这会生成:
- `server/src/lib/plugins/university/{schema.ts,seed.ts}`
- `server/src/components/Plugins/university/{UniversityCard.tsx,MajorList.tsx}`
- `crawler/app/plugins/university/{schema.py,seed/}`

## 示例:院校插件

### 1. 定义 schema

在 `server/src/lib/plugins/university/schema.ts`:

```typescript
export const universitySchema = {
  domain: 'university',
  entity_type: 'university',
  entity_fields: {
    type: 'string',        // 985 / 211 / 双一流
    rank: 'number',
    province: 'string',
  },
  item_type: 'major',
  item_fields: {
    category: 'string',    // 工科 / 理科
    score_line: 'number',
    tuition: 'number',
  },
  ui_config: {
    entity_color: '#4F46E5',
    item_icon: '📚',
  }
};
```

### 2. 注册插件

在 `server/src/lib/plugins/registry.ts`:

```typescript
import { universitySchema } from './university/schema';

export const pluginRegistry = {
  recruitment: recruitmentSchema,
  university: universitySchema,  // 新增
};
```

### 3. 前端组件

在 `server/src/components/Plugins/university/UniversityCard.tsx`:

```tsx
export function UniversityCard({ entity }: { entity: Entity }) {
  const { type, rank } = entity.attributes;
  return (
    <div className="p-4 rounded-lg border">
      <h3>{entity.name}</h3>
      <Badge>{type}</Badge>
      <p>排名: {rank}</p>
    </div>
  );
}
```

### 4. 数据加载

在 `crawler/app/plugins/university/seed/universities.json`:

```json
[
  {
    "name": "浙江大学",
    "city": "杭州市",
    "address": "浙江省杭州市西湖区余杭塘路866号",
    "attributes": {
      "type": "985",
      "rank": 4,
      "province": "浙江"
    }
  }
]
```

运行:
```bash
cd crawler
uv run python -m app.cli plugin:seed university
```

### 5. 插入 domain_schemas

```sql
INSERT INTO domain_schemas (domain, entity_type, entity_fields, item_type, item_fields, ui_config)
VALUES (
  'university',
  'university',
  '{"type":"string","rank":"number","province":"string"}',
  'major',
  '{"category":"string","score_line":"number","tuition":"number"}',
  '{"entity_color":"#4F46E5","item_icon":"📚"}'
);
```

完成!现在前端地图会自动显示院校 POI,点击会显示专业列表。

## 官方插件清单

| 插件 code | entity_type | item_type | 说明 |
|---|---|---|---|
| recruitment | company | job | 互联网大厂+央国企招聘 |
| housing | house | listing | 租房信息 |
| university | university | major | 高考院校 |
| user-profile | - | - | 用户画像(简历解析) |
| recommendation | - | - | 推荐系统 |
| ai-assistant | - | - | AI 对话助手 |

详细开发指南见计划文档 Phase 2–P4 章节。
