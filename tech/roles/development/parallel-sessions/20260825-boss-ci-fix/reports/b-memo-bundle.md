# b-memo-bundle 汇报(2026-08-25)

## 实际改动
- `server/src/lib/site-geocode.ts` → memo 持久化路径 bundle 安全化:
  - 删除顶层 `export const PLACE_SEARCH_MEMO_FILE = new URL('../../.geocode-memo.json', import.meta.url).pathname;`(Turbopack 资产引用静态解析的根因)。
  - 改为惰性函数 `export function placeSearchMemoFile(): string { return join(process.cwd(), '.geocode-memo.json'); }`(新增 `import { join } from 'node:path'`),注释写明 cwd 契约(geocode 脚本 `npm run geocode:sites:*` / `make geocode-sites` 均 `cd server`,Next server runtime `next dev/start` 也以 server/ 为 cwd → 解析结果 = `server/.geocode-memo.json`,语义不变)。
  - `placeSearchMemoPersist` / `placeSearchMemoLoad` 默认参数 `PLACE_SEARCH_MEMO_FILE` → `placeSearchMemoFile()`(默认值按调用期求值)。调用方零改动:`PLACE_SEARCH_MEMO_FILE` 全仓仅本文件使用;脚本/测试均用显式 filePath 或纯内存 memo。
- `server/tests/geocode-place-memo.test.mjs` → 新增回归测试 `placeSearchMemoFile: 默认路径 = cwd/.geocode-memo.json (调用期求值, 无顶层资产解析)`(导入 `join` + `placeSearchMemoFile`)。
- `tech/29-geocode-r5-status.md` → 未动:经查该文档无 memo 持久化文件路径描述(「无则不动」)。

## 门禁结果
- `npm run build`(Turbopack,CI 同款):**环境级 fatal panic,无法在本 worktree 运行** —— 详见「遇到的问题」#1(非代码问题,A/B 证明与源码无关)。
- `npm run build -- --webpack`(等效静态资产解析门禁):**通过** —— `✓ Compiled successfully in 4.8s`,static pages 29/29,route 表完整(含 `/api/agent/chat`)。
  - **A/B 证明(此门禁是真门禁)**:临时把旧行 `new URL('../../.geocode-memo.json', import.meta.url)` 加回模块顶层 → webpack build 立即失败:
    ```
    Import trace for requested module:
    ./src/lib/agent/mcp-endpoints.ts → ./src/lib/agent/mcp-providers.ts → ./src/app/api/agent/chat/route.ts
    > Build failed because of webpack errors
    ```
    (与 CI 的 `Can't resolve '../../.geocode-memo.json'` 同类失败)。移除后恢复绿色。
- `npm test`: **1665 通过 / 0 失败**(1668 total,3 skip;含新增 memo 路径测试)。
- `npm run typecheck`: 通过(tsc --noEmit 无错误)。
- `make docs-check`: 通过(Documentation policy check passed)。
- `git diff --check`: 通过(exit 0)。

## 遇到的问题
1. **Turbopack 无法在本 worktree 运行(环境,非代码)**:
   - boss 预建的 worktree 中 `server/node_modules` 是指向主仓的 symlink(`readlink` → `/Users/acccan/Repos/huangyincan/domain-map/server/node_modules`)。Turbopack 16.3.1 对「node_modules 指向 project root 之外」的 symlink 是 **fatal panic**:
     ```
     FATAL: An unexpected Turbopack error occurred ...
     Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid, it points out of the filesystem root
     ```
   - 该 panic 发生在**工程初始化阶段**(`directory_tree_to_entrypoints_internal → try_get_next_package → resolve → find_package`),早于任何源码解析;与本次代码改动无关(webpack 后端正常走通同代码,未改任何配置;禁用沙箱重跑结果相同)。
   - 结论:任何代码状态(包括未改的 dev)在本 worktree 都跑不了 Turbopack build;CI(GH Actions,npm ci 实体化 node_modules)不受此影响。
   - 建议 boss 三选一:(a) 在 worktree 实体化 node_modules(cp 主仓实体;工作量 ~1-2GB 复制);(b) 合并后以 boss VERIFY 步骤 `gh run` 看 CI 真实结果为准(推荐——修复本质是消灭了该模块内所有相对 `new URL(..., import.meta.url)` 模式,webpack 同语义静态解析已 A/B 证实);(c) boss 在主仓(实体 node_modules)上临时 check 出本分支跑 `npm run build` 复核。
2. **顺带排查同类模式**:`grep -rn "new URL(" server/src/lib server/src/app --include="*.ts"` 共 40 处,全部为**运行时绝对 URL 构造**(`https://restapi.amap.com/...`、`new URL(request.url)`、OAuth 回调拼接等),无其它「相对路径 + import.meta.url」顶层资产引用模式;唯一风险点即已修复的 site-geocode.ts:601。无需其它改动。

## 证据
- 修复后模块状态:`grep -n "import.meta.url" server/src/lib/site-geocode.ts` → 仅注释提及(603 行),无代码模式。
- webpack build 全量输出(成功,含完整 route 表 + static 29/29);A/B 失败输出见上;npm test 尾行:`ℹ tests 1668 / ℹ pass 1665 / ℹ fail 0 / ℹ skipped 3`。
- 提交:`e7ad16a` fix(site-geocode): memo 路径调用期求值…;`5163838` test(site-geocode): 默认 memo 路径 = cwd/.geocode-memo.json。分支 `fix/geocode-memo-bundle-safe` 留原地,未 merge、未 push。

门禁: FAILED
结论: BLOCKED: 本 worktree 内 Turbopack `npm run build` 因 boss 预建的 node_modules symlink(出 project root)panic 无法运行——代码修复已完成并经 webpack 等效门禁 + A/B + 1665 测试验证,需 boss 实体化 node_modules 或合并后以 CI VERIFY 仲裁
