# Workstream b — feature/map-engine-core(引擎内核)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-b`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/b.md`(末两行 token,见文末)。

## 背景

「地图引擎一切皆插件」的**内核层**:定义 MapEngine 三层接口与引擎注册/选择/加载/坐标工具。后续 ws(c/d/e)实现三家引擎,f 做 UI 切换——**本 WS 的 types.ts 是公共契约,必须准确完整**。map-shell 及任何业务组件**零改动**(契约测试断言)。

## 任务

### 任务 1:`server/src/lib/map-engine/types.ts`(公共契约,新建)

按以下签名实现(可微调,但保持语义):

```ts
export type MapEngineId = 'amap' | 'tencent' | 'baidu';
export type MapStyleId = 'normal' | 'satellite' | 'whitesmoke';
export type LngLat = { lng: number; lat: number };              // 规范坐标 = gcj02
export type MapBounds = { west: number; south: number; east: number; north: number };

export interface MapViewCreateOptions {
  container: HTMLElement;
  center: LngLat;
  zoom: number;
  pitch?: number;
  rotation?: number;
  style: MapStyleId;
}
export interface MapViewState { center: LngLat; zoom: number; pitch: number; rotation: number; }

export interface MapView {
  readonly raw: unknown;              // 厂商实例逃生舱(未迁移的 AMap 专属代码,标注 TODO)
  readonly engine: MapEngine;
  getState(): MapViewState;
  getBounds(): MapBounds | null;
  isDestroyed(): boolean;
  setCenter(center: LngLat, animateMs?: number): void;
  setZoom(zoom: number, animateMs?: number): void;
  setPitch(pitch: number, animateMs?: number): void;
  setRotation(rotation: number, animateMs?: number): void;
  setBounds(bounds: MapBounds): void;
  flyTo(opts: { center: LngLat; zoom?: number }): void;
  setStyle(style: MapStyleId): void;   // 不支持 → 回退 normal + console.warn
  on(event: MapViewEvent, cb: () => void): () => void;   // 返回解绑函数
  createMarker(opts: MapMarkerOptions): MapMarker;       // offset 用 [x,y] 元组
  createCircle(opts: MapCircleOptions): MapCircle;
  addControl?(kind: 'scale'): void;
  destroy(): void;
}
export type MapViewEvent = 'click' | 'zoomchange' | 'moveend' | 'complete';

export interface MapMarkerOptions { position: LngLat; content?: string; offset?: [number, number]; zIndex?: number; onClick?: () => void; }
export interface MapMarker { raw: unknown; setPosition(p: LngLat): void; setContent(html: string): void; remove(): void; }
export interface MapCircleOptions { center: LngLat; radius: number; color?: string; }
export interface MapCircle { raw: unknown; remove(): void; }

export interface MapSearchProvider {
  searchPOI(opts: { keyword: string; city?: string; center?: LngLat; radius?: number; limit?: number }): Promise<DomainPOI[]>;
  fetchSuggestions(keyword: string, city?: string): Promise<AmapSuggestion[]>;
  getCurrentPosition(): Promise<LngLat | null>;
  geocodeAddress(address: string, city?: string): Promise<LngLat | null>;
}
// DomainPOI / AmapSuggestion 从现有 server/src/lib 的类型导入或定义最小形状(与 amap-api.ts 现有返回对齐)

export interface MapEngine {
  readonly id: MapEngineId;
  readonly label: string;                    // '高德地图' | '腾讯地图' | '百度地图'
  readonly namespace: 'AMap' | 'TMap' | 'BMapGL';
  readonly coordSystem: 'gcj02' | 'bd09';
  readonly keyVar: 'NEXT_PUBLIC_AMAP_KEY' | 'NEXT_PUBLIC_TENCENT_JSAPI_KEY' | 'NEXT_PUBLIC_BAIDU_AK';
  isConfigured(): boolean;                   // 运行时读 process.env(Next 构建期内联,测试可控)
  load(): Promise<void>;                     // 幂等脚本注入 + namespace 就绪
  isLoaded(): boolean;
  createView(opts: MapViewCreateOptions): Promise<MapView>;
  readonly search: MapSearchProvider;
}
```

注意:`DomainPOI`/`AmapSuggestion` 若从 `amap-api.ts` 导入,保持只读引用(不修改该文件)。

### 任务 2:`server/src/lib/map-engine/engine-registry.ts`(新建)

