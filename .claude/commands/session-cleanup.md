# Session Cleanup — 会话收尾清理

> ⚠️ **仅用户手动调用**:本命令只有用户输入 `/session-cleanup` 时才执行。Agent 不得自行读取、引用或执行其中的逻辑。
> 用途:一个或多个 Claude Code 会话结束后,清理遗留的 dev 服务器、Postgres、死会话的 MCP 进程。
> 原则:**先盘点,后分类,逐组确认,再动手**。默认保守——拿不准就不杀,留给用户判断。

## 1. 盘点(只读,先全部跑一遍)

```bash
# 项目相关的监听端口(node = dev 服务器,com.docker = Postgres)
lsof -iTCP -sTCP:LISTEN -P -n | grep -E "node|docker"

# 每个 node 监听进程的 cwd —— 区分主树 / worktree / 用户终端
for pid in $(lsof -iTCP -sTCP:LISTEN -P -n | awk '/node/{print $2}' | sort -u); do
  echo "pid=$pid cwd=$(lsof -a -p $pid -d cwd 2>/dev/null | tail -1 | awk '{print $NF}')"
done

# 活着的 claude 会话(每个 Claude Code 会话 = 一个 claude 进程,版本见 `claude --version`;它不是项目服务)
ps -ax -o pid,lstart,comm | grep claude | grep -v grep

# Postgres(Docker)状态
make db-status
```

## 2. 分类(对每个进程判定归属)

| 类别 | 判定 | 处置 |
|---|---|---|
| **A. worktree 会话的 dev server** | cwd = `/Users/acccan/dm-wt-ws*/server` | **不动**——并行 Agent(WS1–4)可能正在用;只有用户确认该会话已关闭才停 |
| **B. 用户自己终端起的 dev server** | cwd = `/Users/acccan/domain-map/server` 且父链是终端(zsh/login/Otty/iTerm 等) | 询问用户是否停止 |
| **C. 死会话遗留的 dev server** | 孤儿(PPID=1)或父链上没有活着的终端/claude | 建议停止,确认后执行 |
| **D. 死会话遗留的 MCP 进程** | plumb-mcp / markitdown-mcp / mcp-server-github / playwright-mcp / cc98-mcp / videonote 等,沿 PPID 上溯**没有任何存活 claude** | 建议停止,确认后执行 |
| **E. 活会话的 MCP 进程** | 沿 PPID 上溯能找到存活 claude | **不动** |
| **F. Postgres(Docker)** | `docker compose ps db` 在跑 | 询问:`make db-down`(其他会话/数据库操作可能还在用) |
| **G. Python 后端** | cwd 在项目内的 uvicorn/gunicorn/fastapi 等 | 询问后 `kill` |
| **H. claude 进程本身** | 会话已关闭却残留 | 询问后 `kill`(默认不碰) |

C 类判定的命令片段(找到无存活 claude/终端祖先的 node 进程):

```bash
ps -ax -o pid=,ppid= | awk '$2==1'                      # 直接孤儿
# 或对每个候选 pid 沿 PPID 上溯,直到遇到 claude / zsh / login / 1
```

## 3. 清理(逐组执行,每组先展示再确认)

```bash
# C/D 类:孤儿 dev server 或 MCP 进程
kill <pid>                                  # SIGTERM,必要时再 kill -9
pkill -P <pid>                              # 连带子进程(next-server)

# B 类:用户终端的 next dev(用户确认后)
kill <next-dev-pid>

# F 类:Postgres
make db-down

# G 类:Python 后端
kill <pid>
```

## 4. 验证与汇报

```bash
lsof -iTCP -sTCP:LISTEN -P -n | grep -E "node|docker"
```

期望:只剩活会话仍在用的端口(A 类 worktree 服务、E 类活 MCP、用户明确保留的)。最后向用户汇报:杀了什么、保留了哪些及原因、Postgres 是否已停。
