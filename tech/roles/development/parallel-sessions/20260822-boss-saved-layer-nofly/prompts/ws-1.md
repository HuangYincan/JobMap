# WS-1: 收藏 toggle 不跳视角 + 状态机死代码清理

## 背景
用户反馈(2026-08-22):打开收藏图层时视角跳转(相机 fit 收藏外接框),**明确不要跳转**。
上两批已完成:收藏相机同步状态机(为抑制 setBounds 动画事件而建)+ 收藏互斥语义(开=地图只收藏+列表切收藏,关=恢复)。

## 任务
在 **/Users/acccan/dm-wt-saved-nofly** 内完成(worktree 已预建,分支 `fix/saved-layer-nofly`,基于 dev)。
**不要 merge / 不要 push**,boss 统一合并。

## 目标行为(用户指示,硬性)
- 打开/关闭收藏图层:**相机完全不动**(不 setBounds / 不 fit / 不移视野)。
- 打开 = 只切换 pin 可见性(收藏点显示、普通 POI 隐藏)+ Explore 列表切「我的收藏」(互斥语义保留)。
- 关闭 = 恢复搜索管线 pin 与列表,秒恢复(沿用可见性切换,不重查)。

## 实现方向(boss 裁决)
1. **删相机动作**:`use-saved-layer.ts` toggle 中打开分支的 `map.setBounds(收藏外接框)` 与状态机置位全部移除。
2. **状态机死代码清理**(先自证无其他消费者再删):`lib/saved-camera-sync.ts`、
   `use-work-viewport.ts` 中的消费/抑制、`tests/saved-layer-sync.test.mjs`(或改造为验证「toggle 不触发相机」)。
   **保留**「空批次不置空 catalog」加固(use-work-viewport.ts 内,独立于状态机)。
   若你发现状态机还有其他输入源/消费者(如引擎切换、其他 fit 调用),**不要删**那部分,汇报说明并只删收藏相关路径。
3. **契约同步**:component-contracts / hooks-contracts 中引用 `VIEWPORT_SUPPRESS_MS`/状态机的断言按新语义更新;
   tech/16 行为日志追加 2026-08-22「收藏 toggle 不再跳视角」节(注明状态机移除与原因;历史文字保留仅追加)。
4. **回归测试**:新增/改造——「toggle 开/关不触发相机动作」「可见性切换仍正确(互斥)」「空批次不置空 catalog 保留」。

## 文件边界(优先只碰这些;改其他文件需在汇报列理由)
- `server/src/hooks/use-saved-layer.ts`
- `server/src/hooks/use-work-viewport.ts`
- `server/src/lib/saved-camera-sync.ts`(如删)
- `server/tests/saved-layer-sync.test.mjs`、`server/tests/saved-layer-mutex.test.mjs`(相机相关断言)
- `server/tests/component-contracts.test.mjs` / `hooks-contracts`(如命中)
- `tech/16-bug-fixes.md`(追加节)

## 不做
- 不 merge / 不 push;不改视觉样式/布局;不跑 Env-only 步骤;不 npm install

## 门禁(全部通过才写 OK)
1. `cd /Users/acccan/dm-wt-saved-nofly/server && npm run typecheck`
2. `cd /Users/acccan/dm-wt-saved-nofly/server && npm test`(全绿;测试数以实际运行结果为准)
3. `cd /Users/acccan/dm-wt-saved-nofly && make docs-check`(应为全绿)
4. `git diff --check`
5. **回归测试**:「toggle 不触发相机动作」断言(jsdom 可测层;mock map 断言 setBounds/fit 未被调用)

## 提交
小步 Conventional Commits(`fix: ...` / `test: ...` / `docs: ...` / `refactor: ...`);提交前 git status 干净。

## 回报
写 **/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-saved-layer-nofly/reports/ws-1.md**:
- 改动摘要(每文件 1-2 行)
- 状态机是否整体删除 + 消费者排查结论
- 保留项确认(空批次不置空 catalog)
- 遇到的问题
- 门禁实际输出摘要(测试总数 pass/skip)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
