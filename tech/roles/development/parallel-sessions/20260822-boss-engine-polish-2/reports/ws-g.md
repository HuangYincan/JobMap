# ws-g 汇报(2026-08-22)

分支 `fix/baidu-r5`(worktree `/Users/acccan/dm-wt-br5`,基于 dev `5e23c91`)。
3 个 commit:`9601ba0`(引擎修复)、`76d496c`(测试 +5)、`385155e`(docs 回填)。

## 实测复现(worktree :3100 dev server + Playwright 真机 Chromium + 真实 AK)

- 注入链路正常:1048 个 `.dm-badge` 注入成功、**0 警告、0 console 报错**(与
  r4 修复一致,注入不是本次问题)
- **定位错乱复现**:1048 徽章中仅 ~32 个在视口内(位置正确、视觉可见),
  **其余全部在 ±worldSize**(z13:minX −1,250,858 / maxX +1,252,305;z15:
  ±5,009,432 —— 与 boss 实测 5,009,397 同量级),缩放逐级翻倍
  (z13 ±1.25M → z12 ±0.63M → z15 ±5.0M)
- 徽章点击:视口内徽章点击 → `.dm-badge-selected` + POI 详情面板(点击可达)

## 定位错乱根因(SDK 源码 + 真机 hook 双重坐实)

**BMapGL v1.0 marker 模块 `_getPixPos` 恒传 `fixPosition: true`;`pointToOverlayPixelIn`
把「视口外」像素按整世界尺寸反绕到 ±worldSize:**

- SDK 源码(`Marker.prototype._getPixPos.toString()`,真机抓取):
  `mu={zoom:T,center:i,fixPosition:true}; C=this.map.pointToOverlayPixelIn(e,mu)`
- `pointToOverlayPixelIn` fixPosition 分支:
  `if(C.x>mu.width){C.x-=ceil((C.x-mu.width)/i)*i}else if(C.x<0){C.x+=ceil((0-C.x)/i)*i}`
  (i = `worldSize(zoom)`:z13 ≈ 1,252,358px,z15 ≈ 5,009,432px)
- 效果:任何视口外 marker 被反绕到 ±worldSize(百万 px 级)且**缩放逐级翻倍**;
  视口内 marker(x∈[0,width])不触发分支 → 位置正确(解释了 r3/r4 验收「部分
  可见」与 boss「全量屏幕外」两种形态的并存)
- 真机补充:marker DOM 在 addOverlay 与每次相机变化都被 SDK 重写(实例属性
  hook 坐实 ~4.4×10^5 次/数秒投影调用)→ 注入后不主动覆写就无法纠正

## 修复(baidu-engine.ts,两段式)

1. **实例级遮蔽** `map.pointToOverlayPixelIn`(view 构造时):强制
   `fixPosition:false` —— SDK 与引擎经属性查找的**全部**投影调用拿到未反绕
   视口像素(内部数学不变:`(point−centerPoint)/zoomUnits+width/2`,与 SDK
   反绕前中间值字节级等同;own property 优先于原型)
2. **注入即校准 + 相机事件重算**(moveend/zoomend/tilesloaded,懒注册,
   首个 content marker 时绑定;空视图零监听残留):`repositionContentMarkerDom`
   以未反绕投影覆写 DOM left/top(减锚点分量 anchor=-契约 offset,与 SDK
   `C.x+=mw.width-mv.width` 逐像素同语义)——对绕开属性查找的路径兜底;
   remove 摘除即注销、destroy 解绑

## 回归验收(修复后 :3100,同环境)

- **±worldSize 爆炸消除**:marker left 分布 = 视口内 50 + 视口外近距
  (Hangzhou 域 POI,≤±1.5 万 px)+ 远距真值(全国/国际数据:拉萨/乌鲁木齐/
  新加坡/旧金山等,±10 万~±100 万 px 与地理距离 zip 逐点严格对应)——不再有
  与距离无关的固定 ±worldSize
- 视口内徽章:z13 32 个可见(与修复前一致)、点击命中、位置正确
- 缩放/平移跟随:z13→z12→z11→z10→z9 可见数 32→39→133→150→375(密度随
  距离衰减的亚线性增长符合预期);z15 视口内 13、pan 后新中心 3;z13 停 7s
  位置零漂移
- 聚合 z≤8:+270 聚合 marker(addOverlay 1048→1318),54×54 簇徽章可见;
  z10/z13 切回单点正常;深色/卫星路径未触碰(既有 ws-a/ws-e 测试 + 验收保持)
- 注入 0 警告、console 零报错

## 门禁结果

- npm test: **1432 通过 / 0 失败 / 2 skip**(baidu 90/90,+5)
- typecheck / docs-check / git diff --check: 通过

## 遇到的问题

1. 注入后 SDK 每帧重写 DOM(属性 hook 坐实)→ 单靠注入时机校准会输掉竞态:
   b5 实测注入后 190 次 fixPosition:false 校准被 SDK 2810 次 fixPosition:true
   重写盖掉 → 补实例级遮蔽(从源头禁用反绕)+ 相机事件校准双保险
2. 修复后 minX 仍达 −84 万 px:zip 核对为**真实远距 POI 的真值偏移**(旧金山
   等国际数据,非定位错乱)——±worldSize 固定值消失,距离真值保留
3. dev server 热更未生效,重启 :3100 后验证通过(修复前/后同条件对照)

## 证据

- 复现:z13 徽章 left 直方图修复前(±1.25M 固定值)→ 修复后(距离真值分布);
  boss 实测 5,009,397 ≈ worldSize(z15) 复算吻合
- SDK 源码 toString 抓取:`_getPixPos` / `pointToOverlayPixelIn`(本报告根因节)
- 修复后截图 `/tmp/ws-g-r5-fixed.png`、z8 聚合 `/tmp/ws-g-z8.png`(像素分析
  2436 采样点含簇徽章蓝描边);worktree `.playwright-mcp/` 留复现截图
- 测试输出:`node --test tests/map-engine-baidu.test.mjs` 90 pass / 0 fail

门禁: PASSED
结论: OK
