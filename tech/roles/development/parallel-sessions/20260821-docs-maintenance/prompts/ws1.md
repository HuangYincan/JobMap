# Workstream 1 — 根契约文档修正 (fix/contract-docs)

## 背景

仓库文档维护批次。根契约文档存在事实漂移：CHANGELOG 滞后（08-20 缺合入条目、08-21 整天空白）、README crawler 测试计数过时（写 64，源码实际 103）、日期滞后。你是 headless worker：**worktree 已预建**（/Users/acccan/dm-wt-ws1，分支 fix/contract-docs），只改 worktree 内文件，**不要 merge/push/切分支**。提交用 Conventional Commits。

## 任务（按序）

### 1. CHANGELOG.md — 补齐合入条目（最大滞后项）
- 用 `git log origin/dev --oneline --since=2026-08-20 --date=short` 枚举 08-20 以来所有合入 commit，与 CHANGELOG 现有条目对照
- 补 08-20 缺的批次条目（已知缺：national-data、geocode-address-strategy、ats-source-extend/ats-city-normalize、南京/西安 drops、BAIDU_MAP_AK 注入、fetch 超时——以 git log 与批次目录 `tech/roles/development/parallel-sessions/20260820-*` 的 merge-report 为准，不发明条目）
- 新增 08-21 节（geocode-count / geocode-memo / geocode-quota 三批已合入 dev；**qqdoc-official 未合入，不记**）
- 保持既有条目风格：一句话摘要 + 指向 tech/16 或批次目录

### 2. README.md — 计数与日期修正
- 跑 `make test-unit`（= crawler unittest，无 DB）拿 crawler 测试权威计数；若环境跑不通则静态数 `def test_` 并注明方法。替换「64 unit tests」为实测值
- 头部日期 08-17 → 08-21（若正文已有更新内容则同步）

### 3. agent.md / CONTRIBUTING.md / CLAUDE.md — 核对
- 「最后审查」日期更新为 2026-08-21（本批完成后）
- 核对数字（测试计数、迁移号、版本）与现状一致，发现漂移一并修（现状事实：server 488 测试/486 pass/2 skip、迁移 001–016、Next 16.3.1、React 19.2.8、dev 分支）

## 文件边界
- 只改：`README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`agent.md`、`CLAUDE.md`（worktree 根）
- 不碰：`tech/`、`server/`、`crawler/` 等任何其他文件

## 门禁（全部通过才算 OK）
1. `make docs-check`（worktree 根）→ 通过
2. `git diff --check` → 无空白错误
3. 一致性 grep：`grep -rn "64 unit tests" README.md` 无残留；CHANGELOG 08-20/08-21 节已覆盖全部已合入批次

## 回报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-docs-maintenance/reports/ws1.md`：
- 做了什么（每文件一句）、实测计数与日期
- 遇到的问题段（如有）
- 末两行精确 token：
```
门禁: PASSED
结论: OK
```
（失败则 `门禁: FAILED` + `结论: BLOCKED: <一句话>`）
