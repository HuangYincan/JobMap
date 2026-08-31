# Batch Manifest — 20260822-boss-agent-bugfix

## 目标

用户反馈 3 项:
1. **清屏后会话界面没有历史会话**(澄清:全部会话消失)—— 根因 Explore 中;
2. **百度/腾讯底图上 agent 失效**(澄清:导航后不显示目标点)—— 根因 Explore 中;
3. **UI 需要适配深色界面** —— 已完成(ws-dark)。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report | 状态 |
|---|---|---|---|---|---|---|
| dark | agent UI 深色适配 | `fix/agent-dark-theme` | (已清理) | `prompts/ws-dark.md` | `reports/ws-dark.md` | MERGED(a6f2f63) |
| clearfix | 清屏 = 归档当前会话+新建空会话 | `fix/agent-clear-archive` | `../dm-wt-agent-clearfix` | `prompts/ws-clearfix.md` | `reports/ws-clearfix.md` | DONE(零漂移;门禁原红因基线,已由 geofix 修复) |
| pinfix2 | 百度/腾讯 content marker DOM overlay 通用修复 | `fix/engine-content-overlay` | `../dm-wt-agent-pinfix2` | `prompts/ws-pinfix2.md` | `reports/ws-pinfix2.md` | RUNNING |
| geofix | 基线坐标断言修复(geocode r4 遗留) | `fix/geocode-r4-tests` | `../dm-wt-agent-geofix` | `prompts/ws-geofix.md` | `reports/ws-geofix.md` | DONE 绿(fadafd8) |

## 合并顺序

dark(已合)→ geofix(基线)→ clearfix → pinfix2。

