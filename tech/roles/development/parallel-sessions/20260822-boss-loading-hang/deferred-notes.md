# Deferred Notes — boss-loading-hang(2026-08-22)

本批次无 deferred 项:

- **UI 设计变更**:无(失败态重试 UI 属修复卡死 bug 的必需出口,正常路径视觉零改动,已按
  liquid glass 设计系统实现,用户已授权新 UI 自主开发)。
- **Env-only**:无(未涉及 DB apply / geocode / 密钥配置)。
- **口径/其他**:无。

## 备注(供用户决策,非 deferred)

1. **修复后体验变化**:加载链失败时(极慢网络/厂商 CDN 故障)不再无限转圈,8s 超时后自动
   尝试其余引擎(腾讯/百度),全部失败显示「地图加载失败 + 重试」;首访数据页请求单页 10s
   超时、连续 3 页失败止损。正常网络下首次进入体验无变化。
2. **超时参数可调**:`AMAP_LOAD_TIMEOUT_MS = 8_000`(amap-api.ts)、挂载 watchdog 25s
   (use-map-engine.ts)、逐页 `PAGE_TIMEOUT_MS = 10_000`(viewport-search.ts)。若生产环境
   观测到弱网用户误触错误态,可下调/上调。
3. **并行会话协同**:本批次执行期间,另一 boss 会话(engine-polish-2 轮5,fix/baidu-r5)并行
   合入 dev(tech/23 有双回填,已由 merger 预解冲突,双方内容均保留)。
