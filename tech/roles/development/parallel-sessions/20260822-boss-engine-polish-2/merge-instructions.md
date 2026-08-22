# Merge Instructions(boss-agent 生成)— 轮 9 合并(ws-j)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围**:fix/tmap-mixed-block(ws-j,tip da4a5fe,worktree /Users/acccan/dm-wt-tmb)。
- ws-j boss 已亲自复核:1461 pass/0 fail/2 skip(实测 npm test 复验)+ typecheck 绿;根因 = 腾讯矢量底图 POI 图标层(light 样式,裸地图对照决定性);修复 = styleToBaseMap 排除 point(保留地名/路名标注);真机验收 3 混合块消失/点击弹卡/缩放 pan/reload×3 全过/AMap Baidu 零回归。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/tmap-mixed-block`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停。
  3. 全绿:`git push origin dev`;清理 worktree tmb + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮9入库(ws-j tmap-mixed-block merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`(追加轮9 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
