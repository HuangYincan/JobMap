# ws-1 汇报(2026-08-21)— feature/poi-contract(契约扩展 + 三引擎适配层补齐)

> 恢复说明:本 ws 上轮因 API 402 中断(见 logs/ws-1.log),未提交草稿(7 文件)留在
> worktree;本轮按幂等恢复规则验证草稿可用后继续:补齐 baidu 契约方法测试、修复
> amap 降级测试原型删除 bug、并按 SDK 实测修正 tencent MultiMarker setZIndex/setVisible
> 实现(见下「SDK 核实修正」),跑全量门禁后小步提交(5 commits)。

## 契约最终签名(server/src/lib/map-engine/types.ts)

```ts
export interface MapMarkerOptions {
  position: LngLat;
  content?: string;
  offset?: [number, number];        // 原有
  zIndex?: number;                  // 原有(确认已存在,无需加)
  icon?: { src: string; size?: [number, number] };  // 新增:图标规格,替代控制器侧 new Icon/Size
  onClick?: () => void;             // 原有
}

export interface MapMarker {
  raw: unknown;
  setPosition(p: LngLat): void;
  setContent?(html: string): void;   // 改可选(原必选;MultiMarker 路径不支持 HTML)
  remove(): void;
  setZIndex?(z: number): void;       // 新增:统一大小写语义(AMap 小写 setzIndex / TMap·BMapGL 大写)
  setVisible?(v: boolean): void;     // 新增:统一可见性(AMap·BMapGL show/hide 与 TMap setVisible)
  on?(event: 'click', cb: () => void): void;    // 新增:AMap·TMap .on 与 BMapGL addEventListener 差异
  off?(event: 'click', cb?: () => void): void;  // 新增:解绑(cb 缺省 = 该事件全部;各引擎无「按事件清空」形态时保留)
}
```

全部向后兼容(新方法可选)。setContent 由必选改可选 —— 调用方需按可选处理(ws-2 迁移时注意)。

## 三引擎实现明细 + SDK 核实记录

### AMap(amap-engine.ts)
| 契约方法 | 实现 | SDK 核实 |
|---|---|---|
| setZIndex(z) | `raw.setzIndex(z)`(小写);缺失 → warn 忽略 | ✅ 实测 v2.0 脚本(webapi.amap.com/maps?v=2.0,本仓 amap-api 同款):`setzIndex` 存在,`setVisible` 不存在 |
| setVisible(v) | `raw.show()/hide()`;缺失回退 `setVisible`,再缺失 → warn | ✅ v2.0/v1.4.15 脚本均有 `show:function`/`hide:function` |
| on/off('click') | `raw.on('click', cb)` / `raw.off('click', cb)`;on 缺失 warn;off 缺失 warn | ✅ 脚本含 `on:function`/`off:function` |
| icon | `new AMap.Icon({ image: src, size, imageSize })` + `marker.setIcon`;Icon 不可用/构造失败 → warn 降级 | ✅ v2.0 脚本含 `Icon:function` |

### Tencent(tencent-engine.ts)— 单点 + MultiMarker 双路径
| 契约方法 | 单点 Marker(npm SDK 形态) | MultiMarker(v=1.exp 全局形态) |
|---|---|---|
| setZIndex | `raw.setZIndex(z)`;缺失 warn | **直通 `raw.setZIndex(z)`**(见下方修正);缺失 → 一次性 warn 忽略 |
| setVisible | `raw.setVisible(v)`;缺失 warn | **直通 `raw.setVisible(v)`**;缺失 → 一次性 warn + setMap(null/map) 切换兜底 |
| on/off | `raw.on/off` 直通 | `mm.on('click', e => e.geometry?.id === 本id && cb())`,handler 簿记供 off 精确解绑;off 缺省 cb = 解绑本 marker 全部 click |
| icon | `raw.setIcon({ src, width, height })`;无 setIcon → 一次性 warn | icon → `MarkerStyle`(src/width/height + anchor 合并 offset);HTML content 降级默认点 + 一次性 warn(既有) |

**SDK 核实(2026-08-21 实测,curl 拉取 v=1.exp 脚本 2.2MB 源码逐段核对)**:
- 全局导出表 `Yd = {Map, LatLng, Point, LatLngBounds, Event, GradientColor, GeometryOverlay, MultiMarker, MarkerStyle, MultiPolygon, ..., MarkerCluster, ...}` —— **无单点 `Marker`** → createMarker 必须走 MultiMarker 聚合路径(与草稿既有分派一致)。
- 继承链:hf(MultiMarker)→ rf(GeometryOverlay)→ ef(GeometryOverlayBase)→ oo(Event);**不经 Layer**。
- rf 原型含 `setZIndex`(实现:`this.layer && this.layer.setZIndex(t); this.zIndex = t`)、`setVisible`(`this.layer && this.layer.setVisible(t)`)、`setMap`、`getZIndex`、`getVisible`、`getMap`;hf 自身重写 `setVisible`(含进入/离开动画路径,落 `_visibleAction → layer.setVisible`)。→ **MultiMarker 的 setZIndex/setVisible 真实可用**。

