# 批次 Manifest — 20260825-boss-ci-fix(CI 修复:site-geocode memo 文件 bundled 破坏 Next build)

目标:CI(frontend job,`next build`)全红,根因 = `server/src/lib/site-geocode.ts:601` 模块顶层
`new URL('../../.geocode-memo.json', import.meta.url)`,该文件 gitignored,CI 构建环境不存在;
site-geocode.ts 经 `src/lib/agent/tools/rest-fallback.ts`(→ `app/api/agent/chat/route.ts`)进入
Next 打包图,Turbopack 静态解析相对路径资产失败 → **每次 push 的 build 都红**。

> ⚠️ 这与本批次(20260825-boss-hi-priority-fixes)代码无关:CI 在 3d40a31(2026-08-25 08:08Z)
> 即已红(第 1 个失败 run),根因在更早的 geocode 系列批次 `fix/geocode-persist-memo`
> (a2c6d47/3dba0fa)引入的该 URL 行。

## Workstream(1 个)

| ws | 分支 | worktree | 主题 | 合并顺序 |
|---|---|---|---|---|
| b-memo-bundle | fix/geocode-memo-bundle-safe | /Users/acccan/dm-wt-b-memo-bundle | site-geocode memo 路径 bundle 安全化(Next build 恢复绿) | 1 |

门禁(要 CT 绿,`npm run build` 必须真跑):`cd server && npm run build` + `npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/b-memo-bundle.md,末两行 token。Worker 不 merge、不 push、不碰主树。

## 不做
- 不改 memo 持久化语义(只缓存成功命中,失败/配额失败不写盘)。
- 不改 agent route / rest-fallback 结构(除非 build 暴露新的独立错误,最小修复并汇报)。
- 不跑任何 geocode REST / DB 写。
