# ws-c 汇报(2026-08-19)

## 实际改动
- `server/src/components/map-shell.tsx`(Bug3 修复,已由前次 `0207a52` 提交主体,本次 `b3fe0dc` 补齐)
  - `hasInteractedRef = useRef(false)`(line 233):新增「用户是否已接管相机」标记。
  - 挂载 geolocation 回调(`~549-576`):`getCurrentPosition(map)` 成功回调里
    `setUserLocation`/`setSearchOrigin`/`setGeoSettled` 照常(定位数据/蓝点不受影响);
    相机移动改为 `if (!hasInteractedRef.current) { map.setCenter + map.setZoom(15) }`
    门控。
  - `b3fe0dc` 追加:原 `setMapCenter({ lng, lat })` 在 `if` **外**无条件执行,会在地理定位
    晚落地时把距离圆心(mapCenter,ws-b 语义跟随镜头)甩去用户位置 → 移入 `if` 内,
    与相机一起受门控。已交互(点过 pin)后背景定位落地不再拽相机、也不甩 distance 圆心。
  - 交互标记置位:`map.on("dragstart"/"zoomstart"/"click")`(line 727-735)与
    `onMarkerClick`(line 1621,AMap marker click 不触发 map click,须单独置位)均置
    `hasInteractedRef.current = true`。挂载时不无条件抢占。
  - `handleLocate`(line 1930,「定位」按钮)保持原义:仍无条件 `setCenter`+`setZoom(15)`
    +`setMapCenter`,不受 `hasInteractedRef` 门控。
- `server/tests/component-contracts.test.mjs`(新增 Bug3 契约单测)
  - 断言:ref 声明、geolocation 回调里 setUserLocation/setSearchOrigin 照常、
    `if (!hasInteractedRef.current)` 门控 setCenter+setZoom+setMapCenter、四个交互入口
    (drag/zoom/click/marker)置位、handleLocate 段无条件 setCenter+setZoom 且不受
    hasInteractedRef 影响。

## 门禁结果
- npm test: 412 通过 / 0 失败(skipped 2,与门禁基线一致)
- typecheck(tsc --noEmit): 通过
- make docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过

## 遇到的问题
- 契约单测最初用单行正则 `handleLocate = () => {...mapInstance.current.setCenter...}`
  匹配 handleLocate 段失败(handleLocate 声明与 setCenter 调用间隔超过 `{0,400}` 长度,
  且区间内出现 mapInstance.current.setZoom)。→ 改为按
  `handleLocate`..`handleMapStyleChange` 之间 slice 出定位按钮段,分别断言
  setCenter+setZoom 存在、且该段 `doesNotMatch(/hasInteractedRef/)`,证明定位按钮不受门控。

## 证据
- npm test 尾部:ℹ tests 414 / pass 412 / fail 0 / skipped 2
- 根因(Explore 已确认):挂载 geolocation(AMap 真异步,数秒级)与用户首次点 pin 竞态,
  geolocation 回调晚落地无条件 `setCenter(userLocation)` 把相机从被点公司拽回用户位置;
  定位只 resolve 一次 → 仅第一次点击受影响。
- 修复语义:userLocation/searchOrigin 照常作数据原点与蓝点;「用户自己点定位按钮仍会移
  过去」原义保留;只有挂载时的隐式定位在用户已交互后不再抢占。

门禁: PASSED
结论: OK
