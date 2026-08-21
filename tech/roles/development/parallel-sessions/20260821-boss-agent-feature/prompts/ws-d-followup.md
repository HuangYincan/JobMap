# WS-d-followup — tech/README.md 索引补录(boss 派发,mini worker)

## 任务

在 `/Users/acccan/dm-wt-agent-d/tech/README.md` 的编号文档索引表中,`| [22-hangzhou-poi-local.md]...` 行(约第 30 行)之后新增一行(描述与 tech/24 内容一致):

```
| [24-agent-feature.md](24-agent-feature.md) | AI Agent 功能(自建引擎/三平台 MCP/动作协议/悬浮球) | 前端/后端 |
```

如文档还有「了解 XX → 链接」类的导航节且明显应含 24,可一并补(保持最小改动)。

commit 消息:`docs(agent): tech/README 索引补录 24-agent-feature`

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-d && make docs-check && git diff --check
```

## 纪律

不 push/不切分支;只改 tech/README.md。

## 回报

在 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-d.md` 追加一小节「follow-up:tech/README 索引已补录」,不改动末两行 token。
