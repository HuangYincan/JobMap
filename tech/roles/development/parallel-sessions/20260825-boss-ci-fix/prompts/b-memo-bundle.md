# Workstream b-memo-bundle — site-geocode memo 路径 bundle 安全化(CI build 修复)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-b-memo-bundle`,分支 `fix/geocode-memo-bundle-safe`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(根因已定位,CI 全红)

CI frontend job(next build)失败,全部 5 个近期 run 同因:

```
Error: Turbopack build failed with 1 error:
./src/lib/site-geocode.ts:601:39
Error: Module not found: Can't resolve '../../.geocode-memo.json'
Import trace: ./src/lib/site-geocode.ts → ./src/lib/agent/tools/rest-fallback.ts → ./src/app/api/agent/chat/route.ts
```

`server/src/lib/site-geocode.ts:601`(fix/geocode-persist-memo,a2c6d47 引入):

```ts
/** 默认持久化文件 (server/.geocode-memo.json, 已 gitignore). */
export const PLACE_SEARCH_MEMO_FILE = new URL('../../.geocode-memo.json', import.meta.url).pathname;
```

- 模块顶层静态 `new URL(相对路径, import.meta.url)` 是 Turbopack 的「资产引用」模式 → 构建期静态解析;`.geocode-memo.json` 已 gitignore,CI checkout 无此文件 → Module not found。
- site-geocode.ts 本为 scripts/Node 工具链 lib,但因 `agent/tools/rest-fallback.ts` 导入,进入 Next 打包图(agent chat route)。
- 使用面(已核对,极小):仅 `site-geocode.ts:611/622` 作默认参数(`filePath = PLACE_SEARCH_MEMO_FILE`,默认值按调用期求值);**无脚本/测试引用该导出**(tests/geocode-place-memo 等用显式 filePath 或纯内存 memo)。
- 运行时语义:脚本(cwd = server/)与 Next server runtime(cwd = server/)下期望路径均为 `server/.geocode-memo.json`。

## 任务

### 1. `server/src/lib/site-geocode.ts` — memo 路径 bundle 安全化

- **目标**:模块内不再存在「相对路径 + `import.meta.url` 的顶层 `new URL`」静态模式;路径在**调用期**计算,脚本与 Next server runtime 下都解析为 `server/.geocode-memo.json`。
- 建议实现(以你读代码为准,保持现有风格):
  - `import { join } from 'node:path';`
  - 把导出改为惰性函数(或调用期求值的 getter),如 `export function placeSearchMemoFile(): string { return join(process.cwd(), '.geocode-memo.json'); }`(cwd 契约:本项目 scripts/next 均以 server/ 为 cwd,注释写明);`placeSearchMemoPersist`/`placeSearchMemoLoad` 默认参数改为 `filePath = placeSearchMemoFile()`。
  - **不要**保留任何 `new URL('...', import.meta.url)` 相对路径模式(即使包在 try/catch 里——Turbopack 静态分析可能仍触发;以 `npm run build` 实测为准,但优先直接消灭该模式)。
  - 若发现 `process.cwd()` 在某调用路径不保证 server/(如 repo root 直跑),选用更稳的方案(如 `fileURLToPath(new URL(...))` 动态拼接、或探测两个候选路径取先存在者)并在汇报说明取舍;`npm run build` + 现有测试是硬门禁。
- 同步更新该常量/函数处注释(语义不变:server/.geocode-memo.json,已 gitignore)。

### 2. 顺带排查同类模式

- `grep -rn "new URL(" server/src/lib server/src/app --include="*.ts"` —— 若存在其它「gitignored/非打包资产」的相对路径 `new URL(..., import.meta.url)` 顶层用法,同类最小修复(或证实安全)。只处理确有风险的,不做无关重构。

### 3. 测试与文档

- 若 memo 持久化有既有测试,确认新路径求值不破坏(现有测试用显式 filePath,应为零改动);必要时补一个「默认路径 = cwd/.geocode-memo.json」的断言(风格跟随 geocode-place-memo.test.mjs)。
- tech/29-geocode-r5-status.md 若有 memo 持久化描述,同步一句路径求值变化(文档反映可验证事实);无则不动。

### 4. 门禁(必须真跑,特别注意 build)

```bash
cd /Users/acccan/dm-wt-b-memo-bundle/server && npm run build
cd /Users/acccan/dm-wt-b-memo-bundle/server && npm test
cd /Users/acccan/dm-wt-b-memo-bundle/server && npm run typecheck
cd /Users/acccan/dm-wt-b-memo-bundle && make docs-check && git diff --check
```

> `npm run build` 是修复是否成立的核心证据(CI frontend job 同款);若 build 还报**其他**错误(存量的、或与本修复无关的),一并最小修复(属本 fix 批次范围——CI 绿才算完),无法判断的在汇报「遇到的问题」里说明。

## 文件边界

**拥有**:`server/src/lib/site-geocode.ts`、(顺带排查发现需要修的同类文件)、`server/tests/geocode-place-memo.test.mjs`(如需要)、tech/29(如需要)。

**不碰**:`server/src/lib/agent/**` 结构、`server/src/lib/{recruitment-store,server-catalog,mode-cache,map-markers}.ts`、`server/src/components/**`、`server/scripts/**` 逻辑、`server/.env*`、主树。

## 提交

小步高频,Conventional Commits(`fix(site-geocode): memo 路径调用期求值 — 消除顶层 new URL 资产解析, Next build 恢复`、`test(site-geocode): 默认 memo 路径 = cwd/.geocode-memo.json`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-boss-ci-fix/reports/b-memo-bundle.md`,含改动摘要、**npm run build 结果**、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
