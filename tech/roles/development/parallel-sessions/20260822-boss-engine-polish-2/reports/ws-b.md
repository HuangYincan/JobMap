# ws-b 汇报(2026-08-22)

分支 `fix/baidu-poi-locate`(worktree `/Users/acccan/dm-wt-bp`),基于 `5f29134`。
3 个 commit:`417e67e`(引擎定位)、`1cfe37e`(测试)、`f77cad0`(docs)。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts`(仅 getCurrentPosition 段 + import 行)
  - 新增模块级 `browserPosition()`:浏览器 `navigator.geolocation` 高精度定位
    (`enableHighAccuracy: true, timeout: 8000, maximumAge: 0`),wgs84 → gcj02
    (契约输出);失败/被拒/无 API → null 不抛
  - `getCurrentPosition` 改为浏览器优先;SDK `BMapGL.Geolocation`(IP 定位)降级为
    fallback(`sdkCurrentPosition`,原 bd09→gcj02 路径不变)
  - 坐标链说明:「蓝点落在真实位置」验收 = wgs84→gcj02(引擎契约)→ createMarker/
    setCenter 的 gcj02→bd09 落 bd09 底图,恰为百度官方 wgs84→bd09 两步式;直接
    输出 bd09 会被契约当 gcj02 再转 → ~700m 二次偏移
  - 文件头坐标分叉注释同步(出参通道标注)
- `server/tests/map-engine-baidu.test.mjs`(+5,64→69,第 8 节)
  - 单点级(z>8)公司 POI content 徽章契约形状:HTML 原样进 msTarget、data-fb/
    onerror 属性完好、透明 1×1 锚点图标 anchor(20,20)(offset [-20,-20])、
    点击经 msTarget 冒泡可达
  - 内联 onerror 降级链逐字模拟(new Function 执行真实属性文本,元素形状 =
    浏览器 img 暴露面):favicon.im 403 → icon.horse → 候选耗尽隐藏 img 显示
    emoji;空候选首错即 emoji;多候选按序切换三态
  - 定位:浏览器优先(选项断言 enableHighAccuracy/maximumAge:0 + wgs84→gcj02
    偏移 + SDK 不构造);浏览器被拒/空结果/无 navigator → SDK fallback
    (bd09→gcj02);双通道失败 → null
  - navigator mock 用 defineProperty(node 26 的 navigator 是 getter-only 自有
    属性,直接赋值 TypeError),restore 还原描述符
- `tech/23-map-engines.md`(追加 `ws-b 回填` 一节,51 行)

## 门禁结果

- npm test: 1379 通过 / 0 失败 / 2 skip(基线 1375,+5 本 WS)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## POI 单点级实测结论(读码 + SDK 源码核实 + 离线钉住;沙箱无真实 AK/Playwright)

- **渲染/位置**:content 路径正确 —— msTarget DOM + 透明 1×1 锚点图标
  (anchor = -契约 offset,徽章 anchor (20,20)),徽章中心对齐点位(ws-c bug 7
  已修根因,公式有 SDK 源码核实);聚合级(z≤8)boss 已实测正常,单点级与聚合
  级共享同一 createMarker 数学
- **点击**:click 绑 msTarget,徽章子元素冒泡可达(测试钉住)
- **favicon.im 403 降级链**:BMapGL setContent 是 innerHTML,内联 onerror 属性
  不丢;链逻辑逐字执行验证正确(favicon.im → icon.horse → emoji 三态)
- **结论:单点级无需引擎代码改动**;本轮以测试 + 文档钉住(此前 onerror 链
  零覆盖)。真机浏览器复验留待 boss 收尾(需 AK + dev server)

## 遇到的问题

- node 26 `globalThis.navigator` 为 getter-only 自有属性,测试直接赋值抛
  TypeError → 改 `Object.defineProperty` 覆盖 + 保存/还原描述符(tencent 测试
  能直接赋值是因为其文件早前已 delete 过该属性)
- 聚合级 content+icon 双形态同传(BMapGL 上 GL 纹理 + msTarget DOM 同位双渲染,
  DOM 覆盖 GL,视觉重合)——已知无害冗余,零改动(改动会破坏 boss 实测通过的
  聚合渲染,按铁律 4 不擅改)

## 证据

- `cd server && node --test tests/map-engine-baidu.test.mjs`:69 pass / 0 fail
  (新增 5 项全绿)
- `npm test`:1379 pass / 2 skip / 0 fail;`npm run typecheck` 零错误;
  `make docs-check` passed;`git diff --check` 干净
- git log:`417e67e fix(baidu): getCurrentPosition 改浏览器高精度定位…` /
  `1cfe37e test(baidu): 单点级 POI content 徽章 + 定位通道测试(+5,64→69)` /
  `f77cad0 docs: tech/23 ws-b 回填(百度单点级 POI 核查 + 定位真实化)`

门禁: PASSED
结论: OK
