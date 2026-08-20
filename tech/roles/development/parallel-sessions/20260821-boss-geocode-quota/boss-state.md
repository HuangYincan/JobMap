# Boss State — 20260821-boss-geocode-quota

## meta
- slug: 20260821-boss-geocode-quota
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-geocode-quota
- goal: geocode:sites:apply 双配额耗尽时自动短路停止(不空跑)
- owner: boss-agent
- dev_tip: 83fc6d0(合并后)

## stage
- current: DONE
- updated_at: 2026-08-21

## 结论
- w1 fix/geocode-quota-short-circuit:MERGED_ALL,门禁 520 pass/2 skip,已 push(83fc6d0)
- 短路:连续 5 站配额类失败(quota/baidu-status:302/no-key)→ 汇总 + QUOTA_EXHAUSTED + exit 2;401 并发限流与网络错误不误停
- 用户实测触发背景:AMap place-text 100 次/天耗尽 + 百度 302;今日 geocode 实际写入 20 个 radar 文件(4b05e64 已入库)
- 后续优化(下一批):place-text (query,region) memo —— 同城同公司多站点复用,配额利用率数倍(20260821-boss-geocode-memo)

## workstreams
| ws | 主题 | 分支 | status | verdict |
|---|---|---|---|---|
| w1 | 配额短路 | fix/geocode-quota-short-circuit | MERGED | OK |

## recovery
- last_stage_written: DONE
