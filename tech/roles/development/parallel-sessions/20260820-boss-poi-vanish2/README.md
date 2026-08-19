# 批次 Manifest — 20260820-boss-poi-vanish2

目标:修复「第一次点击公司 POI → 地图回到默认初始化位置(杭州)→ POI 消失」(第三轮,用户确认仍未解决)。

## 根因(浏览器实测铁证 + 调用栈,2026-08-20)

**移动端首次点击 pin → 打开详情 → 详情相关模块首次按需编译(Next dev on-demand compilation)→ HMR fast refresh → MapShell fiber 重建(DOM 节点复用,canvas 引用不变)→ createMap effect(444 行,deps=[])重跑 → `new AMap.Map` 第二次构造(实测 mapsCreated 0→1,调用栈 `MapShell.useEffect → initMap → createMap → new AMap.Map`)→ 新实例回到硬编码默认 `createMap([120.15,30.27], 13)`(469 行)→ 相机回杭州默认 + 全部 marker 重建。**

证据:
- 点击 pin 后 1s 内 mapsCreated 0→1,相机 [120.15,30.27] zoom 13
- canvas/amap-container 节点引用不变(React 复用 DOM,非整树卸载)
- 点击后 SCRIPT 节点反复 remove/add(Next dev 按需编译注入)
- 预热(先打开一次详情)后点击不再复现——与「首次点击」触发编译吻合
- 无 React 渲染错误(console 仅 429 限流 + AMap 内部警告)

## 修复方案(worker 实施,3 点)

1. **createMap 初始相机用 state 而非硬编码默认**:469 行 `createMap([120.15, 30.27], 13)` → `createMap(mapCenter, zoom)`(state 声明:190 行 zoom 初始 13、204 行 mapCenter 初始 {120.15,30.27})。fast refresh 保留 hook state → remount 后地图恢复用户上次视野(而非回杭州);首载时 state=默认值,行为不变。
2. **settle 只在相机仍处默认位置时飞用户位置**:514 行 `if (!userMovedMapRef.current)` → 追加「相机仍在默认初始化位置」条件(与 [120.15,30.27] 距离 < 0.1 度)。原因:remount 后 userMovedMapRef 重置为 false,若相机已被恢复(用户上次视野/公司位置),settle 不应再 setCenter(用户位置)抢镜头;首载相机=默认 → 仍飞用户位置;手动移图 → userMovedMapRef=true 不飞(原语义保留)。
3. **契约测试锁定**(server/tests/ 现有文件,静态正则 + 纯函数风格):
   - createMap 调用处不再硬编码 `[120.15, 30.27], 13` 字面量(断言 `createMap(mapCenter, zoom)` 形态)
   - settle 门控含「默认中心距离」条件(断言新增条件存在,如 `isDefaultCenter` / 距离判断)
   - 现有测试(基线 495/493/2)不许 fail;上轮契约(用户移动标志、handleLocate 不回默认)保持

## Workstream(单 WS)

| ws | 分支 | worktree | 主题 | 合并顺序 |
|---|---|---|---|---|
| ws-poi-vanish2 | fix/map-remount-camera | /Users/acccan/dm-wt-poi-vanish2 | createMap 恢复相机 + settle 默认位置门控 | 1 |

## 不做(Deferred)

- 消除 Next dev 按需编译/HMR 本身(dev 工具行为,非产品代码)
- 地图组件重构(大工程,非本次范围)
- UI 设计变更(无)

门禁:`cd server && npm test` 全绿 + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/ws-poi-vanish2.md,末两行 token。Worker 不 merge、不 push、不碰主树,worktree 已预建。
