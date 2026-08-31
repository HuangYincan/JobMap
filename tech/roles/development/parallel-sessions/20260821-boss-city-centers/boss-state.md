# Boss State — 20260821-boss-city-centers

## meta
- slug: 20260821-boss-city-centers
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-city-centers
- goal: 「前端看不到」残余修复 —— CITY_CENTERS 补全 + 省前缀归一,有岗位公司全部上地图
- owner: boss-agent
- dev_tip: e1c9e24(合并后,已 push)

## stage
- current: DONE
- updated_at: 2026-08-21

## 结论
- city-centers 31→86 城(大陆 41 + 海外 14);省前缀剥离归一(广西柳州→柳州)
- 重跑拆分:16 文件 95 补点 + 1 拆分;东风柳汽获坐标 109.41/24.32
- **附带修复 dev 既有回归**:embodied-jobs industries 缺失(983b161 遗留,6 test fail)→ 适配器归一化(industriesOf(name)+ scale 缺省),47 个 embj-* drops 零 issues
- 门禁:**754 pass / 0 fail / 2 skip**;docs-check 红仅并发批次未跟踪报告(已记录不计)
- import:1040 家 / 2351 站点 / 12285 岗位;**东风柳汽 POST 搜索验证成功**
- merge 历程:首轮 merger 红停(既有回归)→ fix worker → merger 幂等续跑 → MERGED_ALL + push 全量

## workstreams
| ws | 主题 | 分支 | status | verdict |
|---|---|---|---|---|
| w1 | 城市中心补全 + 省前缀归一 | fix/city-centers-extend | MERGED | OK(红停后修复续跑) |

## recovery
- last_stage_written: DONE
- resume_history: merger 红停(embodied-jobs 回归)→ fix followup → merger 幂等续跑
