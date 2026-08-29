# Seed 示例数据归档(2026-08-26)

本目录是 Domain Map 旧「本地示例数据」的**唯一归档地**。运行时已不再引用;POI 数据一律从数据库获得。

## 归档内容

| 文件 | 说明 |
|---|---|
| `seed-data.ts` | **原始源文件逐字拷贝**(含 `withWorkDefaults` 变换逻辑与全部注释)。 |
| `domain-seed.json` | `DOMAIN_SEED` 的最终形态(9 个杭州地标)。`JSON.stringify` 导出,`undefined` 字段被丢弃。 |
| `work-seed.json` | `WORK_SEED` 的最终形态(50 家杭州公司,`withWorkDefaults` 应用后:`sites` 已合成、logo 已解析、`mode='work'`、taxonomy 已补齐)。`JSON.stringify` 导出。 |

`INTERNSHIP_SEED` 在旧代码中是 `WORK_SEED` 的别名,数据即 `work-seed.json`。

## 为什么移除(背景)

Phase 2 采用「先精选数据、后接数据库」策略:`seed-data.ts` 是杭州地区知名科技公司的公开位置信息 + **代表性示例岗位**(非实时爬取,注释原文「岗位为代表性示例(非实时爬取)」)。

2026-08-26 起数据库已是权威数据源(实测:`companies` 1040 / `company_sites` 2351 / `positions` 12322 / `hz_pois` 1,006,158)。用户决策:
1. **严格 DB-only** — 无 DATABASE_URL / DB 宕机时工作模式公开列表返回 502,不再回退 seed 离线目录,也不把故障缓存成空列表(domain 仍可走高德实时兜底)。
2. **seed 一并移除导入** — 不再作为灌库数据源(`import:seed` 不再含这 50 家);DB 里已存在的行保留不动。

## 它曾经的用途(历史)

- `DOMAIN_SEED`:domain 模式的服务端兜底(`/api/pois?mode=domain`、`serverCatalog('domain')`)。
- `WORK_SEED` / `INTERNSHIP_SEED`:
  - 工作模式离线目录(`loadOfflineWorkCatalog`)的坐标骨架;
  - `seedRecruitmentAdapter` 灌库(把 50 家公司写入 `companies` / `company_sites`);
  - 前端兜底查找(`map-shell.tsx` 收藏/最近/投递引用、`use-search-state.ts` 建议池);
  - 测试 fixture(见 `server/tests/fixtures/seed-data.ts`,读本目录 JSON)。

## 如需恢复

- 重新灌库:从 `work-seed.json` 构造 `SourceCompany`(形状见 `server/src/lib/recruitment-source.ts` 的 `poiToSourceCompany`),喂给 `planRecruitmentImport` → `applyRecruitmentImport`。
- 恢复离线兜底:需同时恢复 `server-catalog.ts` 的 `loadOfflineWorkCatalog` 与 `recruitment-adapters/seed.ts`(已删除,见 git 历史)。
