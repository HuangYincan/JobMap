# Merge Instructions(boss-agent 生成)— 轮 1 合并(ws-a → ws-b → ws-c)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish
- **本轮合并范围(按序)**:feature/tmap-poi(ws-a,tip 729c55f)→ feature/tmap-style-controls(ws-b,tip b9bbfe3)→ feature/baidu-ready-signal(ws-c,tip cdb1918)。
- 三个分支 boss 均已亲自复核(ws-a: 1145/1143 pass;ws-b: 1149/1147 pass;ws-c: 1140 pass;typecheck/docs-check/diff-check 全绿)。
- **tencent-engine.ts 段切分注意**:ws-a 改 marker/MultiMarker/icon 段,ws-b 改 style/scale/水印段 —— 合并时 git 按行合并,若冲突以「保留双方段落」为解(段落互不重叠)。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. 依次 `git merge --no-ff <branch>`;每个分支合并后跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停,记录哪个分支。
  3. 全部绿:`git push origin dev`;清理 worktree pa/pb/pc + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/ && git commit -m "chore: 20260822 boss tmap-polish 轮1入库(ws-a/b/c merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-polish/merge-report.md`,末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
