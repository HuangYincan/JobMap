# ws-b 汇报(2026-08-22)— fix/tmap-wheel-switch(滚轮平滑 + 切回 POI 消失)

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`(**Map 构造段,未越 ws-a marker 段**)
  → Map 构造 options 显式加 `scrollable: true`(滚轮缩放显式启用)+ 文件头核实
  注释补滚轮段(SDK v1.8.0.2 实包证据:无 smoothWheelZoom 选项;滚轮平滑 =
  内建行为;setScrollable 运行期切换)
- `server/src/hooks/use-work-viewport.ts`(bug 4 修复)
  → 新增引擎总线订阅(subscribeEngineBus,use-map-engine 导入,无环):活跃
  view 变化 → 视口监听 effect(`[mapReady, engineView]`)与挂载对齐判定
  (`[mapReady, geoSettled, mode, engineView]`)按 view 实例重绑/重跑;无总线
  时退化为原 mapReady 一次性绑定
- `server/tests/map-engine-switch.test.mjs` → 追加 4 项 ws-b 测试(见下)
- `tech/23-map-engines.md`(仅追加)→ ws-b 回填节:滚轮 SDK 核实 + 切回核查
  结论 + 遗留裁决项

`switch.ts` / `use-map-engine.ts`:核查结论为**无缺口**(见下),零改动。

## 一、bug 2 滚轮平滑 —— SDK 核实结论(SDK v1.8.0.2 实包 /tmp/tmap-gljs.js,2.2MB)

- **`smoothWheelZoom` 选项不存在**:全包 **0 处命中**;Leaflet 2D 适配层的
  `scrollWheelZoom:!0 / wheelDebounceTime:40 / wheelPxPerZoomLevel:60`
  (`zy.mergeOptions`)是另一地图路径(tmap2d-adapter),与 GL 无关 —— boss 的
  「疑似 smoothWheelZoom 未启用」**不成立,无事可启**;
- **滚轮平滑 = SDK 内建行为**:Map 选项 `scrollable`(MAP_3D/MAP_2D 默认均
  `true`,运行期 `setScrollable(bool)` 切换)启用滚轮处理器;输入分类 wheel
  (鼠标滚轮)→ `zoomTo({duration:200, smoothEasing:!0, delayEndEvents:100})`
  平滑动画;trackpad(触控板/像素增量)→ `duration:0` 即时应答(SDK 设计,
  与 mapbox 同源);`mapZoomType`(DEFAULT/CENTER)只控缩放锚点(光标/中心),
  与平滑无关;
- **修复方式**:构造显式 `scrollable:true` —— 自文档化 + 防御 SDK 默认值
  漂移;测试断言构造选项含此键且**不含**不存在的 smoothWheelZoom(不传幻觉键)。

## 二、bug 4 切回高德 POI 消失 —— 回放链核查结论

- **replay 双向对称性:成立**。switch.ts replayController 引擎无关、双向同
  代码路径(POI 集 → 可见集 → 选中 → 高亮,与 usePOIMap.applySync 同口径);
  MapShell 主链路不传 replay,usePOIMap 随 view 变化**显式重建**控制器
  (create effect deps [view, accentColor])——双向都全量重放,无方向差异;
- **可见性语义映射:不丢失**。AMap setVisible = show/hide(实例保留)、TMap
  MultiMarker setVisible = add/remove 摘挂(隐藏即不在图层)——两者均经
  MapMarker 契约收敛,回放层零感知;新测试用摘挂语义 mock 断言双向回放后
  可见/隐藏/选中/高亮状态完全一致(work LOD 风格部分可见集);
- **work 视口加载器(use-work-viewport):真缺口,已修**。moveend/zoomend
  监听原只随 mapReady 绑定一次 → 引擎切换后新 view 永远拿不到视口监听
  (旧 view 已销毁、mapReady 恒 true 不触发重绑),domain 视口刷新 + 挂载
  对齐在切换后静默失效。修复:经引擎总线订阅活跃 view,监听按 view 实例
  重绑(引擎切换 setView → 总线重发 → 重渲染 → 在新 view 上重建监听;
  map-shell 视图接线 effect 先同步 mapInstance ref,时序已对账)。

## 三、遇到的问题(需 boss 裁决/真机验证)

1. **⚠ work 模式 zoom ≤ 8「POI 都消失了」根因候选在 map-shell.tsx(不在
   ws-b 边界)**:城市聚合徽章由 map-shell cluster effect 创建,依赖
   [clusterState, mapReady, modeConfig.color] —— 引擎切换时三者均不变 →
   徽章随旧 view 销毁后**不重建**;同时聚合分支的 visiblePOIIds 只显示
   「无 city 的个体 pin」→ 城市公司全部不可见。domain 模式无聚合
   (clusterState=null → LOD 分支全显示),与 boss「domain 复现未果(1574
   蓝像素正常)」吻合。**修复建议:cluster effect 依赖加 engineView(view
   实例),一行 deps 改动,map-shell.tsx** —— 请 boss 裁决派发;
2. 用户「不丝滑」剩余可能来源(非构造选项可解,留真机判断):①触控板/像素
   增量输入被 SDK 分类 trackpad → duration 0 即时应答(设计使然,与高德
   「有动画」体验有差);②bug 1 marker anchor 偏移在缩放中表现 pin 漂移
   (ws-a 修复面)。

## 测试

- `map-engine-switch.test.mjs` 追加 4 项:①TMap 构造 scrollable:true 全量
  断言(含不含 smoothWheelZoom);②A→T / T→A 双向回放对称性(相同回放 →
  最终 marker 数量/可见/选中/高亮状态一致 + TMap 摘挂 attached 语义);
  ③无可见集回放双向不误藏;④use-work-viewport 按引擎视图重绑源码契约
  (总线订阅 + 两个 effect 依赖)。

## 门禁结果

- npm test: **1258 通过 / 0 失败 / 2 skip**(全量 1260;基线 1212 零漂移 + 新增 4)
- typecheck: 通过
- make docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过

## 证据

- SDK 核实证据串(/tmp/tmap-gljs.js,SDK v1.8.0.2):
  - `smoothWheelZoom` 0 命中;
  - `zy.mergeOptions({scrollWheelZoom:!0,wheelDebounceTime:40,wheelPxPerZoomLevel:60})`(Leaflet 2D 路径);
  - `scrollable:!0,touchZoomable:!0,pitchable:!0,rotatable:!0,doubleClickZoom:!0,mapZoomType:Rs.DEFAULT`(GL Map 选项,3D/2D 各一份);
  - `setScrollable(i.scrollable)`(运行期切换);
  - `zoomTo(h,{duration:"wheel"===this._type?200:0,around:...,delayEndEvents:100,smoothEasing:!0})`(wheel=200ms 平滑 / trackpad=即时)
- 测试输出摘要:switch 18/18;相关回归(hooks-contracts/tencent/tencent-style/lifecycle/mount/map-markers/marker-visibility)104/104;全量 1258 pass / 0 fail
- 提交:cda385f..HEAD 4 个小步 commit(5a83f79 fix tencent → 0e278d6 fix work-viewport → d24daea test → 7478142 docs)

门禁: PASSED
结论: OK
