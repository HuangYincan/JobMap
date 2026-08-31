# ws-a 汇报(2026-08-22)— fix/baidu-style(百度卫星常量修正 + 深色实现)

## 常量核实结论(SDK 源码证据)

抓取 `https://api.map.baidu.com/getscript?type=webgl&v=1.0` 本体(1.2MB,2026-08-22)grep:

- 真实定义(逐字):`window.BMAP_NORMAL_MAP="B_NORMAL_MAP"; window.BMAPGL_NORMAL_MAP="B_NORMAL_MAP"; window.BMAP_SATELLITE_MAP="B_SATELLITE_MAP"; window.BMAP_HYBRID_MAP="B_HYBRID_MAP"`
- **`BMAPGL_SATELLITE_MAP` 不存在**(全 SDK 0 命中)→ 旧常量解析 undefined → setMapType 静默跳过 → 卫星切换无效果(用户 bug 1「卫星没实现」根因);normal 靠 BMAPGL_NORMAL_MAP 别名侥幸可用
- `setMapType` 按常量字符串值解析(ev()→kO 注册表,卫星 `kY("B_SATELLITE_MAP","卫星",{compatType:"BMAP_SATELLITE_MAP"})`)
- 修正:STYLE_CONSTANT 统一用 SDK 主名 `BMAP_NORMAL_MAP` / `BMAP_SATELLITE_MAP`

## 深色实现方式(SDK 核实)

- `map.setMapStyleV2({styleJson: [...]})` —— SDK:`setMapStyleV2(e) → setOptions({style: e})`;`getStyleJson` 直接消费 styleJson 数组(`{featureType, elementType, stylers}`,elementType 词表 SDK 核实:geometry(.fill/.stroke/.sidefill/.topfill)/labels(.text.fill 等));styleId 服务端拉取形态存在但不采用
- 深色 = `BAIDU_DARK_STYLE_JSON`(15 条):基底深蓝黑、水系/绿地低饱和、道路逐级提亮(highway>arterial>local)、标注文字亮色 + 深色描边、边界中亮描边
- **离开深色必须显式复位**:config.style(对象)持续生效,setMapType 不清理(源码核实)→ 切回 normal/卫星先 `setMapStyleV2({styleJson: []})` 再 setMapType(与腾讯 setMapStyleId('DEFAULT') 同契约);WeakSet 状态追踪,无深色历史零自定义管线加载
- 样式 id 语义:**UI 图层面板「深色」= `whitesmoke`**(`MapStyleId` 类型无 'dark',types.ts 在「不碰」清单内;map-shell `["whitesmoke","dark"]`)→ `setStyle('whitesmoke')` 即深色,不再 warn 回退;setMapStyleV2 缺失 → warn 降级 normal 不抛

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts`(仅样式段)→ STYLE_CONSTANT 修正(BMAP_* 主名)+ 新增 BMapStyleItem 接口 / BAIDU_DARK_STYLE_JSON(15 条深色规则)/ styleJsonApplied WeakSet;applyMapStyle 重写(whitesmoke→深色、离开深色复位 + setMapType、setMapStyleV2 缺失降级、类型外回退 warn);BMapInstance 接口补 setMapStyleV2?(可选)
- `server/tests/map-engine-baidu.test.mjs` → mock 只装 SDK 真实常量(BMAP_NORMAL_MAP/BMAP_SATELLITE_MAP,不再装虚构 BMAPGL_SATELLITE_MAP);既有断言改真实常量值;+4 项:whitesmoke→styleJson 形状断言(每项 featureType/elementType/stylers + label 亮色可读)、深色→normal/卫星复位 + 状态追踪、setMapStyleV2 缺失 warn 降级、createView({style:'whitesmoke'}) 就绪后即应用深色
- `tech/23-map-engines.md`(仅追加 51 行)→「ws-a 回填:BMapGL 底图常量核实 + 深色实现」:常量逐字证据、setMapStyleV2 核实、复位契约、whitesmoke=「深色」语义

## 门禁结果

- npm test: 1377 通过 / 0 失败 / 2 skip(基线 1364;baidu 文件 63→67)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 官方文档页(lbsyun.baidu.com FAQ)为 JS 渲染应用,curl 拿不到正文 → 以 SDK 本体源码 grep 为核实依据(常量定义/API 形态/复位语义均有源码证据,比文档更硬)
- boss prompt 写 `setStyle('dark')`,但 `MapStyleId` 类型是 `'normal'|'satellite'|'whitesmoke'` 且 types.ts 在「不碰」清单 → 按图层面板真实语义实现 whitesmoke→深色(与 AMap/腾讯 whitesmoke 语义一致),已在代码注释与 tech/23 明确标注
- 深色复位用 `setMapStyleV2({styleJson: []})`(空数组=默认渲染,源码核实走同一管线);未采用 `styleId`(服务端拉取,不可控)

## 证据

- SDK 常量逐字定义与 0 命中计数(抓取文件 /tmp/bmapgl.js 可复查)
- setMapStyleV2 实现链:setMapStyleV2→setOptions({style})→getStyleJson 读 styleJson / styleId 分支;config.style 默认值 "default";elementType 词表 grep 计数
- 测试输出:map-engine-baidu 67 pass / 0 fail;全量 1377 pass / 2 skip / 0 fail
- commit 3 枚:7649e5b(fix,引擎)、53d0b19(test)、262b49d(docs)

门禁: PASSED
结论: OK
