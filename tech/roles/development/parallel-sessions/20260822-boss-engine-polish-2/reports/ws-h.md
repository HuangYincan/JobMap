# ws-h 汇报(2026-08-22)

分支 `fix/tmap-content-scope`(worktree `/Users/acccan/dm-wt-tc`,基于 dev `7b515e6`)。
2 个 commit:`4e74900`(引擎分派收窄 + DOM overlay 定位 API 双路径 + 测试)、
`d28dfa5`(tech/23 回填)。

## 堆叠根因确认(方案 A/B 共用,真机实测实锤)

- **`lngLatToContainerPoint` 在真实 TMap GL SDK(v1.8.0.2)上不存在**:
  真机 Chromium 页面内 `typeof map.lngLatToContainerPoint === 'undefined'`;
  Map 原型实际导出面 = `projectToContainer` / `unprojectFromContainer` /
  `projectToWorldPlane` / `projectToCenterLocalPlane` / `glLatLngToPosition`。
- ws-pinfix2(f2e4f60)断言「官方命名 API」→ 引擎 `project()` 判空 → warn +
  跳过定位 → 全部 overlay div 不写 left/top → 停在静态位置 → **100 徽章全堆叠
  (0,900)**。不是「API 存在但定位错」,是 **API 不存在 + DOM overlay 分派过宽**
  双因叠加;boss 实测堆叠现象与代码路径完全吻合。

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`
  - **方案 A(主修复)** `createMarker` 分派收窄:`content 存在且无 icon` →
    `createContentOverlay`(agent 蓝点等无 icon HTML 形态,ws-pinfix2 目标保留);
    `content+icon 并存(公司 POI 徽章/聚合徽章)/ 仅 icon` → 既有 icon 路径
    (单点 Marker / MultiMarker 纹理,ws-c 锚点 anchor = -contract offset),
    content 不写 geometry 不渲染(规避 HTML/纹理双渲染叠印);无 content 无
    icon 路径不变;`createMultiMarker`/`resolveMultiStyle`/文件头注释同步。
  - **方案 B(双保险)** `createContentOverlay.project()` 定位 API 双路径:
    `lngLatToContainerPoint` 优先(测试双面/未来 SDK 兼容)→
    `projectToContainer(latLng)` 兜底(真实 SDK 实测:center → 精确容器中心
    (640,400)/1280×800;geo 偏移 (lat+0.02,lng+0.02) → (757,265) 方向量级
    正确;+2 zoom 后同点像素距离精确 ×4);两者皆无 → 一次性 warn + 跳过。
- `server/tests/map-engine-tencent.test.mjs`(73→74)
  - 重写 ws-pinfix2「content+icon → content 主机制」测试为新语义断言:
    icon 主机制(MultiMarker + styleId dm-st-1 + anchor (27,27) + 零 DOM
    overlay div + content 不写 geometry + content-only 仍 DOM overlay);
  - 新增:`projectToContainer` 兜底定位(left/top = 投影 - offset、LatLng
    纬度在前、双 API 缺失一次性 warn 不抛错、原 falsy 语义回归)。
- `tech/23-map-engines.md`(追加 ws-h 节,仅追加)。

## 真机验收(worktree :3100 dev server + Playwright Chromium + 真实 AK)

- **腾讯徽章不堆叠**:`.dm-badge` DOM 0 个(MultiMarker GL 纹理路径);
  MultiMarker 单实例 400 geometry / **177 唯一坐标** / 11 样式;截图
  `ws-h-10-tmap-final.png` 等显示 ~14-18 徽章分踞正确地理点,无堆叠;
- **点击命中**:点击经 `projectToContainer` 定位的 dm-mk-1(640,400)→
  「高频杭州」POI 详情卡片弹出(`ws-h-16-after-click.png`);
- **缩放跟随**:+2 zoom 后同 geo 偏移像素距离精确 ×4(698,333 → 873,130,
  相对中心 4.02×);`ws-h-17-after-zoom.png` 视觉验证徽章钉地理点;
- **agent 蓝点(无 icon content)不回归**:分派仍走 DOM overlay,定位链
  projectToContainer 兜底(单元 74/74 钉住);同机制(容器 appendChild +
  project 定位)的自绘比例尺在同页面正常渲染(截图左下「1 公里」);
- **百度/高德零回归**:amap 回切 400 DOM 徽章(63 唯一可见点)、baidu 400
  徽章(177 唯一),截图正常,console 零报错。
- 保底方案(引擎层强制 amap)未触发:方案 A/B 真机验收通过,无需启用。

## 门禁结果

- npm test: 1447 通过 / 0 失败 / 2 skip
- npm run typecheck: 通过
- make docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- **DOM overlay 活体验证路径受限**:agent 蓝点/距离手柄(无 icon content)
  在真机页面触发路径无 UI 入口(桌面/移动器视口下 Filter 按钮 0×0 隐藏、agent
  蓝点需 LLM 会话)→ 蓝点端到端以「引擎单元测试(projectToContainer 兜底
  定位链)+ 真实 SDK API 实测(center→容器中心精确、偏移正确)+ 同机制自绘
  比例尺生产可见」组成证据链;DOM overlay 的 SDK 定位源已确认正确可用。
- dev server 需 `--webpack`(Turbopack 拒绝 worktree node_modules 外链
  symlink);真机验证用临时的 `.env.local` symlink 指向主树(测试后已删除)。

## 证据

- 截图(`.playwright-mcp/` 相对文件名):`ws-h-10-tmap-final.png`(腾讯修复后)、
  `ws-h-16-after-click.png`(点击命中)、`ws-h-17-after-zoom.png`(缩放跟随)、
  `ws-h-00-amap.png` / `ws-h-11-amap-back2.png`(amap 前后)、`ws-h-12-baidu2.png`。
- SDK 实测脚印(页面 evaluate):`lngLatToContainerPoint: "undefined"`;
  `projectToContainer: "function"`;centerPt {640,400};offsetPt {757,265};
  +2z 像素 4.02×;MultiMarker 400 geo / 177 uniq / 11 styles。

门禁: PASSED
结论: OK
