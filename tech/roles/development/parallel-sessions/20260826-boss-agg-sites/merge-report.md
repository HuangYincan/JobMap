# Merge Report — 20260826-boss-agg-sites

> 注:merger 会话在写本报告前被外部终止,但全部合并动作已完成且经 boss 逐项复验。
> 本文件由 boss 依据 logs/merge.log(空)、git 状态与亲跑门禁补写。

## 结果总览

- 分支 `fix/aggregate-site-fanout`(3 commit: 7a95f60 / 0e973e7 / 813c5fe)已 `--no-ff` 合并回 dev:
  merge commit **c2e5196**,已 push origin/dev(dev == origin/dev == c2e5196)。
- worktree `/Users/acccan/dm-wt-g-agg-sites` 与分支已清理(git worktree list 仅剩主树;分支无残留)。

## 门禁(boss 亲跑 VERIFY)

- 主树 `npm test`:**1677 tests / 1674 pass / 0 fail / 3 skip**(skip = DATABASE_URL 未设门控)。
- CI(run 32914940285,push c2e5196):**success**(59s,4 jobs 全绿)。
- worker 干净树自测同口径(1677/1674/0 fail),汇报见 reports/g-agg-sites.md(续作轮补齐)。

## 验收数字(boss 亲跑离线目录探针)

- POI 总数 **529 → 833**(+304,radar 多城饿死站恢复)。
- 腾讯:北京/上海/广州/**深圳** 各 1 POI × 3 聚合岗 —— 用户报告的「深圳腾讯没收录」修复。
- 字节跳动 7 城 / 美团 4 城 / 百度 4 城 / 京东 4 城 / 小米多城全部出现。

## 遗留

- 无。crawler 占位约定未动;specific 行精确归属不变;mode-cache 版本未动(内容变化走数据刷新)。

门禁: ALL_GREEN
结论: MERGED_ALL
