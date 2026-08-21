# Boss State — tmap-interaction

## meta

- slug: 20260822-boss-tmap-interaction
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction
- goal: 用户 4 个真机 bug(TMap POI 失效/偏移、滚轮不丝滑、百度加载不了、切回高德 POI 消失)
- owner: boss
- decision: 全部技术类,直接派发;百度为环境差异(boss 实测正常),ws-c 做诊断增强

## stage

- current: MERGE(4 ws 全部 DONE+验证,派 merger)
- updated_at: 2026-08-22

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | fix/tmap-poi-interaction | /Users/acccan/dm-wt-ia | prompts/ws-a.md | reports/ws-a.md | DONE | e2e292f | 轮1 | 2026-08-22 | OK(3 commits, 1261/1259 pass, boss 已验证) |
| b | fix/tmap-wheel-switch | /Users/acccan/dm-wt-ib | prompts/ws-b.md | reports/ws-b.md | DONE | 7478142 | 轮1 | 2026-08-22 | OK(4 commits, ~1260 pass, boss 已验证) |
| c | fix/baidu-diagnostics | /Users/acccan/dm-wt-ic | prompts/ws-c.md | reports/ws-c.md | DONE | 8d5cee4 | 轮1 | 2026-08-22 | OK(4 commits, 1270/1268 pass, boss 已验证) |
| d | fix/geolocation-blue-dot | /Users/acccan/dm-wt-id | prompts/ws-d.md | reports/ws-d.md | DONE | 7c8032a | 轮1(补) | 2026-08-22 | OK(3 commits, 1275/1273 pass, boss 已验证) |

## 关键证据(用户 console,2026-08-22)

- **bug 3 根因坐实**:`net::ERR_BLOCKED_BY_CLIENT` —— 用户浏览器广告拦截/隐私扩展拦截 api.map.baidu.com 脚本;非代码问题(boss Playwright 干净浏览器加载正常)。ws-c 已获补充证据,错误分类指引加入该场景
- **bug 5 补充**:用户确认腾讯上定位蓝点消失(非 AMap 蓝点是 deferred 项)→ ws-d 实现

## merge_order

轮1: ws-a → ws-b → ws-c(并行开发,按序合并;tencent-engine.ts 段切分已隔离)。每轮 push origin/dev。

## verification 计划(boss 合并后 Playwright)

| bug | 验证方式 |
|---|---|
| 1 TMap POI 失效/偏移 | 点击 marker 命中(蓝像素定位 + click 响应);缩放前后 marker 位置一致性(像素对比) |
| 2 滚轮平滑 | 滚轮事件后 zoom 平滑变化(无跳变;截图序列对比) |
| 3 百度 | 用户端环境(缓存/URL)—— boss 环境回归确认 + 错误分类指引可用性 |
| 4 切回 POI 消失 | work 模式 高德→腾讯→高德 切换,蓝像素对比 |

## recovery

- last_stage_written: DISPATCH(轮1 派发)
- resume_history: —