- 三个引擎描述对象(AMap/Tencent/Baidu,先实现 `isConfigured/load/isLoaded` 的**占位/骨架**(腾讯/百度可 `load()` 抛 `new Error('not implemented')` 并注释「由 ws-d/ws-e 实现」,`createView/search` 同理),AMap 的 load 可先复用思路但**不要** import amap-api(ws-c 实现完整版)——即注册表只持有 id/label/namespace/coordSystem/keyVar/isConfigured,`createView/load/search` 用骨架
- `export const ENGINE_PRIORITY: MapEngineId[] = ['amap', 'tencent', 'baidu']`
- `export function getConfiguredEngines(): MapEngine[]` — 按优先级过滤 `isConfigured()`
- `export function resolveEngine(preferred?: MapEngineId | null): MapEngine | null` — preferred 存在且 configured → 它;否则第一个 configured;无 → null(调用方回退 CSS fallback 地图)
- `export function getEngine(id: MapEngineId): MapEngine`

### 任务 3:`server/src/lib/map-engine/engine-preference.ts`(新建)

- `readEnginePreference(): MapEngineId | null` / `writeEnginePreference(id: MapEngineId): void` — localStorage key `domain-map:engine`,SSR/非浏览器环境守卫(无 `typeof localStorage` / window 时返回 null / 静默 no-op)

### 任务 4:`server/src/lib/map-engine/script-loader.ts`(新建)

- 通用幂等脚本加载器:每引擎配置 `{ url, globalVar, callbackName? }`;`loadScript(conf, { inject }?)` — `inject` 可 DI(测试注入 fake,返回 Promise/onload 语义);幂等(同 URL 只注入一次,模块级缓存);失败移除 script 标签 + 清缓存(复刻 amap-api L94-100 的失败恢复语义);callback 模式(腾讯/百度)与 onload 模式(AMap)都支持
- 单测覆盖:幂等、失败清理、DI fake、重试

### 任务 5:`server/src/lib/map-engine/coord-utils.ts`(新建)

- `wgs84ToGcj02(lng, lat)` / `gcj02ToWgs84(lng, lat)` / `gcj02ToBd09(lng, lat)` / `bd09ToGcj02(lng, lat)` 纯函数(标准算法,固定点位精度 ±1e-5)
- 坐标对象形态:LngLat

### 任务 6:测试(新建,node:test 风格对齐现有)

- `server/tests/fixtures/engine-mock.mjs`:`installEngineMock(namespace, { coordSystem })` 工厂 —— MockView(createMarker/createCircle/setStyle/on/destroy/getState/getBounds)、MockMarker、search stub;可安装到任意 namespace(TMap/BMapGL 测试用;AMap 测试继续用现有 amap-mock)
- `server/tests/map-engine-selection.test.mjs` — env 组合(全配/单配/零配)下 `resolveEngine` 优先级;preference 优先、preference 未配置回落;零配返回 null
- `server/tests/map-engine-loader.test.mjs` — 幂等/失败清理/DI fake 注入/重试
- `server/tests/map-engine-coord.test.mjs` — 固定点位往返(如天安门 gcj02 (116.397428, 39.90923) ↔ bd09 (116.403963, 39.915119)),±1e-5
- `server/tests/component-contracts.test.mjs` **追加**(用 readFileSync 正则断言,既有风格):
  - `engine-registry.ts` 引用的 env 名恰为 `NEXT_PUBLIC_AMAP_KEY` / `NEXT_PUBLIC_TENCENT_JSAPI_KEY` / `NEXT_PUBLIC_BAIDU_AK`
  - `ENGINE_PRIORITY = ['amap', 'tencent', 'baidu']` 顺序断言
  - map-shell.tsx 本轮不得被改动(可选:`git diff` 不在 worker 权限内,跳过此项)

## 文件边界

- **只允许改**:`server/src/lib/map-engine/`(新目录)、`server/tests/fixtures/engine-mock.mjs`(新)、`server/tests/map-engine-{selection,loader,coord}.test.mjs`(新)、`server/tests/component-contracts.test.mjs`(追加)
- **不碰**:`server/src/components/map-shell.tsx`、`server/src/lib/map-adapter.ts`、`server/src/lib/amap-api.ts`、`server/src/lib/map-markers.ts`、`server/src/lib/site-geocode.ts`、`server/scripts/`、`tech/` 任何文件、`server/docs/`、`server/data/**`

## 门禁

1. `cd /Users/acccan/dm-wt-eng-b/server && npm test`(基线 549:**现有全部绿零漂移**,新增也绿)
2. `cd /Users/acccan/dm-wt-eng-b/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-b && make docs-check`、`git diff --check`
4. 汇报给出:接口签名最终形态(简述调整)、测试用例数、契约断言清单

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/b.md`。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
