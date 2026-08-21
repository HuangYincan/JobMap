# Batch Manifest — 20260821-boss-tencent-geocode

## 目标
用户要求接上腾讯第三级兜底(AMap → 百度 → 腾讯),缓解 place-text 100 次/天 + 百度 302 配额瓶颈。

## 结果(w1)
- 腾讯实现主体已由并行批次 feature/geocode-tencent 合入 dev(21c430e)
- 本批补缺口:site-geocode.test.mjs 三端点网络失败路径测试(7358a13)
- **key 真实验证:2 次请求返回 status 121(每日调用量已达上限)—— key 有效、配额类映射 121 短路兼容(今日腾讯配额也满)**
- 门禁:npm test 1027 pass/0 fail/2 skip;docs-check 红 = dev 既有问题(agent-thinkfix merge-report 自匹配,非本批)

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 腾讯兜底测试缺口 | feat/geocode-tencent-fallback | /Users/acccan/dm-wt-tgc | reports/w1.md | DONE(npm test 绿;docs-check 既有问题已注明) |

## 合并后
- push origin/dev;清理 worktree/分支
