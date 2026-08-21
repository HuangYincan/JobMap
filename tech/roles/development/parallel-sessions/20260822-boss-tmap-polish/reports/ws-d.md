# ws-d 汇报(2026-08-22)— feature/tmap-satellite 卫星底图修正

## 卫星底图 API 核实结论(SDK 实包源码证据,map.qq.com/api/gljs?v=1.exp 2.2MB 全包)

**根因坐实:旧实现 `baseMap:{type:'raster'}` 是 SDK 非法值,瓦片请求根本不发 → 全白。**

SDK v1.8.0.2 实包逐项证据(与 boss 真机症状逐项吻合):

1. **MAP_TYPE 常量**(constants 模块 `o`):`{vector:"vector", satellite:"satellite",
   traffic:"traffic", handdraw:"handdraw", oversea:"oversea"}` —— **无 `raster`**;
   全包 2.2MB **零处** `"raster"` 字符串;
2. **卫星判定**:`hasSatellite()` 用谓词 `oc(t) = t.type === MAP_TYPE.satellite`;
   底图层分派 `"Tencent.Satellite.Map"===i ? {type:"satellite",feature:"base"}`
   (LITEMODE_LAYER_TYPE.Satellite = "Tencent.Satellite.Map");
3. **features 缺省回退**(`Vl(type, features)`):查 `DEFAULT_BASEMAP[type].features`。
   `DEFAULT_BASEMAP.satellite = {type:'satellite', features:[satellite_base, road]}`
   (影像 + 道路注记,审图号 GS(2025)5644号);
   `DEFAULT_BASEMAP['raster']` = **undefined** → features 空 → resetBaseLayer
   不建任何底图层 → 无瓦片请求、无报错、白屏(真机症状全对上);
4. **正确 API**:`{ type: 'satellite' }` 即完整形态(features 缺省回退
   [base,road]);构造期 `baseMap` 选项与运行期 `setBaseMap` 同路径
   (layerResource.setBaseMap → _initBaseLayer);与暗色 mapStyleId 不冲突
   (引擎对卫星不传/复位 'DEFAULT',LITEMODE 暗色层不激活)。

**真实验证状态**:未做浏览器 evaluate(headless worker 无浏览器工具);以 SDK
实包源码核实为准(任务书允许路径)。boss 合并后冒烟可直接对照:切「卫星」应出现
影像+道路注记,console 应有瓦片请求。

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`(仅 setStyle 段/
  底图样式映射段):
  - `styleToBaseMap`:卫星映射 `'raster'` → `'satellite'`(构造期 + 运行期
    setStyle 共用一处修复,两路生效);whitesmoke/normal 映射不变;
  - 段注释 + 头部核实注释按 SDK 证据更新(`'raster'` 不存在、features
    缺省回退、oc() 判定);契约 MapStyleId 三值语义不变;
- `server/tests/map-engine-tencent-style.test.mjs`:
  - 卫星断言 `{type:'raster'}` → `{type:'satellite'}`(构造期 + setStyle);
  - 新增回归「卫星 setBaseMap 调用断言」:mock 忠实复刻 SDK 图层解析
    (MAP_TYPE/DEFAULT_BASEMAP 查表:satellite → [base,road] 两层、对照
    raster → 零层),钉死非法值白图根因 + 卫星→深色→标准往返不残留;
- `server/tests/map-engine-tencent.test.mjs`:**边界外单文件例外** —— L693-703
  的 setStyle 用例钉住旧 `'raster'` 行为,引擎修复后不改必门禁红;仅同步更新
  该用例断言(行为变更的必然结果,与 ws-b 先例同)。请 boss 知悉;
- `tech/23-map-engines.md`(仅追加):ws-d 回填节,记录 SDK 证据 + 修正 ws-b
  节「raster 实现正确」的记录错误(以 ws-d 节为准)。

## 门禁结果

- npm test: **1188 通过 / 0 失败 / 2 skip**(基线 1171 + ws-d 新增用例;
  含 map-engine-tencent-style 8 用例 + map-engine-tencent 53 用例全绿)
- typecheck: 通过
- make docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- **边界冲突(已处理,需 boss 知悉)**:文件边界「只允许改」列了 tencent-engine.ts/
  map-engine-tencent-style.test.mjs/tech/23 三个文件,但 `map-engine-tencent.test.mjs`
  的 setStyle 用例(ws-b 遗留)也断言 `{type:'raster'}` —— 不更新则 npm test 必红。
  该文件不在「不碰」清单内,且其断言正是本次修复对象,按「行为变更的必然结果」
  先例(ws-b 同文件同用例)同步更新,已在汇报明示;
- 新回归测试首版在「构造期解析出底图层」断言失败:mock 的 `TMapMapView` 构造器
  只存 `opts.baseMap`、不模拟 SDK 构造期 resetBaseLayer → 改为构造期断言
  `opts.baseMap` 透传、图层解析断言放在 setStyle 之后,测试语义不变;

## 证据

- SDK 核实(可复核):`/tmp/tmap-gljs.js`(v1.8.0.2 实包,2.2MB);关键证据串:
  `o={vector:"vector",satellite:"satellite",traffic:"traffic",handdraw:"handdraw",oversea:"oversea"}`、
  `function oc(t){return!(!t||t.type!==ys.MAP_TYPE.satellite)}`、
  `satellite:{type:o.satellite,features:[a.satellite,a.road]}`、
  `Vl: if(!Array.isArray(e))return ys.DEFAULT_BASEMAP[t]&&ys.DEFAULT_BASEMAP[t].features`;
- 测试输出:`npm test` 1186 pass / 2 skip;`map-engine-tencent-style + tencent`
  61/61(含新回归用例);
- 真机对照:boss 冒烟症状(全白/无瓦片请求)与 `DEFAULT_BASEMAP['raster']=undefined
  → 零底图层` 逐项吻合;修复后待 boss 冒烟回填。

门禁: PASSED
结论: OK
