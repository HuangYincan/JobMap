# d-local-fallback 汇报(2026-08-25)

WS: `fix/local-poi-db-fallback`(worktree `/Users/acccan/dm-wt-d-local-fallback`,起点 `3021da3`)
任务:domain-local DB 故障不得伪装成「成功空结果」。

## 实际改动

- `server/src/app/api/pois/domain-local/route.ts`
  - `result === null`(库故障/表缺失)不再返回 200 空 payload,改为
    `NextResponse.json({ error: 'local_db_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })`,
    且不进入 writePublicCache(故障响应不得被缓存掩盖恢复)。
  - 成功路径(readPublicCache 命中 / 查库成功,含真空 `results: []`)行为完全不变
    (写缓存 + `PUBLIC_CACHE_CONTROL`)。
  - 文件头注释同步:无库/表缺失 → 502(原「→ { total:0, results:[] }」文案已非事实)。
  - 状态码说明:项目内既有 503 均属「未配置/凭据缺失」类(LLM_UNCONFIGURED、
    OAUTH_NOT_CONFIGURED、auth/otp 服务不可用),与「上游 DB 依赖故障」不同类;
    按 prompt 主指令采用 502(网关角色、上游故障),测试按 prompt 要求断言 502/503
    形态(实际断言精确 502)。
- `server/src/lib/poi-service.ts` — **未改**(验证结论:回退链已正确)
  - 502 → `!res.ok` → throw → catch(:273-300):关键词路径 `return null` → 外层
    fetchDomainPOIs 走 searchPOI(provider/amap-api)兜底;浏览路径
    `console.warn` + viewportFallbackSearch(高德视口兜底),兜底再失败才 throw。
  - fetchLocalPoisAll(分类门控循环)对 `!res.ok` 同样 throw → catch 回退
    viewportFallbackSearch(带 categories),已覆盖 502。
  - 外层:fetchPOIsForMode 抛错 → map-shell loader 的 catch 保留旧目录并置
    noMore/错误信号(可重试),不会以 500 呈现给用户(只读核验
    map-shell.tsx:1040-1079,未修改——map-shell 属「不碰」边界)。
- `server/src/lib/hz-poi-store.ts` — **未改**:null(失败)与 {results:[]}(真空)
  语义已可区分,:160-167 测试保持并继续通过。
- `server/tests/api-hardening.test.mjs` — 新增 `#12 domain-local: 本地库故障(null)→
  502 错误信号,不写缓存(不伪装成功空结果)`:源码级 grep/顺序契约断言
  (error token、status 502、no-store、`if (!result)` 先于 writePublicCache;
  成功路径仍写缓存 + PUBLIC_CACHE_CONTROL)。
- `server/tests/poi-service.test.mjs` — 新增 2 用例:
  - 关键词路径:route 502 → fetchLocalPois return null → 恰走一次
    provider.searchPOI(keyword='肯德基')并将兜底 POI 并入累计池;
  - 浏览路径:route 502 → 视口兜底触发(searchPOI 被调用)、兜底 POI 返回,
    不抛错不静默清空(注入 setActiveSearchProvider 假 provider,避免真实 SDK;
    现有用例全保持)。

## 门禁结果

- npm test: 1614 tests / **1612 通过** / 2 skip / **0 失败**(其中本 WS 新增 3 用例全过)
- npm run typecheck: 通过(tsc --noEmit)
- make docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过

## 遇到的问题

- 无阻塞问题。两点留意:
  1. 未拆成 fix/test 两个 commit——首次 `git add` 将三文件一并提交,后尝试
     `git reset --soft` 拆分被环境拒绝(需审批),故保留单一 commit
     `d2c3c12 fix(domain-local): DB failure → 502 instead of fake empty 200`
     (fix+其测试一个逻辑单元,内容完整)。
  2. 浏览路径 502 用例会在测试输出中打印预期的
     `[poi-service] local domain POIs failed, fallback to AMap: Error: domain-local 502`
     ——即被验证的兜底告警路径本身,非失败噪音。

## 证据

- 测试输出摘录(node --test spec):
  - `✔ #12 domain-local: 本地库故障(null)→ 502 错误信号,不写缓存(不伪装成功空结果)`
  - `✔ fetchPOIsForMode(domain 杭州内 + 关键词): route 502 → fetchLocalPois return null → 走 searchPOI 高德兜底`
  - `✔ fetchPOIsForMode(domain 杭州内浏览): route 502 → 高德视口兜底,不抛错不静默`
- 关键代码(route.ts:null 分支):
  ```ts
  if (!result) {
    return NextResponse.json(
      { error: 'local_db_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  ```
- git log: `d2c3c12 fix(domain-local): DB failure → 502 instead of fake empty 200`
  (3 files changed, 103 insertions(+), 12 deletions(-));工作树干净,未 merge 未 push。

门禁: PASSED
结论: OK
