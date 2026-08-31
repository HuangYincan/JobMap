# Workstream — fix/tmap-icon-frame(腾讯 icon.horse 升级丢失徽章边框)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-tif`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-k.md`(末两行 token,见文末)。

## 背景(boss 真机实测,2026-08-23,dev c6a919a)

**用户报:「腾讯地图下poi依然很奇怪,只有icon没有边框」;boss 实测确认**:

- 腾讯引擎,TMap MultiMarker 纹理路径:首次渲染用 dataURL 徽章(白底 + #007AFF 边框 + emoji,`recruitmentBadgeSVG`);
- **icon-preflight 预检成功后,`resolveTMapIconSrc` 升级为 icon.horse 真 logo URL**(ws-c 候选链 + ws-e 预检升级设计:「预检成功后下次重建自然升级真 logo」)—— **升级后纹理 = 裸 favicon(icon.horse 返回透明底小图标),无白底无边框**;
- hook 实证:400 geometry 中相当部分引用 dm-st-11+(src = `https://icon.horse/icon/...`);渲染 = 裸图标浮在地图上;
- **与 AMap/百度不一致**:AMap/Baidu 走 content = `recruitmentBadgeHTML`(白底 + #007AFF 边框 DOM 徽章 + 内部 logo/emoji)—— 三引擎视觉语言应一致(ws-a 设计:「视觉与 AMap 同语言」)。

## 任务

### 1. 升级保留徽章形态(主修复)

icon.horse 升级时,**徽章边框必须保留**:把远程 favicon 包进徽章 SVG 再作纹理:

- 新函数(建议放 map-markers.ts,与 recruitmentBadgeSVG 相邻):`badgeWithRemoteIcon(iconUrl, color, state)` → dataURL SVG:白底圆角 + #007AFF 边框(复用 recruitmentBadgeSVG 的视觉语言:40×40、rx=10、stroke #007AFF 2px)+ **居中 `<image href="${iconUrl}">`**(约 24×24 居中,object-fit 语义用 preserveAspectRatio + clipPath 圆角裁剪);
- `resolveTMapIconSrc` 的调用方(map-markers.ts L604):当选中 src 为**远程 URL**(icon.horse)时,icon.src 改用 `badgeWithRemoteIcon(src, color, state)`(而非裸 URL);本地 dataURL 徽章路径不变;
- **CORS 必须实测**:dataURL SVG 内嵌 `<image href="https://icon.horse/...">`,TMap WebGL 纹理化的 SVG 光栅化是否支持跨域 image(icon.horse 有 `access-control-allow-origin: *`,ws-c 已实测)。**若 <image> 跨域光栅化失败**(纹理空白/报错)→ 改方案:先 `fetch(iconUrl)` 取字节 → base64 dataURI 内联进 SVG(**fetch 跨域:icon.horse 有 ACAO,可读**);若 fetch 也受限,记录结论并降级「保持 dataURL emoji 徽章」(不升级,视觉与 AMap 同语言,至少不回归)。
- 状态样式(selected/highlighted)保持现有语义(外圈 + 尺寸缩放)。

### 2. 真机验收(必须)

- worktree :3100 或主树 :3000,腾讯引擎,等待预检完成 + pan/LOD 重建触发升级:
  - **升级后徽章 = 白底 + #007AFF 边框 + 居中真 logo**(与 AMap 视觉一致),不再是裸 icon;
  - 未升级 POI 保持 dataURL 徽章;点击弹卡;缩放/pan 完整;reload 复验;
  - console:无「Image加载失败」/ 纹理错误(升级路径的 SVG 光栅化无报错);
  - AMap/Baidu 零回归。
- `cd server && npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`
- `tech/23-map-engines.md` 回填(仅追加:升级保留边框机制 + CORS 实测结论)

## 文件边界

- 只允许改:`server/src/lib/map-markers.ts`(badgeWithRemoteIcon + 调用点)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(仅追加)
- **不碰**:tencent-engine.ts(如无必要)、baidu-engine.ts、amap 引擎、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-tif/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-tif && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-k.md`:`<image>` 跨域实测结论、方案实施、真机验收(升级后徽章形态/点击/零回归)。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
