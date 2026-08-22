# ws-k 汇报(2026-08-23)

分支 `fix/tmap-icon-frame`(worktree `/Users/acccan/dm-wt-tif`,基于 dev `c6a919a`)。
共 4 个 commit(自上而下):
- `1315c62` docs(23):ws-k 回填
- `5b3c17d` feat(map-markers):pan/LOD 可见集切换自然升级(maybeUpgradeIcon)
- `52a3d0e` fix(map-markers):远程真 logo 改 fetch 字节内联进徽章(SVG-as-image 实测)
- `0345983` fix(map-markers):badgeWithRemoteIcon 徽章包裹(初版)

## 实际改动

- `server/src/lib/map-markers.ts`
  - 抽出 `badgeShellSVG`(白底圆角 + 强调色描边 + 状态外圈),recruitmentBadgeSVG
    与 badgeWithRemoteIcon 共享——两种内容形态边框逐像素一致;
  - 新增 `badgeWithRemoteIcon(iconUrl, color, state)` → dataURL SVG:40×40 白底
    rx=10 + #007AFF 2px 边框 + 居中 `<image>`(24×24,preserveAspectRatio 保比例 +
    clipPath 圆角裁剪);selected/highlighted 外圈语义保持;
  - 新增 `fetchRemoteIconDataUri(url)` + 模块级缓存(fetch → base64 dataURI,
    成功记忆化、同 URL 只 fetch 一次、失败可重试不刷屏)+ `resetRemoteIconDataUriCache`
    (测试钩子);
  - addMarker(TMap 招聘 icon 分支):resolveTMapIconSrc 选中**远程 URL** 时不再裸传
    ——字节已缓存 → 同步 badgeWithRemoteIcon(dataURI);未缓存 → 先挂 emoji 徽章 +
    asyncUpgradeUrl,登记后 `upgradeMarkerIcon`(fetch 完成 → 摘除 + 重建,指针守卫
    防重复);本地 dataURL(emoji 徽章/图钉)路径不变;
  - 新增 `maybeUpgradeIcon`:setPOIs 存量差分 + setVisiblePOIs(pan/LOD 可见集切换)
    对 'emoji' 形态可见 marker 补检查——链式预检继续推进 + 升级;markerIconKinds
    簿记('emoji'/'logo'/'local'),removeMarker 同步清理。

## 门禁结果

- npm test: 1464 通过 / 0 失败 / 2 skip(1466 total)
- npm run typecheck: 通过
- make docs-check: 通过(§7 追加后复跑)
- git diff --check: 通过

## `<image>` 跨域光栅化实测结论(关键)

**远程直引不渲染,必须字节内联**。headless Chrome + 真实 TMap GL 管线实测:

1. dataURL SVG 内嵌 `<image href="https://icon.horse/...">` 经 Image 解码 →
   canvas/WebGL 纹理:**子资源请求根本不发出**(Network 零请求),图像区光栅化为
   浅蓝占位(197,214,243 附近)或透明——163(红)/poizon(灰)/deepseek(蓝)等不同
   favicon 全部同色,与 URL 无关 = Chrome SVG-as-image 机制性行为;dataURI 内联
   图实测正常渲染(1×1 红图 → 中心 (255,128,128));
2. fetch 内联可行:icon.horse ACAO:* → fetch(mode:'cors') 可读 → base64 内联后
   纹理恒 origin-clean(texImage2D ok,零 SecurityError / 零「Image加载失败」);
3. 初版 `<image href>` 远程直引方案已按任务预案弃用,改为 fetch 字节内联。

## 真机验收(worktree :3105 webpack + headless Chrome CDP,light 模式;:3100 被
他批 worktree 的 dev server 占用,故用 :3105)

- **自然升级路径(pan/LOD 触发,无需引擎切换)**:S1 首次加载 emoji 徽章 +
  favicon.im 预检基线噪音(180 唯一 × 2 行,既有基线);S2 reload 链推进预检
  icon.horse;S3 reload 后 ~15s 内 21/22 可见徽章**自动升级**为真 logo(批次
  setPOIs + 可见集检查路径),零交互;pan 后 20/21 保持,zoom 15/16、pan 13 可见
  12 升级;
