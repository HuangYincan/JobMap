-- 013_hangzhou_pois.sql
-- 杭州高德 POI 本地库(2026-08-17,tech/22-hangzhou-poi-local.md)
--
-- 背景:用户提供全国几亿条高德 POI 数据(已授权入库),Demo 阶段先落杭州
-- (`/Users/acccan/Downloads/杭州市/杭州市POI.csv`,1,006,185 行)。Domain 模式
-- 杭州内走本地库(按 zoom 分层展示 + 列表候选 300→+300→1000),杭州外回退高德
-- API(默认 1 次 25 条)。
--
-- 坐标口径:geom 由 GCJ-02 生成(与 company_sites 一致,浏览器 getBounds() 拿到
-- 的也是 GCJ-02,bbox 直接 && 匹配零偏移);lon_wgs84/lat_wgs84 保留原始参考列。
--
-- 全国扩展:city_code 列预留(每城市一分区时 PARTITION BY LIST (city_code),
-- 主键须改 PRIMARY KEY (city_code, poi_id))。demo 阶段单表即可。
--
-- 幂等:apply.sh 每迁移一次(ledger + checksum);IF NOT EXISTS 防手工重跑半应用。

CREATE TABLE IF NOT EXISTS hz_pois (
  poi_id         text PRIMARY KEY,            -- 高德 poiid,如 B0FFHF120D
  name           text NOT NULL,               -- POI 名称
  address        text,                        -- 地址
  tel            text,                        -- 电话(31% 非空)
  rating         numeric(3,1),                -- 0-5;CSV rating 列 41% 非空,其余 NULL
  cost           numeric(10,2),               -- 人均消费(8% 非空)
  lng_gcj        double precision NOT NULL,   -- 展示用(高德底图坐标,零转换)
  lat_gcj        double precision NOT NULL,
  lon_wgs84      double precision,            -- 原始参考(WGS84,与 GCJ 相差 ~300-500m)
  lat_wgs84      double precision,
  geom           geometry(Point,4326) GENERATED ALWAYS AS
                   (ST_SetSRID(ST_MakePoint(lng_gcj, lat_gcj), 4326)) STORED,
  big_type       text NOT NULL,               -- 高德一级分类(餐饮服务/风景名胜/…)
  mid_type       text,                        -- 二级
  small_type     text,                        -- 三级
  typecode       text,                        -- 高德分类码
  adname         text NOT NULL,               -- 区县(13 个:西湖区/萧山区/桐庐县/…)
  business_area  text,                        -- 商圈(57% 非空)
  photos         jsonb NOT NULL DEFAULT '[]', -- 高德图床 URL 数组(仅 url,title/provider 丢弃)
  open_hours     text,                        -- 本数据源恒 NULL(CSV 无 open_time),保留给后续城市
  tier           smallint NOT NULL DEFAULT 12, -- 可见最小 zoom(tier <= floor(zoom) 显示,tech/19 同语义)
  city_code      text NOT NULL DEFAULT '330100', -- 全国扩展分区预留
  source_file    text NOT NULL,               -- 溯源:'杭州市POI.csv'
  imported_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (lng_gcj BETWEEN 100 AND 130 AND lat_gcj BETWEEN 25 AND 35), -- 杭州粗略域
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  CHECK (tier BETWEEN 0 AND 21)
);

-- 空间查询:bbox && 裁剪(GCJ bbox 直匹配)
CREATE INDEX IF NOT EXISTS hz_pois_geom_gist ON hz_pois USING gist (geom);
-- 区县筛选
CREATE INDEX IF NOT EXISTS hz_pois_adname_idx ON hz_pois (adname);
-- 名称 ILIKE(关键词搜索)
CREATE INDEX IF NOT EXISTS hz_pois_name_trgm ON hz_pois USING gin (name gin_trgm_ops);
-- 分类筛选
CREATE INDEX IF NOT EXISTS hz_pois_big_type_idx ON hz_pois (big_type);
-- zoom 分层(tier <= floor(zoom))
CREATE INDEX IF NOT EXISTS hz_pois_tier_idx ON hz_pois (tier);
-- 排序/分页稳定(rating DESC, photos 数 DESC, poi_id)
CREATE INDEX IF NOT EXISTS hz_pois_rating_idx ON hz_pois (rating DESC NULLS LAST);
-- 全国扩展分区预留
CREATE INDEX IF NOT EXISTS hz_pois_city_code_idx ON hz_pois (city_code);

COMMENT ON TABLE hz_pois IS '杭州高德 POI 本地库(tech/22);geom 由 GCJ-02 生成以匹配浏览器 GCJ bbox';
COMMENT ON COLUMN hz_pois.tier IS '0..21 可见最小 zoom:zoom >= tier 时显示;0=永显,21=永隐(tech/19)';
COMMENT ON COLUMN hz_pois.photos IS '高德图床 URL 数组(从 CSV photos python-repr 提取,仅 url)';
