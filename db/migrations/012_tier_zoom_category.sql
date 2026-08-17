-- 012_tier_zoom_category.sql
-- tier 语义修订(2026-08-17,tech/18 §2.2 + tech/19):
--   原:1=名企 2=大厂 3=中厂/其他(档位分组,LOD 按三档过滤)
--   新:0..21 = 「可见最小 zoom」——zoom >= tier 时显示(SQL 过滤 tier <= zoom 不变);
--       0=一直可见(国际化名企),21=永不显示(隐藏标记),缺省 12=未打标按小厂。
-- 新增 companies.category:企业类型,国标 GB/T 4754-2017 大类 code
--   (如 64=互联网和相关服务,39=计算机通信电子;'other'=未标)。
-- 幂等:可重复执行。

ALTER TABLE companies ALTER COLUMN tier SET DEFAULT 12;
COMMENT ON COLUMN companies.tier IS
  '0..21 可见最小 zoom:zoom >= tier 时显示;0=永显,21=永隐,缺省 12(tech/19)';

ALTER TABLE companies ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
COMMENT ON COLUMN companies.category IS
  '企业类型:国标 GB/T 4754-2017 大类 code(如 64=互联网,39=电子);other=未标(tech/19)';