- **升级后徽章 = 白底 + #007AFF 边框 + 居中真 logo**:style 解码证据 = 徽章 SVG
  内嵌 `data:image/x-icon;base64,...`(icon.horse 字节);像素证据:21/21 可见徽章
  蓝边框命中,中心色与内联字节 favicon 主色一致(deepseek 蓝 (77,107,254) 精确
  命中,灰/蓝多例命中;白心 = 透明底 favicon 正常表现);
- **未升级 POI 保持 dataURL emoji 徽章**(1/22,无 logoUrl 公司);
- **点击弹卡**:点击升级徽章(deepseek,854,380)→「深度求索 · 独角兽 · 人工智能 ·
  1 在招岗位 · 2.3km · 拱墅区环城北路169号汇金国际大厦」POI 卡弹出;中心堆叠徽章
  点击同弹「高频杭州」卡;
- **console**:全程零「Image加载失败」/ 纹理错误(favicon.im CORS 噪音为既有
  基线,与纹理无关);
- **零回归**:AMap 400 徽章 DOM 全渲染 / Baidu 400 徽章 DOM 全渲染。

## 遇到的问题

1. **`<image href>` 远程直引不渲染(实测推翻初版方案)**:按任务预案改 fetch 字节
   内联——这是升级路径唯一可行形态(数据已入 tech/23 §7);
2. **「pan/LOD 触发升级」落地**:map-shell b2 只增不删,pan/LOD 不重建 marker
   实例——预检 ok 后原架构下升级只在引擎切换/新 POI 时发生;在控制器内补
   maybeUpgradeIcon(setVisiblePOIs/setPOIs 检查)落地「下次重建自然升级」,真机
   实测 reload 后零交互自动升级;
3. **图标字节/预检成功为会话级内存**:reload 后 favicon.im 失败清单从
   sessionStorage 恢复 → 链即时推进 → 同会话自然升级(实测 reload 后 ~15s 内
   21/22 升级);首帧即真 logo 需持久化成功缓存,超出本任务文件边界
   (icon-preflight.ts),记录待 boss 裁决;
4. 他批 worktree(dm-wt-bbl fix/baidu-blink)dev server 占用 :3100,验证改用
   :3105,未触碰对方进程。

## 证据

- 截图:/tmp/wsk/`f1-initial.png`、`f2-chain-advance.png`、`f3-pre-pan.png`、
  `f3-after-pan.png`(自然升级后徽章)、`f3-zoom.png`、`f3-pan2.png`、
  `f3-click.png`(深度求索卡)、`reg-amap.png`、`reg-baidu.png`、
  `color-check2.png`(像素对照)、`s1-initial.png`/`s3-upgraded.png`/`s3-click.png`(引擎
  切换路径复验)
- 数据:/tmp/wsk/`final-summary.json`(逐阶段 STATE/可见集/错误数)、
  `f3-markers.json`(21 可见徽章坐标 + 升级标志)、`color-markers2.json`
  (内联 favicon 平均色)、`s3-markers.json`
- 隔离光栅化实验:/tmp/wsk/`cors-test.mjs`(初版方案)、`raster2.mjs`(dataURI 渲染/
  远程不渲染/占位色)、`raster3.mjs`(子资源零请求)、`raster4.mjs`(broken URL 同
  占位色)、`switch-diag.mjs`(引擎切换零噪音)
- 测试输出:1466 total / 1464 pass / 0 fail / 2 skip;typecheck / docs-check /
  git diff --check 零告警
- 文件边界:仅 map-markers.ts / 2 个测试文件 / tech/23(仅追加 §7);「不碰」清单
  零改动;未 merge 回 dev、未 push;分支与 worktree 留原地

门禁: PASSED
结论: OK
