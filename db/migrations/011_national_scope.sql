-- National-scope work mode (tech/18-national-scale-plan.md §2.1 / §2.5):
-- company tier for LOD, per-city site fields, geography column for metre-accurate
-- ST_DWithin, and the alive-read partial index.
-- Idempotent: apply.sh runs each migration once (ledger + checksum); IF NOT EXISTS
-- guards manual re-runs of a partially applied file.

-- 1=名企 2=大厂 3=中厂/其他。LOD：放大只显名企（tier <= 1），缩到全国全显（tier <= 3）。
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tier smallint NOT NULL DEFAULT 3
  CHECK (tier BETWEEN 1 AND 3);

-- 城市分片加载：省份名（'浙江省'）与行政区划码（'330100'）。
ALTER TABLE company_sites ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE company_sites ADD COLUMN IF NOT EXISTS city_code text;

-- geography STORED 列：用户位置半径 ST_DWithin(geom_geog, point, meters) 按米算，
-- 避免 4326 度数误差；只对 lng/lat 齐全的行生成。
ALTER TABLE company_sites ADD COLUMN IF NOT EXISTS geom_geog geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN lng IS NOT NULL AND lat IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS company_sites_geog_gist ON company_sites USING gist (geom_geog);
CREATE INDEX IF NOT EXISTS company_sites_city_code_idx ON company_sites (city_code);
-- 计划草案里的复合索引 (city_code, tier) 无法建在单表上（tier 在 companies）：
-- 城市过滤 + join 公司的查询由这个 join 复合索引 + companies(tier) 联合覆盖。
CREATE INDEX IF NOT EXISTS company_sites_city_company_idx ON company_sites (city_code, company_id);
CREATE INDEX IF NOT EXISTS companies_tier_idx ON companies (tier);
-- alive 读（status='open' 且 deadline 为空或 >= 今天）：部分索引只扫在招行。
CREATE INDEX IF NOT EXISTS positions_open_site_idx ON positions (site_id) WHERE status = 'open';
