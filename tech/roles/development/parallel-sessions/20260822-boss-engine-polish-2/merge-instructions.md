# Merge Instructions(boss-agent 生成)— 轮 1 合并(ws-a → ws-b → ws-c → ws-d)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- **本轮合并范围(按序)**:fix/baidu-style(ws-a,tip 262b49d)→ fix/baidu-poi-locate(ws-b,tip f77cad0)→ fix/tencent-poi-icon(ws-c,tip 171c544)→ fix/tencent-locate(ws-d,tip 2545985)。
- 四个分支 boss 均已亲自复核(ws-a: 1379/1377 pass;ws-b: 1381/1379 pass;ws-c: 1384/1382 pass;ws-d: 1375/1373 pass;typecheck/docs-check/diff-check 全绿)。
- **baidu-engine.ts 双改注意**:ws-a 改 STYLE_CONSTANT/applyMapStyle/setStyle 段,ws-b 改 POI/content/icon/定位段 —— 段落互不重叠,冲突以「保留双方段落」为解。
- **tencent-engine.ts 双改注意**:ws-c 改 marker/icon/anchor 段(anchor=-offset 契约修正),ws-d 改 getCurrentPosition/browserPosition 段 —— 段落互不重叠,冲突保留双方。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. 依次 `git merge --no-ff <branch>`;每个分支合并后跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停,记录哪个分支。
  3. 全部绿:`git push origin dev`;清理 worktree bs/bp/ti/tl + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/ && git commit -m "chore: 20260822 boss engine-polish-2 轮1入库(ws-a/b/c/d merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/merge-report.md`,末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
