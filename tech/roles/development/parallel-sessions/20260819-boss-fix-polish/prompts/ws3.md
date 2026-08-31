# ws3 — Bug2 公司无 icon:DB 读路径 logo 解析链 + import 合并 + favicon 可达

## 背景(boss + Explore 已定位根因)

用户报:公司无对应 icon。DB 实测:672 家公司 `logo_url` 100% 空、`logo_emoji` 99.7% 空,
`company_sites.logo_url` 1843/1843 空。根因链:

1. **DB 读路径绕过解析链**:`server/src/lib/recruitment-store.ts:167-168`
   `logo: company.logo_emoji ?? undefined` 直接读列,不调 `resolveCompanyLogo`
   (company-logo.ts:41-58 链:siteLogoUrl → site favicon → company logo → company favicon → emoji)。
   离线路径(recruitment-source.ts:163-179 `logoForSite`)走解析链,DB 路径不走 → 全 🏢。
2. **导入丢弃 logo**:`server/src/lib/recruitment-import.ts` `mergeCompany`(141-152)
   只合并 sites+positions,不合并 logoUrl/logoEmoji;dedupe 保留第一个公司(seed 垫底)。
   写库 `logoUrl ?? null, logoEmoji ?? null`(314-315)→ DB 全空。
3. **favicon 不可达**:`company-logo.ts:34-38` `faviconFromUrl` 用
   `https://www.google.com/s2/favicons?sz=128&domain=...` 国内被墙 → 即使有 URL 也加载失败。

## 任务

1. **import 合并 logo**:`mergeCompany` 合并 `logoUrl`/`logoEmoji`(非空不覆盖;seed 与 drop 均可提供)。
   加单测:seed 有 logo + 真实 drop 无 logo → 结果保留 seed logo。
2. **DB 读路径接解析链**:把 company-logo.ts 的解析链抽成可复用函数(公司级),
   `loadWorkCatalogFromDb`(recruitment-store.ts)对 logo 空的公司按链解析
   (careerUrl → favicon 兜底,672 家中仅 1 家无 careerUrl);离线/DB 两路径共用。
   保持「无 logo → 🏢 emoji」的兜底语义不变。
3. **favicon 服务可达性**:google s2 换国内可达服务。**实测验证**(至少 2 个候选:
   curl HEAD 200 + image content-type,如 icon.horse / favicon.im 等;记录请求结果)。
   选定后更新 `faviconFromUrl`,来源/可达性验证写入代码注释。
4. **ADR**:`tech/06-decisions.md` 加一条 ADR(favicon 服务选型 + 可达性验证结论)。
5. **测试**:解析链单测(无 logo → favicon → emoji 各层)、import 合并 logo 用例。
   不跑 import:seed:apply(Env-only,boss 已记 deferred-notes)。

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-ws3)

- 只动:`server/src/lib/recruitment-import.ts`、`server/src/lib/recruitment-store.ts`、
  `server/src/lib/company-logo.ts`、`tech/06-decisions.md`、相关测试文件
- **不碰**:`server/src/components/map-shell.tsx`、`server/src/hooks/use-poi-map.ts`、
  `server/src/lib/map-markers.ts`(marker 渲染层,ws1/ws2 区域)、
  `server/src/components/account-panel.tsx`(ws4)、`server/src/lib/viewport-search.ts`

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-ws3/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-ws3 && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-fix-polish/reports/ws3.md`:
改动文件 + 解析链接入简述 + favicon 候选实测结果(请求状态/耗时/选定)+ 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
## 续作附录(boss 2026-08-19,预算超限中断后重派)

上次中断前已提交 4 个 commit(ADR-007 / DB 解析链 / favicon.im / import 合并 logo)。
工作树有未跟踪 `server/tests/probe-favicon.test.mjs`(处理:确认为有效测试则纳入,
否则移到无用处或删除)。

开工先 `git log --oneline -5` 确认现状,不重做。剩余任务:
1. 检查 probe-favicon.test.mjs 是否应纳入测试集(测试可达性断言是否稳定/是否依赖外网;
   若依赖外网则改为本地断言或跳过策略,勿引入 flaky 测试)
2. 跑全部门禁(npm test / typecheck / docs-check / diff-check)
3. 写报告(含 favicon.im 实测记录与 ADR-007 摘要)
