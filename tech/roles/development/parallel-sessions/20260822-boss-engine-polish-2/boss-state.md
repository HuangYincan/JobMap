# Boss State — engine-polish-2

## meta

- slug: 20260822-boss-engine-polish-2
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- goal: 用户 5 bug(百度卫星/深色、百度 POI、腾讯 POI 偏移、腾讯 POI 无 icon、腾讯/百度定位不真实)
- owner: boss
- decision: 全部技术类,直接派发 4 ws 并行

## stage

- current: MERGE(4 ws 全部 DONE+验证,派 merger)
- updated_at: 2026-08-22

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | fix/baidu-style | /Users/acccan/dm-wt-bs | prompts/ws-a.md | reports/ws-a.md | DONE | 262b49d | 轮1 | 2026-08-22 | OK(3 commits, 1379/1377 pass, boss 已验证) |
| b | fix/baidu-poi-locate | /Users/acccan/dm-wt-bp | prompts/ws-b.md | reports/ws-b.md | DONE | f77cad0 | 轮1 | 2026-08-22 | OK(3 commits, 1381/1379 pass, boss 已验证;POI 单点级核查三环节正确,定位改浏览器高精度) |
| c | fix/tencent-poi-icon | /Users/acccan/dm-wt-ti | prompts/ws-c.md | reports/ws-c.md | DONE | 171c544 | 轮1 | 2026-08-22 | OK(3 commits, 1384/1382 pass, boss 已验证;anchor=-offset 契约修正 + icon 候选链) |
| d | fix/tencent-locate | /Users/acccan/dm-wt-tl | prompts/ws-d.md | reports/ws-d.md | DONE | 2545985 | 轮1 | 2026-08-22 | OK(3 commits, 1375/1373 pass, boss 已验证) |
| e | fix/baidu-round2 | /Users/acccan/dm-wt-br2 | prompts/ws-e.md | reports/ws-e.md | DONE | 230ff5c | 轮2(boss 实测 follow-up) | 2026-08-22 | OK(3 commits, 1397 pass;2 基线失败=数据域 deferred;POI 根因=BMapGL v1.0 无 setContent 实锤) |

## 关键证据(2026-08-22)

- **bug 4 实锤**:favicon.im 403 + 无 CORS 头;icon.horse 实测 `access-control-allow-origin: *`(HTTP 200)→ TMap icon 候选链可行
- **bug 5 根因**:AMap=浏览器高精度;腾讯缺 enableHighAccuracy + maximumAge:60s 缓存;百度=SDK IP 定位
- **bug 1 嫌疑**:卫星常量 `BMAPGL_SATELLITE_MAP` 可能错误(BMapGL 用 BMAP_SATELLITE_MAP);深色无实现
- **bug 2**:百度聚合级正常;单点级待 worker 实测
- **bug 3 疑点**:聚合徽章 size/anchor 组合、状态尺寸 styleId 复用、content+icon 并存公式

## merge_order

轮1: ws-a → ws-b → ws-c → ws-d(并行开发,按序合并;baidu-engine.ts / tencent-engine.ts 段切分已隔离)。每轮 push origin/dev。

## next_plan

1. 轮1 派发(本 stage)
2. COLLECT → ADJUDICATE → MERGE(按序)→ push
3. Playwright 验证 5 bug 矩阵(百度卫星/深色、百度 POI 单点、腾讯 icon logo、腾讯偏移、三引擎定位)

## recovery

- last_stage_written: DISPATCH(轮1 派发)
- resume_history: —
