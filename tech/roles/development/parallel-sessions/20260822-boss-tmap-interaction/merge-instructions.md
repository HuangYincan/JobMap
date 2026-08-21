# Merge Instructions(boss-agent 生成)— 轮 1 合并(ws-a → ws-b → ws-c → ws-d)

- 批次目录:/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction
- **本轮合并范围(按序)**:fix/tmap-poi-interaction(ws-a,tip e2e292f)→ fix/tmap-wheel-switch(ws-b,tip 7478142)→ fix/baidu-diagnostics(ws-c,tip 8d5cee4)→ fix/geolocation-blue-dot(ws-d,tip 7c8032a)。
- ws-a/ws-b/ws-c/ws-d boss 均已亲自复核(ws-a: 1261/1259 pass;ws-b: ~1260 pass;ws-c: 1270/1268 pass;ws-d: 1275/1273 pass;typecheck/docs-check/diff-check 全绿)。
- **tencent-engine.ts 段切分注意**:ws-a 改 marker/MultiMarker/anchor/click 段,ws-b 改 Map 构造/相机/滚轮段 —— 合并时 git 按行合并,若冲突以「保留双方段落」为解(段落互不重叠)。
- **use-map-engine.ts 双改注意**:ws-b 与 ws-c 都碰 use-map-engine.ts(ws-b 错误路径/switch 相关,ws-c 错误路径/诊断 UI)—— 若冲突,以「保留双方修改」为解,必要时人工合并错误路径段。
- 执行:
  1. `git switch dev && git pull --ff-only origin dev`;`git status --short` 主树干净。
  2. 依次 `git merge --no-ff <branch>`;每个分支合并后跑门禁(`cd server && npm test && npm run typecheck`;`make docs-check`;`git diff --check`)。红则停,记录哪个分支。
  3. 全部绿:`git push origin dev`;清理 worktree ia/ib/ic/id + 分支。
  4. 批次目录入库:`git add tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/ && git commit -m "chore: 20260822 boss tmap-interaction 轮1入库(ws-a/b/c/d merge-report + 汇报)"`。
- 若中途被 API 402 打断:退出说明进度;boss 会恢复你,恢复后先对账(已合并跳过)。
- 写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/merge-report.md`,末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
