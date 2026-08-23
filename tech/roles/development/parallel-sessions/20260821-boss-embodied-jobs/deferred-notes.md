# Deferred Notes — 20260821-boss-embodied-jobs

> boss 自主裁决后记入的「需用户决策 / 不自动执行」项。任务全部完成后在最终总汇报中统一告知用户。

| # | 类型 | 内容 | 状态 |
|---|---|---|---|
| D1 | Env-only | `npm run import:seed:apply`(需 DATABASE_URL)把 embodied-jobs 数据落地 Postgres(含 sources 注册表行) | 待用户跑 |
| D2 | Env-only | AMap geocode(`npm run geocode:sites:apply`,需 AMAP_WEB_KEY)为 embodied-jobs 职场补坐标;海外城市(如 Toronto)预计无法 geocode,城市文本保留 | 待用户跑 |
| D3 | 口径 | 跨源同名公司(embj-* vs qqj-*/radar 等)在 catalog 层的统一去重,后续单独处理;本批次按先例:同名公司追加 positions 到现有 drop,不建重复 drop | 开放 |
