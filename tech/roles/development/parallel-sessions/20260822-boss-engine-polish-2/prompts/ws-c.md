# Workstream c — fix/tencent-poi-icon(腾讯 icon 候选链 + POI 偏移核查)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-ti`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-c.md`(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22)

**用户 bug 4「腾讯的 poi 不带 icon」**:
- 实锤链路:favicon.im 无 CORS 头(实测 403 + 无 ACAO 头)→ TMap WebGL 纹理强制 CORS → 加载失败 → ws-e 降级为 emoji 徽章(用户看为「不带 icon」= 无公司 logo)
- **icon.horse 实测 `access-control-allow-origin: *`(CORS 合规,HTTP 200)** → 可在 TMap 纹理加载!
- `company-logo.ts` 已有 `faviconCandidatesFromUrl(url)`:返回 [favicon.im, icon.horse] 候选链;AMap HTML 路径的徽章内联 onerror 用 fallbackUrls 依次切换;但 **TMap icon 路径(map-markers.ts L539-545)只有单一 src(logoUrl = favicon.im),无候选链** → 预检失败直接降级徽章,没机会试 icon.horse
- 修复:icon 候选链——favicon.im 预检失败 → 依次预检 icon.horse(去重,复用 faviconCandidatesFromUrl 与 logoFallbackUrls)→ 首个通过预检的作为 icon.src;全败 → emoji 徽章

**用户 bug 3「腾讯的 poi 会坐标偏移」**:
- ws-a 已修 anchor 按实际尺寸(`resolveTMapMarkerAnchor`:x = iconW/2 - offset.x, y = iconH - offset.y)
- 疑点(worker 核查):
  a. **聚合徽章**(zoom≤8,city cluster dataURL 图标,map-markers.ts L429-435 `icon:{src: cityClusterBadgeIcon(...), size:[size,size]}`)的 size 与 offset 组合 —— buildOffset 对聚合的返回是否与 icon 尺寸匹配
  b. content+icon 并存时 TMap 只走 icon;contract offset 语义 [-16,-40](图钉底尖)与 icon 尺寸组合的锚点计算
  c. 徽章状态尺寸变化(40/46/52 selected/highlighted)时 anchor 是否随尺寸更新(styleId 按签名复用,同签名同 size——状态尺寸变化是否生成新 styleId?若无,选中态锚点偏移)
- 修复:实测定位后修;验收 = 缩放 2 级前后 marker 钉同一地理点 + 点击命中

## 任务

### 1. icon 候选链(带 icon)

- TMap icon 构造路径:`logoUrl` 预检失败 → 依次试 `faviconCandidatesFromUrl(company.careerUrl)` 候选(跳过与 logoUrl 相同的;复用 company-logo.ts 的候选生成,避免重复实现)
- 候选通过预检(icon-preflight `remoteIconStatus==='ok'` 或预检成功) → 用该候选作 icon.src(公司 logo 显示)
- 全部失败 → 现有 emoji 徽章降级(保持)
- 候选也要记忆化(preflight 已有;失败候选不重复尝试)
- **验收**:TMap 下公司 POI 显示公司 logo(icon.horse 加载成功),console 无报错

### 2. POI 偏移核查与修复

- 按「疑点」清单逐项核查(读码 + 纯函数测试;能实测就实测)
- 修复确认的偏移根因;补缩放一致性/选中态锚点测试
- 验收:缩放前后位置一致(纯函数级断言 anchor 公式);选中/高亮态不漂移

### 3. 测试与文档

- `server/tests/map-engine-tencent.test.mjs` 追加:候选链选择断言(预检失败→icon.horse)、锚点公式断言(含状态尺寸)
- `tech/23-map-engines.md` 回填(仅追加):icon.horse CORS 核实 + 候选链机制
- 全量门禁见批次 README(基线 1364)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 marker/MultiMarker/icon/anchor 段**)、`server/src/lib/map-markers.ts`(**仅 TMap icon 构造段 L539-545**)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:tencent-engine.ts 的构造/相机/定位段(ws-d 拥有)、baidu/amap 引擎、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-ti/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-ti && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-c.md`:候选链实现、偏移核查结论(疑点 a/b/c 逐项)、修复、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
