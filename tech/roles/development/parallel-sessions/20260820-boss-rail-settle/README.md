# Batch Manifest — 20260820-boss-rail-settle

## 目标

修复 bug:**第一次点击侧控栏任何会弹出二级卡片的 item(Profile/Saved/Recent/Layers)时,整个网页"刷新一下"**。用户补充:「复现取决于视角,绝大多数情况触发」「bug 仍然存在」(上一批 51c0406 挂载预载修复已证伪 dev chunk 编译假设)。

## 根因(已确认,三重证据)

**机制 = map-shell.tsx 的 geolocation settle 相机跳变**(createMap 内,L531-553):

1. **代码证据**(Explore 深挖):createMap 内 `getCurrentPosition` resolve 后,门控 `!userMovedMapRef.current && isNearDefaultCenter(map.getCenter())`(L544)命中 → `map.setCenter([lng,lat]); map.setZoom(15)`(L545-547)**瞬间无动画整幅跳变**。跳变引发:全屏地图(inset:0)瓦片整体重载 + 距离圈重建 + work 列表重裁 + 聚合/LOD 切换 —— 一帧内整个页面内容全部变化 = 「整页刷新」观感。
2. **「取决于视角」对应**:门控 `isNearDefaultCenter`(lib/camera-center.ts,0.1°≈11km 阈值)—— 用户拖过图(离开默认中心)→ 不触发;绝大多数用户不拖图 → 触发。
3. **实测复现(boss,Playwright + grantPermissions + geolocation 延迟)**:无 geolocation 权限 → 永不复现(此前批次无法复现的原因);授权后页面加载 ~1.2s 时 zoom=13,geolocation resolve(延迟 5s/30s 均验证)时 zoom 瞬间 13→15 跳变。**跳变时机完全由 geolocation resolve 决定,与点击无因果,只落在用户首交互时间窗**(权限弹窗/8s 超时/30s 缓存)。

**结论**:「首次点击 → 页面刷新」= 首点时间窗与 geolocation resolve 重合 + 视角在默认中心 → 整幅跳变。React 层无 remount(createMap 依赖 `[]`,rail 点击不触任何地图 effect),无浏览器级 reload(实测 navType 恒 navigate)。

## 修复方案

**settle 门控增强**:MapShell 挂载时注册「用户首次交互」一次性监听(`pointerdown` / `keydown` / `touchstart` / `wheel`,document 级,置位后移除),新增 `userInteractedRef`。settle 门控(L544)增加 `!userInteractedRef.current`:

- 用户加载后**从未交互** → geolocation resolve → 自动定位跳变(保留现有功能语义,通常 resolve 快,属于加载过程);
- 用户**已交互**(首点 rail / 拖动 / 按键)→ resolve 不再跳变(不抢镜头;用户需要定位可点「定位」按钮 handleLocate,L1731-1752)。

符合用户诉求「初次加载不刷新(不在交互时跳变)」,修复 bug 但保留现有设计语义(自动定位仅对未交互会话保留)。

## workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| w1 | fix/settle-user-interaction-gate | /Users/acccan/dm-wt-w1 | settle 门控加「用户已交互」ref | server/src/components/map-shell.tsx(+lib/camera-center.ts 如确需) | 其他一切;不改 UI 设计、不改 dynamic/预载逻辑(51c0406)、不加动画改语义 |

## 合并顺序

1. w1(唯一 WS,直接合并)

## 门禁

- `cd server && npm test`(基线 500 pass / 2 skip)
- `cd server && npm run typecheck`
- `make docs-check`、`git diff --check`

## 验证(boss 复验)

- Playwright + grantPermissions + geolocation 延迟 5s:加载 1.2s 后**首点 rail item** → resolve 后 zoom 应保持 13(不再跳变);
- 对照组:加载后**不交互** → resolve 后 zoom 应 13→15(自动定位保留)。
