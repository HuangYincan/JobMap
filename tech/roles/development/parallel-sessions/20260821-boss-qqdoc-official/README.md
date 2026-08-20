# Batch Manifest — 20260821-boss-qqdoc-official

## 目标
腾讯文档官方招聘平台源落地:144 家央企/银行/国企(用户提供的高质量源)入库 + 官网地址提取。

## 结果(w1)
- qqdoc-official adapter 注册(142 家,import plan 0 issue)
- 官网地址提取:92 家真实城市 / 19 家街道地址 / 50 家 pending;合规:第三方平台 0 请求、robots 先行
- 门禁:npm test 555 pass/2 skip(基线 536 + 19)

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | qqdoc 源落地 + 官网地址提取 | feat/qqdoc-official-source | /Users/acccan/dm-wt-qqdoc | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并后
- import:seed:apply(Env,boss 执行)→ 验证 142 家入库
- push origin/dev;清理 worktree/分支
