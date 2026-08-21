# Workstream b — fix/baidu-poi-locate(百度 POI 单点级修复 + 定位真实化)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-bp`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-b.md`(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22)

**用户 bug 2「百度的 poi 无法正确加载」**:
- boss 实测:百度聚合级别(zoom≤8,dataURL 图标路径)渲染正常(30 蓝簇,无报错)
- **单点级别(zoom>8,公司徽章 content 路径)未验证** —— 百度 BMapGL 公司 POI 走 `content` 路径(DOM 覆盖层 msTarget,L651-701 注释:`raw.setContent` + 透明 1×1 图标扛锚点);徽章 HTML(recruitmentBadgeHTML)内嵌 favicon.im `<img>`(403/CORS 失败)+ 内联 onerror 候选链(icon.horse)
- **worker 需实测定位**:启动 dev server(`npm run dev`,worktree 内)用 Playwright 或读码定位:单点级徽章是否渲染/偏移/点击无效;favicon.im 403 在百度 content `<img>` 的 onerror 链是否正常降级 icon.horse

**用户 bug 5 百度部分「用户定位不是真实位置」**:
- `baidu-engine.ts` L1011-1031 `getCurrentPosition` 用 `new BMapGL.Geolocation().getCurrentPosition()` —— **SDK 定位默认走 IP 定位(城市级精度,不真实)**
- AMap 用 `AMap.Geolocation({enableHighAccuracy: true})`(浏览器 GPS,真实)
- 腾讯已改浏览器定位(browserPosition,wgs84→gcj02)—— 百度对齐同一模式

## 任务

### 1. 百度 POI 单点级实测与修复

- 实测(Playwright 或 mock):zoom>8 百度公司 POI 徽章渲染/位置/点击;定位问题根因(可能:content 锚点图标与 DOM 偏移组合、icon 锚点、点击拾取)
- 修复缺失环节(保持契约语义;与 AMap 徽章视觉对齐)
- 若 favicon.im 403 导致徽章内 `<img>` 空白:确认内联 onerror 候选链(icon.horse)是否生效,不生效则修复(注意 BMapGL content 是 DOM,我们的内联 onerror 属性应保留——若 SDK 覆写则改在徽章 HTML 生成层保证)
- 测试:单点级 content 渲染/点击断言(mock)

### 2. 定位真实化(浏览器高精度)

- `getCurrentPosition` 从 BMapGL Geolocation(IP)改为**浏览器 navigator.geolocation**(enableHighAccuracy:true, timeout 8s, maximumAge 0)
- wgs84 → bd09 → gcj02?注意:百度底图是 bd09,定位点要经 wgs84→bd09 转换才能对齐底图(**必须核实现有 bd09ToGcj02 用在哪**——若蓝点位置由引擎输出 gcj02 而 map-shell 按 gcj02 放置,则 wgs84→gcj02 即可;若 SDK 组件消费需 bd09,则 wgs84→bd09。以「蓝点落在真实位置」为验收)
- SDK Geolocation 保留为 fallback(浏览器定位失败时)
- 测试:mock 断言浏览器定位优先、SDK fallback、坐标转换

### 3. 测试与文档

- `server/tests/map-engine-baidu.test.mjs` 追加:POI 单点断言 + 定位断言
- `tech/23-map-engines.md` 回填(仅追加):百度定位通道核实 + POI 修复摘要
- 全量门禁见批次 README(基线 1364)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`(**仅 POI/content/icon 段 + getCurrentPosition 段**)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:baidu-engine.ts 的 STYLE_CONSTANT/applyMapStyle/setStyle 段(ws-a 拥有)、腾讯/高德引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-bp/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-bp && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-b.md`:POI 实测结论与修复、定位通道改造、坐标转换说明、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
