# ws-clearfix 汇报(2026-08-22)

## 实际改动

分支 `fix/agent-clear-archive`(worktree `/Users/acccan/dm-wt-agent-clearfix`,自 dev `df4b26d` 切出;2 commits,未 push):

- `server/src/lib/agent-session-store.ts` → 新增纯函数 `archiveAndNew(state, {activeId, messages, title, id?, now?})`(导出可单测):
  - activeId 存在且 messages 非空 → 当前会话消息落库为历史(替换为传入消息,cap 30,坏行丢弃),**标题保留原样**(无 title 参数时 deriveTitle 兜底),updatedAt 刷新;
  - 空会话(无消息)不产生空历史:会话条目原样保留(不刷新);
  - 无/未知 activeId → 无归档;
  - 随后 `createSession` 新建空会话(「新会话」)并激活,cap 裁剪照旧(归档会话 updatedAt 已刷新,不被挤出;最旧会话被挤出);
  - 文件头规则注释同步(清屏语义)。
- `server/src/components/agent-panel.tsx` → `clearScreen`(约 L467)改为:
  - `clearOverlays()` + `setUndoVersion` 照旧(覆盖物/undo 清理不变);
  - `archiveAndNew(cur, {activeId: cur.activeId, messages: messagesRef.current, title: curSession?.title})`(工作副本落库为历史,标题保留原样)+ persist;
  - `setMessagesBoth([])` 载入空消息 + `resetStreamUi()` 清 completion/truncated/notConfigured/fatalError/tool;
  - 流式期间禁用不变;记忆不动;导入 `archiveAndNew`,`saveMessages` 仍在切换/新建/流结束路径使用;注释同步。
- `server/tests/agent-session-store.test.mjs` → +5 个 archiveAndNew 单测:有消息归档(标题保留/activeId 指向新会话)/空会话不归档/无·未知 activeId 仅新建/消息 cap 30 + 坏行 + 无标题派生兜底/cap 10 归档+新建挤出最旧且归档会话存活。
- `server/tests/component-contracts.test.mjs` → 更新清屏契约(ws-done 与 ws-panel2 两处):断言清屏路径走 `archiveAndNew(cur, {… activeId: cur.activeId, messages: messagesRef.current, title: curSession?.title})`(正则);store 契约追加 `export function archiveAndNew(`。
- `tech/24-agent-feature.md` §9.2 → 清屏语义一句话同步(归档 + 新建空会话,旧内容可回溯;ws-clearfix)。

## 门禁结果

- npm test:**1377 通过 / 2 失败**(两败均为基线既有,非本 WS 引入,见下;本 WS 全部新测试通过)
- typecheck:`npm run typecheck` 通过
- docs-check:通过;git diff --check:通过

## 遇到的问题

1. **2 项测试失败为分支 tip 基线既有**(非本 WS 引入,零漂移):
   - `drops-coordinate-consistency.test.mjs`「无任何非杭州 drop 站点坐标落在杭州参考框内(fecef85 清扫回归)」:`official-career/蔚来.json` 站点「蔚来-site-绍兴」(120.512106/30.092944)落在杭州参考框内(1 条违规,提示需重跑 fix-sweep-accident-coords.mjs);
   - `split-city-sites.test.mjs`「真实数据: qqj-临界点(上海 深圳 北京,100 岗)…」:qqj 主站点坐标期望 31.23/121.47,实际数据为 geocode r4 精修后的 31.197401/121.439346(上海市徐汇区天平路185号)。
   - 证据链:两违规数据文件最后改动均在 `3e6deb3 data(recruitment): geocode r4`(分支历史内、df4b26d 之前);本 WS 工作树 `data/` 零改动(git status clean);两测试仅读 `data/recruitment/**` + import spatial-query/city-centers/脚本,不触及本 WS 任何文件。
   - 处理:未修(数据修复属 Env-only/data 批次,红线外)→ 需 boss 裁决(可考虑 geocode r4 数据清扫批次或更新 split-city-sites 期望坐标)。
2. 无其他问题。

## 证据

- 测试输出摘要:`npm test`(server 目录)1377 ✔ / 2 ✖(上述两条);新增 archiveAndNew 5 测 + 更新后契约测试全部通过。
- commits(worktree 内,未 push):
  - `eb0462b fix(agent-ui): archiveAndNew 纯函数:归档当前会话(标题保留)+ 新建空会话 (ws-clearfix)`
  - `80ac8e3 fix(agent-ui): 清屏 = 归档当前会话 + 新建空会话,旧内容可回溯 (ws-clearfix)`
- 复现序列:清屏按钮(非流式)→ clearOverlays + archiveAndNew(有消息 → 归档并保留标题)→ 新空会话激活 → 会话弹层可见刚归档会话。

门禁: FAILED
结论: OK
