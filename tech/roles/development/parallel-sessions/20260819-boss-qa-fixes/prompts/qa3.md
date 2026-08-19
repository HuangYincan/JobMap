# ws-qa3 — #7 搜索缓存/无 bounds 上限 + #10 输入长度 + #11 通知冷却 + #12 saved 校验

## 背景

质量扫描(quality-scans/20260819-all/scan-report.md)四个后端/API 加固项:

- **#7 (Medium)**:`server/src/app/api/search/route.ts:38-64` — 无 bounds 搜索每次全量加载 3 张表(companies/sites/positions,全国 672 公司);缓存 key 含完整 `JSON.stringify(body.filters)` 无大小上限。
- **#10 (Low)**:`server/src/app/api/suggest/route.ts:32` + `search/route.ts:38` — q/center/filters 无输入长度上限;超长 q 进入全 catalog 匹配循环,超大 body 进缓存 key。
- **#11 (Low)**:`server/src/app/api/me/notifications/route.ts:13-36` — POST 无 body、无节流,可反复触发全量 job-alert 扫描 + enqueue。
- **#12 (Low)**:`server/src/app/api/me/saved/route.ts:33-39` — name/poiId 无长度上限,lng/lat 无范围校验。

## 修复方向(worker 自选实现,保持契约)

### #7 + #10 search/suggest 加固
- **输入上限**:`q ≤ 100` 字符(超限 400 或截断,worker 定并说明);body 大小限制(如 ≤ 64KB,超限 400);filters 深度/长度限制(如 JSON 序列化 ≤ 4000 字符)。
- **缓存 key 卫生**:key 组件统一截断(超长 q 在进 key 前已截断;filters 序列化限长)。
- **无 bounds 搜索**:保留语义(客户端视角无变化),但 pageSize 上限(如 ≤ 100)防全量大响应。

### #11 通知冷却
- POST `/api/me/notifications` 加冷却:同用户 60s 内重复 POST → 幂等返回上次结果(或 429,worker 选一说明);可用内存 Map(userId→lastAt)或 DB 时间戳(说明取舍)。

### #12 saved 校验
- `name`/`poiId` 长度上限(如 name ≤ 100、poiId ≤ 200);`lng ∈ [-180,180]`、`lat ∈ [-90,90]` 范围校验,非法 400。

## 测试(必做)

- 现有 tests 全绿;新增:超长 q → 400/截断;filters 超限 → 400;pageSize 超限;通知冷却(60s 内二次 → 幂等/429);saved lng/lat 越界 → 400。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-qa3)

- 只动:`server/src/app/api/search/route.ts`、`server/src/app/api/suggest/route.ts`、`server/src/app/api/me/notifications/route.ts`、`server/src/app/api/me/saved/route.ts`、`server/tests/*`(相关)
- **不碰**:`server/src/lib/account-store.ts`(ws-qa2)、`server/src/lib/spatial-query.ts`(ws-qa1)、`server/src/lib/modes.ts`/`api.ts`(ws-qa4)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-qa3/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-qa3 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-qa-fixes/reports/ws-qa3.md`:
改动文件 + 实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
