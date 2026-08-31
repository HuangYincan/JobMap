# Workstream a — feature/map-engine-backend(后端 geocode 配置化)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-a`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/a.md`(末两行 token,见文末)。

## 背景

项目 geocode 工具链 `server/src/lib/site-geocode.ts`(1207 行)已有三家 provider 独立函数 + `fallbackChain`(AMap→百度→腾讯 固定顺序、无 key 自动跳过、配额耗尽切换)。**"只配一家"已可用**,本 WS 补齐:配置校验输出(provider 注册表 + formatter)、脚本 REPORT、文档(environment-variables.md 补三服务端 key + 两前端 key、.env.example 增两前端 key)。

## 任务

### 任务 1:site-geocode.ts 加法(只读注册表,零重构)
在 `server/src/lib/site-geocode.ts` **新增**(不改任何现有函数/fallbackChain 一行):
- `export interface GeocodeProviderInfo { id: 'amap'|'baidu'|'tencent'; envVar: string; configured: boolean }`
- `export function getGeocodeProviders(): GeocodeProviderInfo[]` — 与现有 `amapWebKey()/baiduWebKey()/tencentWebKey()`(L206-221)读**同一 env**(AMAP_WEB_KEY/BAIDU_MAP_AK/TENCENT_MAP_KEY,trim 后非空为 configured),按链顺序 amap→baidu→tencent 返回
- `export function formatGeocodeProviderReport(): string` — 形如 `PROVIDERS amap=set baidu=missing tencent=set | chain=AMap→Baidu→Tencent (skip no-key)`,供脚本 REPORT 输出
- 注释注明:注册表与 key getter 的一致性由测试钉住(见任务 3),不共享实现

### 任务 2:脚本 REPORT 增强
- `server/scripts/geocode-sites-apply.mjs`(430 行):在现有 REPORT(约 L401)后新增一行 `formatGeocodeProviderReport()` 输出
- `server/scripts/plan-site-geocode.mjs`(42 行):同款 PROVIDERS 行
- 保持现有输出格式风格(如 `set | MISSING` 大小写习惯),不破坏既有断言

### 任务 3:测试
新建 `server/tests/geocode-providers.test.mjs`(node:test + node:assert,风格对齐 `tests/site-geocode.test.mjs`):
- env 组合:三 key 全配/单配(每家的单配)/零配 → `getGeocodeProviders()` configured 标志正确
- **一致性**:注册表 configured 与 `amapWebKey()/baiduWebKey()/tencentWebKey()` 存在性完全一致(防注册表与链漂移)
- `formatGeocodeProviderReport()` 输出字符串断言(含全配/零配两种)
- env 用 `process.env.AMAP_WEB_KEY = 'test-x'` + try/finally 还原(既有模式)

### 任务 4:文档
- `server/docs/environment-variables.md`(当前**完全没写**这三个 key):新增一节「Geocode 兜底链(REST)」:AMAP_WEB_KEY/BAIDU_MAP_AK/TENCENT_MAP_KEY 的用途、固定链顺序 AMap→百度→腾讯(无 key 自动跳过)、配额耗尽切换语义(AMap 10044/10043、Baidu 302、Tencent 121/321/322)、申请路径;另加「前端地图引擎 key」小节:NEXT_PUBLIC_TENCENT_JSAPI_KEY(lbs.qq.com 控制台新建 key 勾选 JS API GL)、NEXT_PUBLIC_BAIDU_AK(lbs.baidu.com 控制台,AK 可复用于 JSAPI;JSAPI 需配 referer 白名单)、注明 NEXT_PUBLIC_* 是公开 key、构建期内联、生产切 key 需重建
- `server/.env.example`:追加 `NEXT_PUBLIC_TENCENT_JSAPI_KEY=` 与 `NEXT_PUBLIC_BAIDU_AK=`(注释说明;三个服务端 key 已在,补交叉引用即可)

## 文件边界

- **只允许改**:`server/src/lib/site-geocode.ts`(加法)、`server/scripts/geocode-sites-apply.mjs`、`server/scripts/plan-site-geocode.mjs`、`server/tests/geocode-providers.test.mjs`(新)、`server/docs/environment-variables.md`、`server/.env.example`
- **不碰**:fallbackChain 与三个 provider 函数本体、`tech/` 任何文件、`server/src/components/`、`server/src/lib/map-engine/`、`server/data/**`、其他任何文档

## 门禁

1. `cd /Users/acccan/dm-wt-eng-a/server && npm test`(基线 549:547 pass/2 skip;**现有测试必须全绿零漂移**,新测试也绿)
2. `cd /Users/acccan/dm-wt-eng-a/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-a && make docs-check`、`git diff --check`
4. 验证输出:`cd /Users/acccan/dm-wt-eng-a/server && node scripts/plan-site-geocode.mjs`(dry-run,只读)末尾应出现 `PROVIDERS …` 行——把该行抄进汇报

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/a.md`。内容:改动摘要(注册表/两脚本/文档位置)、测试用例列表、`PROVIDERS` 行实际输出、遇到的问题。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
