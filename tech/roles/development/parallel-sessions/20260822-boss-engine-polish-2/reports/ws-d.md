# ws-d 汇报(2026-08-22)

## 实际改动

worktree `/Users/acccan/dm-wt-tl`,分支 `fix/tencent-locate`,3 个小步 commit:

1. `8b46557 fix(tencent)` — `server/src/lib/map-engine/tencent/tencent-engine.ts` `browserPosition()`:
   `getCurrentPosition` 第三参 `{ timeout: 8000, maximumAge: 60000 }` →
   `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }`(对齐 AMap.Geolocation;
   maximumAge 0 禁用 60s 位置缓存,每次定位重新请求;wgs84→gcj02 转换保留);
   函数注释补充参数对齐说明。仅动定位段,marker/icon/anchor 段零改动。
2. `e735d28 test(tencent)` — `server/tests/map-engine-tencent.test.mjs` 既有
   `getCurrentPosition(浏览器定位)` 用例扩展:mock 捕获第三参 opts,断言
   `enableHighAccuracy === true` / `maximumAge === 0` / `timeout === 8000`;
   坐标转换断言(gcj02 偏移)与失败/无 navigator → null 分支保留。
3. `2545985 docs(23)` — `tech/23-map-engines.md` 追加(仅追加,文件尾部新节)
   「ws-d 回填:腾讯定位高精度对齐」:三引擎定位通道对照表
   (AMap=Geolocation 控件 enableHighAccuracy / 腾讯=浏览器高精度
   enableHighAccuracy+maximumAge 0 / 百度=BMapGL.Geolocation SDK IP 定位——
   标注由 ws-b 修)+ 改动说明 + 测试说明。无任何既有内容修改。

## 门禁结果

- npm test: 1375 通过 / 0 失败(2 skip;基线 1364,增量来自 worktree 基线上
  已并入的其他批次 WS;本 WS 无新增用例数,扩展现有用例)
- typecheck: 通过(tsc --noEmit 零错误)
- make docs-check: 通过
- git diff --check: 通过(clean,工作树无未提交改动)

## 遇到的问题

无。三引擎定位通道事实已在改前核实:AMap=amap-api.ts L567-578
`new AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000,
maximumAge: 30000, convert: true, ... })`;百度=baidu-engine.ts L1011-1035
`BMapGL.Geolocation` SDK 定位(bd09→gcj02),无高精度参数 —— 与 boss 侦察一致。

## 证据

- `node --test tests/map-engine-tencent.test.mjs`:58 pass / 0 fail
  (含扩展后的定位用例:参数断言 3 项 + gcj02 偏移断言 + 失败/null 分支)
- 全量 `npm test`:tests 1375 / pass 1373 / fail 0 / skip 2

门禁: PASSED
结论: OK
