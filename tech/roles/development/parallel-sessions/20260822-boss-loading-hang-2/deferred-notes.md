# Deferred Notes — boss-loading-hang-2(2026-08-22)

无代码类 deferred(无 UI 设计变更、无 Env-only 步骤、无数据口径问题)。

## ⚠️ 用户操作事项(非 deferred,复测前提)

1. **重启 dev server 后再复测**。实证发现:复现时端口 3000 被 **round-1 遗留 dev server**
   占用(12:10 启动,修复 merge 12:17 落其磁盘 → Turbopack live-merge 状态,chunk 编译缓存
   可能已坏)。用户此前「修复后仍复现」很可能打的就是这台旧 server。
   - 操作:`pkill -f "next dev" && cd server && npm run dev`(可顺带清理 `server/.next/dev`)。
2. 复测要点:隐身窗口/无痕首访 → 应正常进入(Loading <2s);若模拟弱网:AMap CDN 卡 >8s →
   自动回退腾讯/百度;三引擎全挂 → 1.6s 内出现「地图加载失败 + 重试」;map-shell chunk 层卡住
   (仅 dev live-merge 等极端场景)>15s → 失败态 + 重试(=刷新)。
3. GATE_A 失败态按钮文案走 i18n(`mapLoadFailed`/`mapLoadRetry`/`mapLoadTimeoutHint`,
   zh+en 已配)。
