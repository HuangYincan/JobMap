# Batch Manifest — 20260821-boss-qqdoc-jobs

## 目标
腾讯文档投递链接岗位提取(用户指示「顺着投递链接来」):499 家投递链接 → 岗位,165 家新公司上地图 + 已有公司岗位补充。

## 结果(w1,续作后完成)
- qqdoc-jobs adapter 注册 + 提取脚本(飞书 ATS / 官网 HTML / robots 合规礼貌 ETL)
- **43 家公司 830 个岗位**(飞书 14 家 712 岗 + 官网解析 29 家 118 岗);写入 qqdoc-jobs 18 家 + radar 24 家 + official-career 1 家
- 合规:337/1200 请求预算;robots 拒绝平台(zhiye/weixin/mokahr/hotjob)合规跳过
- 门禁:npm test 591 pass/2 skip(基线 566 + 25)

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 投递链接岗位提取 | feat/qqdoc-jobs-source | /Users/acccan/dm-wt-qqj | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并后
- import:seed:apply(Env,boss 执行)→ 验证岗位入库 + 徽章
- push origin/dev;清理 worktree/分支
