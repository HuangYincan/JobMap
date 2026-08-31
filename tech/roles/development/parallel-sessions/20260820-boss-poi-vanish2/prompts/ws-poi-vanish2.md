# WS: ws-poi-vanish2 — createMap 恢复相机 + settle 默认位置门控

## 背景(第三轮修复,用户确认仍未解决)

用户 bug:「第一次点击公司 POI → 地图先回到默认初始化位置(杭州 [120.15,30.27] zoom 13)→ 所有 POI 消失」。前两轮(933f972 全量加载去门控、cd360dd userMovedMapRef/handleLocate/distance)未解决。

**根因(浏览器实测,worktree 内代码已是最新 dev)**:
移动端首次点击 pin → 打开详情 → 详情模块首次按需编译(Next dev on-demand compilation)→ HMR fast refresh → **MapShell fiber 重建(React 复用 DOM 节点,canvas 引用不变)** → createMap effect(444 行,deps=[])重跑 → `new AMap.Map` 第二次构造(实测构造栈 `MapShell.useEffect → initMap → createMap`)→ 新实例回到**硬编码默认** `createMap([120.15, 30.27], 13)`(469 行)→ 相机回杭州默认 + 全部 marker 重建消失。

关键事实:
- state 声明:190 行 `const [zoom, setZoom] = useState(13)`;204 行 `const [mapCenter, setMapCenter] = useState({ lng: 120.15, lat: 30.27 })`
- fast refresh 会保留 hook state → remount 后 mapCenter/zoom state = 用户上次视野的值
- settle 分支(503-523 行):`if (!userMovedMapRef.current) { map.setCenter([lng, lat]); map.setZoom(15); setMapCenter(...) }`——remount 后 userMovedMapRef 重置 false,若相机已被恢复,settle 会抢镜头

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-poi-vanish2)

1. **createMap 初始相机改用 state**(map-shell.tsx 469 行附近):
   `createMap([120.15, 30.27], 13)` → `createMap(mapCenter, zoom)`
   - 首载:state = 默认值(行为不变);remount(fast refresh):state = 用户上次视野(恢复相机,不再回杭州)
   - 注意:createMap 的调用点在 useEffect 闭包内,确认闭包能取到最新 state 值(首载与 remount 时闭包捕获的 mapCenter/zoom 即当次渲染值)
2. **settle 飞用户位置加「相机仍处默认位置」门控**(514 行附近):
   条件从 `if (!userMovedMapRef.current)` 改为 `if (!userMovedMapRef.current && <相机距默认中心 [120.15,30.27] 小于阈值>)`
   - 阈值建议 0.1 度(≈11km);实现方式自裁(纯函数 + 常量,便于测试;如 `isNearDefaultCenter(center)` 放 lib 或组件内均可,以可单测为准)
   - 语义:首载相机=默认 → settle 仍飞用户位置;remount 恢复的用户视野(非默认) → settle 不抢镜头;手动移图(userMovedMapRef=true) → 不飞(原语义)
3. **契约测试**(server/tests/ 现有文件,静态正则/纯函数风格,新增或改写):
   - createMap 调用处不再是字面量 `createMap([120.15` 或 `, 13)`(断言 `createMap(mapCenter, zoom)` 或等价形态)
   - settle 门控含默认中心距离条件(断言新条件/函数存在)
   - 上轮契约保持:userMovedMapRef 只在 dragstart/zoomstart/flyTo 入口置位、handleLocate 失败无 120.15/setZoom(13)、distance 定位前剥离
   - 现有 495/493/2 基线不许 fail
4. **不改**:UI 设计/视觉、聚合徽章、地图组件架构重构(超出范围)、Next dev 工具行为

## 文件边界
server/src/components/map-shell.tsx + server/tests/*(契约)。如需新增纯函数可加 server/src/lib/ 下文件。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-poi-vanish2 && make docs-check
cd /Users/acccan/dm-wt-poi-vanish2/server && npm test
cd /Users/acccan/dm-wt-poi-vanish2/server && npm run typecheck
cd /Users/acccan/dm-wt-poi-vanish2 && git diff --check
```

## 提交
小步 Conventional Commits:`fix(map-shell): createMap 初始相机用 state,remount 恢复视野不回默认` / `fix(map-shell): settle 仅默认位置时飞用户位置,不抢恢复镜头`。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-poi-vanish2/reports/ws-poi-vanish2.md:
- 每个 commit 摘要 + 改动点(file:line)
- 阈值与实现方式说明
- 契约测试新增断言
- 遇到的问题(如有;重点:createMap 闭包取值是否有坑)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
