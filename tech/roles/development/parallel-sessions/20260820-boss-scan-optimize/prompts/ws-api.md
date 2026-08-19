# WS: ws-api — /api/pois/[id] 双重解码 500 + id 无长度上限(scan #7)

## 背景
2026-08-20 全库扫描发现:`server/src/app/api/pois/[id]/route.ts:19-20` 对 `await params` 的 rawId 再 `decodeURIComponent`——Next 动态段**已解码**,二次解码遇裸 `%`(如 `/api/pois/100%25`)抛 URIError → 公共端点返回 500;且 id 无长度上限,直接进缓存 key。

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-api)

1. **修复 server/src/app/api/pois/[id]/route.ts**:
   - 去掉二次 `decodeURIComponent`(Next 动态段已解码),或包 try/catch → 400
   - 加 id 长度上限(建议 256,超限 → 400)
2. **顺带排查同型问题**:`grep -rn "decodeURIComponent" /Users/acccan/dm-wt-api/server/src` ,其他动态段路由(如 /api/pois/search、/api/me/* [id] 段)若有同样双重解码一并修复(范围只限「解码/长度防御」,不扩展)。
3. **补测试**:畸形输入(裸 `%` id、超长 id)→ 400/404 而非 500。测试文件选 server/tests 下对应契约测试,或新建 route 契约测试(遵循现有测试风格:纯函数/静态契约优先)。

## 文件边界
server/src/app/api/** 相关 route + 相应测试。**不碰 map-shell/前端组件**。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-api && make docs-check
cd /Users/acccan/dm-wt-api/server && npm test
cd /Users/acccan/dm-wt-api/server && npm run typecheck
cd /Users/acccan/dm-wt-api && git diff --check
```

## 提交
Conventional Commits:`fix(api): pois/[id] 去掉双重解码,id 加长度上限` + 测试。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-scan-optimize/reports/api.md:
- 改动文件 + 每个 commit 摘要
- 畸形输入测试结果(400/404 而非 500)
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