**SDK 核实修正(重要)**:诊断书/上轮草稿按「官方无 zIndex setter」实现 MultiMarker setZIndex/setVisible 为纯降级(warn 一次 + 忽略 / setMap 切换)。实测 SDK 证明两者均存在 → 改为**直通优先、缺失才降级**(防御式保留)。这直接影响 ws-2 控制器迁移:Tencent MultiMarker 的 zIndex/可见性契约方法可用,无需特判。上轮「SDK v1.8.0.2 源码核实」表述与 v=1.exp 实测不符,已更正。

### Baidu(baidu-engine.ts)
| 契约方法 | 实现 | SDK 核实 |
|---|---|---|
| setZIndex(z) | `raw.setZIndex(z)`(大写);缺失 warn | ✅ webgl v1.0 脚本(getscript?type=webgl&v=1.0)含 `setZIndex` |
| setVisible(v) | `raw.show()/hide()`;缺失 warn | ✅ 脚本含 `show:function`×17 / `hide:function`×17 |
| on/off('click') | `raw.addEventListener('click', cb)` / `removeEventListener`;缺失 warn | ✅ 脚本含两者 |
| icon | `raw.setIcon(new BMapGL.Icon(src, new BMapGL.Size(w, h)))`,size 缺省 21x21;Icon/setIcon 缺失或构造失败 → warn 降级 | ✅ 脚本含 `setIcon` 与 `Icon:function` |

同时补齐 BMarker 类型面(setZIndex/show/hide/setIcon/removeEventListener)——typecheck 必需。

## 测试用例(新增 34,基线 1034 零漂移 → 1068)

- **amap(+2)**:契约方法 setZIndex→setzIndex(小写)/setVisible→show·hide/on·off 精确解绑;厂商方法缺失(原型摘除模拟)→ warn 降级不抛;icon→AMap.Icon(size/imageSize) 及无 size 仅 image(2 个既有 + 2 个新增)
- **baidu(+3)**:setZIndex 大写直通 + setVisible→show·hide + on·off→addEventListener·removeEventListener(含 off 缺省 cb 不误删);icon→BMapGL.Icon(url,Size) 缺省 21x21;7 条缺失路径 warn 降级不抛(含 ns.Icon 缺失)
- **tencent(+2,净)**:MultiMarker setZIndex/setVisible 直通(GeometryOverlay 继承)不告警;缺失(老 SDK)→ 一次性 warn + setMap 切换兜底不抛;单点路径直通、icon、MultiMarker geometry.id 过滤、MarkerStyle 图标等既有用例保留
- **fixture**:MockMultiMarker 补 setZIndex/setVisible/getZIndex/getVisible,忠实 SDK(仅 tencent 测试使用,无其他消费方)

修复草稿 bug:amap/baidu 降级测试原用 `delete raw.method`(实例 delete 原型方法无效)→ 改原型摘除 + finally 还原。

## 门禁结果

| 门禁 | 结果 |
|---|---|
| npm test | ✅ 1068 tests / 1066 pass / 2 skip / 0 fail(基线 1034 零漂移 + 新增 34) |
| npm run typecheck | ✅ 通过(BMarker 类型面补齐后 0 error) |
| make docs-check | ⚠️ 基线红(既有):失败仅来自其他批次目录自匹配 grep 正则(`20260821-boss-agent-thinkfix/merge-report.md:20`、`20260821-boss-tencent-geocode/merge-report.md:17`),与本 ws 无关;本 ws **零 .md 改动**(`git diff --name-only | grep -c "\.md$"` = 0) |
| git diff --check | ✅ 通过 |

## commit 列表(feature/poi-contract,5 commits,基线 acc51c6)

```
36d3683 feat(map-engine): 契约扩展——MapMarker setZIndex/setVisible/on·off 与 icon 规格
e5a62fc feat(map-engine): AMap 适配层实现 setZIndex/setVisible/on·off/icon
e6029c7 feat(map-engine): BMapGL 适配层实现 setZIndex/setVisible/on·off/icon
3de8e90 feat(map-engine): TMap 适配层实现单点+MultiMarker 契约方法
d7d4b90 test(map-engine): 三引擎契约方法测试——大小写映射/可见性/事件/icon/降级
```

工作树干净;未 merge、未 push、未碰主树;「不碰」清单(map-markers.ts/map-shell.tsx/switch.ts/use-map-engine.ts/poi-service.ts/amap-api.ts/tech/、server/docs/、数据文件)零改动。

## 遇到的问题

1. **诊断「MultiMarker 官方无 zIndex setter」与 SDK 实测不符** → 上轮草稿实现为纯降级;实测 v=1.exp 源码证明 setZIndex/setVisible 经 GeometryOverlay 继承真实存在 → 改直通优先 + 缺失降级,fixture/测试同步。对 ws-2 是利好(Tencent 路径无需特判),已在汇报注明。
2. **草稿 baidu 缺测试 + BMarker 类型面未补(typecheck 10 error)** → 本轮补齐。
3. **草稿 amap 降级测试 `delete raw.X` 无效(原型方法)** → 运行实测暴露(fail 1),改原型摘除后绿。
4. docs-check 基线红非本 ws 引入,需 boss 派 docs 修复批次(与其他批次 merge-report 同因)。

门禁: PASSED
结论: OK
