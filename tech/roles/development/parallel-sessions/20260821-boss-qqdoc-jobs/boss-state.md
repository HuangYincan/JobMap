# Boss State — 20260821-boss-qqdoc-jobs

## meta
- slug: 20260821-boss-qqdoc-jobs
- date: 2026-08-21
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-qqdoc-jobs
- goal: 腾讯文档投递链接岗位提取(用户指示「顺着投递链接来」)
- owner: boss-agent
- dev_tip: a6079cc(合并后)

## stage
- current: DONE
- updated_at: 2026-08-21

## 结论
- w1 feat/qqdoc-jobs-source:MERGED_ALL(a6079cc),门禁 591 pass/2 skip
- 岗位提取:43 家公司 830 个岗位(飞书 ATS 14 家 712 岗 + 官网解析 29 家 118 岗);写入 qqdoc-jobs 18 + radar 24 + official-career 1
- 合规:337/1200 请求;robots 拒绝平台(zhiye/weixin/mokahr/hotjob)合规跳过
- import:**993 家 / 2264 站点 / 12285 岗位**;徽章 106 POI(杭州 28)
- 中途:第一 worker 异常中断 → 续作重派(对账后完成);merger 清理了主树残留产物

## workstreams
| ws | 主题 | 分支 | status | verdict |
|---|---|---|---|---|
| w1 | 投递链接岗位提取 | feat/qqdoc-jobs-source | MERGED | OK |

## 后续
- 剩余 456 家投递链接未提取(飞书 712 岗已吃大头;zhiye/mokahr/hotjob robots 拒绝为合规结果,不可强求)
- 新公司坐标:qqdoc-jobs 165 家多为多城市字符串,坐标待 geocode(100 配额瓶颈)

## recovery
- last_stage_written: DONE
- resume_history: w1 第一 worker 中断 → 续作重派(2026-08-21)
