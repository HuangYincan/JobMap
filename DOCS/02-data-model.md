# 02 - 抽象数据模型

## 核心表设计(001_core.sql)

### users - 用户表
```sql
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text UNIQUE,
  name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);
```

### maps - 地图表(多租户)
```sql
CREATE TABLE maps (
  id bigserial PRIMARY KEY,
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,  -- NULL = 公共地图
  name text NOT NULL,                    -- "我的秋招地图"
  domain text NOT NULL,                  -- 'recruitment' / 'university'
  is_public boolean DEFAULT false,
  config jsonb DEFAULT '{}',             -- 地图配置(中心/缩放/主题)
  created_at timestamptz DEFAULT now()
);
```

### domain_schemas - 领域插件配置
```sql
CREATE TABLE domain_schemas (
  domain text PRIMARY KEY,               -- 'recruitment'
  entity_type text NOT NULL,             -- 'company'
  entity_fields jsonb NOT NULL,          -- {"name":"text","category":"text"}
  item_type text NOT NULL,               -- 'job'
  item_fields jsonb NOT NULL,            -- {"title":"text","salary":"text"}
  ui_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

### entities - 通用实体(公司/大学/医院)
```sql
CREATE EXTENSION postgis;
CREATE EXTENSION pg_trgm;

CREATE TABLE entities (
  id bigserial PRIMARY KEY,
  map_id bigint REFERENCES maps(id) ON DELETE CASCADE,
  domain text NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  address text,
  lng double precision,
  lat double precision,
  geom geometry(Point,4326) GENERATED ALWAYS AS (
    CASE WHEN lng IS NOT NULL THEN ST_SetSRID(ST_MakePoint(lng,lat),4326) END
  ) STORED,
  attributes jsonb DEFAULT '{}',         -- 领域专属字段
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_entities_geom ON entities USING gist(geom);
CREATE INDEX idx_entities_name_trgm ON entities USING gin(name gin_trgm_ops);
```

### items - 通用条目(JD/专业/科室)
```sql
CREATE TABLE items (
  id bigserial PRIMARY KEY,
  entity_id bigint NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  map_id bigint NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES sources(id),
  external_id text NOT NULL,
  title text,
  attributes jsonb DEFAULT '{}',         -- 领域专属字段
  is_active boolean DEFAULT true,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (source_id, external_id, map_id)
);
```

完整 DDL 见 `db/migrations/001_core.sql`

## PostGIS 空间查询示例

**KNN 最近点**:
```sql
SELECT id, name, ST_Distance(geom::geography, :user_geom::geography)/1000 AS dist_km
FROM entities
WHERE domain='recruitment'
ORDER BY geom <-> :user_geom
LIMIT 10;
```

**缓冲区查询**:
```sql
SELECT * FROM entities
WHERE domain='housing'
  AND ST_DWithin(geom::geography, :center_geom::geography, 5000);
```

详见计划文档的 PostGIS 章节。
