-- 016_site_key.sql
-- 站点合并键:drop 的 site.id → company_sites.site_key。
-- 2026-08-19:import 曾按 (company_id, name) 合并站点,多城市公司每家站点同名
-- (得物×5 都叫「得物」)全部折叠进一行,city/坐标互相覆盖(试点 9 家区级错配)。
-- 之后站点按 (company_id, site_key) 合并,同名不同城市互不干扰。

ALTER TABLE company_sites ADD COLUMN IF NOT EXISTS site_key text;

CREATE UNIQUE INDEX IF NOT EXISTS company_sites_company_site_key_idx
  ON company_sites (company_id, site_key) WHERE site_key IS NOT NULL;
