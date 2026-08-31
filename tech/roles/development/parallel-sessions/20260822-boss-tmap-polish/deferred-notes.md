# Deferred Notes — 20260822-boss-tmap-polish

| # | 类型 | 内容 | 状态 |
|---|---|---|---|
| 1 | Env-only | 百度真实验证需有效浏览器端 AK(用户已修)+ dev server;ws-c 汇报注明后由 boss 合并后 Playwright 复验 | 待 ws-c |
| 2 | 合规权衡 | TMap 水印/版权隐藏违反服务商 ToS 署名要求(ws-b 实现,tech/23 记录权衡);AMap/百度版权保留现状不变 | 用户已明确要求,执行 |

## 终裁依据(沿用上一批次)

若本轮 7 项全部修复后,三引擎切换仍有不可收敛问题 → 触发「删掉这一功能」fallback(删切换入口、收敛高德单引擎)。
