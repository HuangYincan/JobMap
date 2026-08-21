# Workstream 1 — feature/poi-contract(契约扩展 + 三引擎适配层补齐)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw1`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-1.md`(末两行 token,见文末)。

## 背景(诊断已坐实)

`map-markers.ts` 控制器绕过契约直操厂商裸实例,用 AMap 专属 API(`setzIndex` 小写/`setIcon`/`setOffset`/`show()hide()`/`.on`/`setMap(null)`/`new Icon/Size/Pixel`)——非 AMap 下 TypeError、静默吞、POI 消失/泄漏。**修复前置:扩展 MapMarker 契约,让三引擎在适配层吸收 API 差异**,控制器此后只调契约方法(ws-2 做)。

## 任务

### 任务 1:`server/src/lib/map-engine/types.ts` 契约扩展

`MapMarker` 接口增(向后兼容,可选方法 + 必需方法二选一,以各引擎都能实现为准):

```ts
export interface MapMarker {
  raw: unknown;
  setPosition(p: LngLat): void;
  setContent?(html: string): void;
  remove(): void;
  setZIndex?(z: number): void;          // 新增:统一大小写语义
  setVisible?(v: boolean): void;        // 新增:可见性(show/hide 差异)
  on?(event: 'click', cb: () => void): void;   // 新增:事件(AMap .on / BMapGL addEventListener)
  off?(event: 'click', cb?: () => void): void; // 新增:解绑
}
```

`MapMarkerOptions` 增:`zIndex?: number`(确认现状已有?无则加)、`icon?: { src: string; size?: [number, number] }`(图标规格,替代控制器侧 `new Icon/Size`)。

### 任务 2:三引擎适配层实现新增方法(每引擎实现 setZIndex/setVisible/on/off + icon 支持)

**amap-engine.ts**:
- `setZIndex(z)` → `raw.setzIndex(z)`(AMap 小写,适配层兜住)
- `setVisible(v)` → `raw.show()/hide()`(或 AMap 的 `setVisible`)
- `on/off('click', cb)` → `raw.on('click', cb)` / `raw.off(...)`
- icon:`raw.setIcon(new AMap.Icon({...}))`(icon 规格 → AMap Icon)

**tencent-engine.ts**(两条路径都要):
- 单点 Marker 路径:`setZIndex` → `raw.setZIndex(z)`;`setVisible` → `raw.setVisible(v)`;`on/off` → `raw.on/off`
- **MultiMarker 路径**(诊断确认官方无 zIndex setter):`setZIndex` → 无法映射,`console.warn` 一次性降级(`warnMultiMarkerContentDegraded` 同款,防刷屏);`setVisible` → MultiMarker 的可见性(核实 SDK:`setVisible` 或 `setMap(null/null 切换)`?以源码为准,不可用则 warn 降级);`on/off` → `mm.on('click', e => e.geometry?.id === myId && cb())`(现有实现抽成契约方法)
- icon:MultiMarker 路径 icon → `MarkerStyle`(src/width/height/anchor,核实 SDK);单点路径 → `raw.setIcon?`

**baidu-engine.ts**:
- `setZIndex(z)` → `raw.setZIndex(z)`(BMapGL 大写)
- `setVisible(v)` → `raw.show()/hide()`
- `on/off('click', cb)` → `raw.addEventListener('click', cb)` / `removeEventListener`
- icon → `raw.setIcon(new BMapGL.Icon(src, new BMapGL.Size(w,h)))`(核实 SDK)

**关键**:每引擎的实现以**真实 SDK 源码/官方文档核实**为准(ws 上轮已验证可取到 SDK;核实记录写入汇报);防御式(方法缺失 → warn 降级不抛)。

### 任务 3:测试

- `server/tests/map-engine-amap.test.mjs` / `map-engine-tencent.test.mjs` / `map-engine-baidu.test.mjs` 各自补:setZIndex 大小写映射、setVisible、on/off 事件(含 MultiMarker geometry.id 过滤)、icon 转换
- MultiMarker setZIndex/setVisible 降级断言(warn 一次 + 不抛)

## 文件边界

- 只允许改:`server/src/lib/map-engine/types.ts`、`server/src/lib/map-engine/{amap,tencent,baidu}/*.ts`、`server/tests/map-engine-{amap,tencent,baidu}.test.mjs`、`server/tests/fixtures/engine-mock.mjs`(如需)
- **不碰**:`map-markers.ts`(ws-2 做)、`map-shell.tsx`、`switch.ts`、`use-map-engine.ts`、`poi-service.ts`、`amap-api.ts`、`tech/`、`server/docs/`、数据文件

## 门禁

1. `cd /Users/acccan/dm-wt-rw1/server && npm test`(基线 1034 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-rw1/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-rw1 && make docs-check`(基线红如实报告,确认本 ws 零 .md 改动)、`git diff --check`
4. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-1.md`:契约最终签名、三引擎实现明细(**SDK 核实记录**)、测试用例、门禁结果、commit 列表。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```