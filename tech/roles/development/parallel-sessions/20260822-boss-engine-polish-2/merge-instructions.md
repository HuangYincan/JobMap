# Merge Instructions(boss-agent 生成)— 轮 10 合并(ws-k + ws-l)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围**(按序):fix/tmap-icon-frame(ws-k,tip 最新,worktree /Users/acccan/dm-wt-tif)→ fix/baidu-blink(ws-l,tip 最新,worktree /Users/acccan/dm-wt-bbl)。
- boss 已亲自复核:npm test ws-k=1464 pass/0 fail/2 skip、ws-l=1465 pass/0 fail/2 skip;typecheck/docs-check/diff-check 全绿(两分支);真机验收:
  - ws-k:腾讯升级后徽章 = 白底 + #007AFF 边框 + 居中真 logo(fetch 字节内联;`<image href>` 远程直引实测不渲染);点击弹卡、zoom/pan 完整、AMap/Baidu 零回归;
  - ws-l:百度滚轮缩放 0 消失帧、0 往返瞬移帧(根因 = BMapGL SDK zoomstart/movestart/animation_start 隐藏 markerMouseTarget pane;修复 = 同事件恢复 + rAF 按帧重算);点击/reload/AMap/Tencent 零回归、console 0 error。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. `git merge --no-ff fix/tmap-icon-frame`;跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停。
  3. `git merge --no-ff fix/baidu-blink`;跑门禁。红则停(记录已合并分支)。
  4. 全绿:`git push origin dev`;清理 worktrees(tif/bbl)+ 两分支。
  5. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮10入库(ws-k tmap-icon-frame + ws-l baidu-blink merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`(追加轮10 段落),末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
