# ws-api 汇报(2026-08-20)

scan #7:`/api/pois/[id]` 双重解码 500 + id 无长度上限。worktree `/Users/acccan/dm-wt-api`(分支 `fix/poi-id-route`,从 dev 切出,未 merge 未 push)。

## 实际改动

- `server/src/app/api/pois/[id]/route.ts`
  - 去掉二次 `decodeURIComponent`(已确认 Next router 层 `dist/server/lib/router-utils/decode-path-params.js` 对动态段做 decodeURIComponent 解码后才传给 handler;二次解码遇裸 `%`,如 `/api/pois/100%25` → `"100%"`,抛 URIError → 500)。现在直接用 `await params` 的已解码 id。
  - 新增 `const MAX_ID_LENGTH = 256`;`id.length > 256` → `{ code: 'ID_TOO_LONG', status: 400 }`,校验位于缓存 key 构造之前,超长 id 不进缓存。
  - 原契约保持:共享 catalog 查询 / 404 NOT_FOUND / publicCacheKey + read/write 缓存。
- `server/tests/api-hardening.test.mjs`(追加 2 条契约测试,沿用该文件 readFileSync + 正则静态契约风格)
  - `#7 pois/[id]: 不再二次解码(Next 动态段已解码),畸形 % 不 500`:断言路由内无 `decodeURIComponent(` 调用,且 loadServerCatalogById / 404 / writePublicCache / publicCacheKey 原契约保留。
  - `#7 pois/[id]: id 超长(>256)→ 400,且在缓存 key 之前拦截`:断言 MAX_ID_LENGTH=256、`id.length > MAX_ID_LENGTH`、`ID_TOO_LONG` + 400、guard 位置先于 `const cacheKey =`。

## 同型问题排查

`grep -rn "decodeURIComponent" server/src` 全库仅 `pois/[id]/route.ts` 一处;`server/src/app/api` 下动态段路由目录仅 `pois/[id]` 一个(`params` 仅在 `pois/[id]/route.ts` 使用)。无其他双重解码 / 无其他动态段路由需要长度防御,无需扩展。

## 门禁结果

- npm test: 490 通过 / 0 失败 / 2 skip(含新增 2 条 + 既有 `GET /api/pois/[id] contract` 测试均绿)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 畸形输入测试结果(静态契约断言)

- 裸 `%` id(`100%25` → 已解码 `"100%"`):不再二次解码 → 不抛 URIError → 不 500;catalog miss → 404。测试断言路由内无 decodeURIComponent 调用。
- 超长 id(>256):`ID_TOO_LONG` → 400,且在缓存 key 构造之前拦截。
- 本环境禁止启动 dev server / 单独 node -e,未能做 HTTP 层 curl 实跑;验证方式为仓库既有契约测试模式(route 无法被 node:test 直接 import,tsconfig paths 仅 bundler 解析,全仓 route 测试均走静态契约)。

## 遇到的问题

- dev server(`npx next dev`)/ 临时 `node -e` 被环境拒绝执行 → 改用既有静态契约测试风格作为验证手段(与全仓 route 测试约定一致);如需 HTTP 实跑证据可后续在能起 dev server 的环境复核。

## 提交(分支 fix/poi-id-route,共 2 个)

- `ab656bd` fix(api): pois/[id] 去掉双重解码,id 加长度上限
- `ba69de1` test(api): pois/[id] 畸形输入契约测试(裸 % 不 500、超长 id 400)

门禁: PASSED
结论: OK
