# Deferred Notes — 求职导航 Agent WS1

| 日期 | 类型 | 内容 | 当前处理 |
|---|---|---|---|
| 2026-08-28 | Provider / Env-only | 高德、腾讯、百度路线产品的主 provider、顺序、账号权限、静态配额、缓存/展示、商业许可、时间参数、实时性/SLA 与真实 key 冒烟尚未确认 | WS1 只实现 provider-neutral seam 与显式 estimate；不注册或调用 live provider |
| 2026-08-28 | 数据/隐私口径 | 产品事件是否持久化，以及同意、删除、访问控制、采样和留存天数未决 | WS1 不持久化 analytics，不复用 `audit_events` |
| 2026-08-28 | UI 设计 | `tech/31-job-navigation-agent-plan.md` §8 桌面/移动布局未获用户明确批准 | 不修改前端；WS4 继续 blocked |
| 2026-08-28 | 用户研究 | M0 的 5–8 名目标用户任务访谈/可用性输入仍无可验证证据 | 不伪造研究结论；后续由用户组织真实研究 |
