# Workstream d-local-fallback — domain-local DB 故障不得伪装成「成功空结果」

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-d-local-fallback`,分支 `fix/local-poi-db-fallback`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(根因已由 Explore 确认)

链路:`loadHangzhouPoisFromDb`(server/src/lib/hz-poi-store.ts:128-178,**出错返回 null 不 throw**,:174-177 `catch { // 表缺失 / 连接错误 → 走回退; return null; }`,另 :137 `if (!pool) return null`)→ domain-local route(server/src/app/api/pois/domain-local/route.ts:77-84 调用)→ :86-99 **把 null 抹平成 200 `{ total: 0, results: [] }`**(payload 恒有 `?? 0`/`?? []` 兜底,成功才 writePublicCache :95-98)→ 前端 fetchLocalPois(poi-service.ts:238-301)`:263 if (!res.ok) throw` 对 200 放行 → 浏览路径(poi-service.ts:200-207)`const local = await fetchLocalPois(...); return local ?? { pois: existing };` 中 **local 恒非 null**(500 空页时 `mergePoisById(existing, [], cap)` 恒等于 existing)→ 高德回退与错误信号全部失效:DB 短暂故障显示空白,而非回退 AMap。

注意:合法空结果(该区域确实无 POI)的 `{ total, offset, limit, results: [] }` 与 null 在 hz-poi-store 侧**是可区分的**(null = 失败,{results:[]} = 真空)),route 侧应保持这种区分并传播。

## 任务(仅本 WS 范围)

### 1. `server/src/app/api/pois/domain-local/route.ts`

- `result === null` 时**不要**返回 200 空结果:返回 `NextResponse.json({ error: 'local_db_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })`(状态码若项目内其他疑似「依赖故障」分支有惯例(如 503),跟随惯例并在汇报说明;优先 502 表示上游依赖故障)。
- 成功路径(readPublicCache 命中 / 查库成功)行为完全不变(含 writePublicCache、Cache-Control no-store 等)。
- 真空结果(查库成功但 results: [])仍 200 —— 不要一刀切。

### 2. `server/src/lib/poi-service.ts` — 验证回退链,不必要则不改

读 :238-301 确认:route 502 → `!res.ok` → throw → catch 分支(:273-300):有 q → return null(触发高德 searchPOI 关键词兜底);浏览 → console.warn + viewportFallbackSearch(高德兜底),兜底再失败才 throw。**该链已正确,只需验证**,除非发现 502 在某分支落进意外路径(此时最小修复 + 汇报说明)。外层 fetchPOIsForMode 对抛错的最终处理也顺带确认(产品语义:浏览路径最终不应以 500 呈现给用户;若外层会让出错透传成 500,给出最小兜底并汇报)。

### 3. 测试

- `server/tests/api-hardening.test.mjs`(:189-200 `#12 domain-local` 现有源码契约保持):补断言——route 对 `result === null` 分支返回非 2xx(status 502/503 形态)且该分支不写缓存(遵循该文件现有 grep/契约风格,注意它不 import route,是源码级断言)。
- `server/tests/poi-service.test.mjs`(现有 :104-123 是 fetch 直接 throw 的用例):新增「route 返回 `{ ok: false, status: 502 }` → 浏览路径走高德兜底不抛错(或按现有 catch 语义返回正确形态)、关键词路径 return null 触发 searchPOI」的用例;现有用例全保持。
- `server/tests/hz-poi-store.test.mjs`(:160-167 查库失败 → null 保持):若 hz-poi-store 未改则不动;若你判断需要区分「真空」与「失败」的更强表达而改动,必须保持 null 语义兼容并说明。

## 文件边界

**拥有**:server/src/app/api/pois/domain-local/route.ts、(如确有必要)server/src/lib/poi-service.ts、server/src/lib/hz-poi-store.ts、tests/{api-hardening,poi-service,hz-poi-store}.test.mjs。

**不碰**:server/src/components/map-shell.tsx、server/src/hooks/**、server/src/lib/{map-markers,viewport-search,search}.ts、map-engine/**、其他 app/api route。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-d-local-fallback/server && npm test
cd /Users/acccan/dm-wt-d-local-fallback/server && npm run typecheck
cd /Users/acccan/dm-wt-d-local-fallback && make docs-check && git diff --check
```

## 提交

小步高频,Conventional Commits(`fix(domain-local): DB failure → 502 instead of fake empty 200`、`test(domain-local): fallback chain cases`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-poi-marker-resilience/reports/d-local-fallback.md`,含改动摘要、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
