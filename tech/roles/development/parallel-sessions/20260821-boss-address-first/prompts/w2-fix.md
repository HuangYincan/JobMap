# Workstream w2-fix — 裁决附录(boss 授权更新 3 个过时 canary 测试)

## 你的身份

boss 派发的续作 worker。**同一 worktree `/Users/acccan/dm-wt-backfill`、分支 `fix/address-backfill`**
(boss 已裁决:数据回填有效,测试断言的是回填前旧值,授权更新)。

## 背景

w2 已完成地址回填(2 commit:`e506c4d` 数据 311 文件 + `6141a3b` 文档),门禁仅剩 3 个
真实数据 canary 测试失败——它们断言**回填前旧值**,与已完成的数据回填冲突:

1. `server/tests/embodied-jobs-drops.test.mjs:80` — 断言 47 个 embj-* drop 的 `site.location` 必须为 `{}`(旧契约「待 geocode」)。回填后 47 站中多数已有 `{ address }`。
2. `server/tests/qqdoc-jobs.test.mjs:121` — 断言 `qqj-新东方西安学校.json` 的 city 必须为 `'西安 咸阳'`、location 为 `{}`。回填后 city 已修正为 `西安市`、location 有 address。
3. `server/tests/split-city-sites.test.mjs:284` — 断言 `qqj-临界点-site` 的 location 精确等于 `{lng, lat}`(无 address)。回填后含 `address: 上海市徐汇区天平路185号11层1107室`。

## 任务

1. 先 `git log --oneline -3` 确认分支状态(应含 e506c4d / 6141a3b);`git status` 干净。
2. 更新这 3 个测试,把断言改为**回填后状态**(反映新数据契约,不要放宽到无意义):
   - embj:location 允许 `{ address }`(地址已回填)或 `{}`(31 站 null 仍为空)——断言口径改为「location 为空对象或仅含 address 字段」,并抽查个别站点地址非空。
   - qqdoc-jobs:city 断言改为 `'西安市'`;location 含 address。
   - split-city-sites:断言 location 含 `{lng, lat, address}`(address 为新值)。
   - 若数据与上述描述有出入,以 worktree 内实际数据为准修正断言(先读文件)。
3. 重跑门禁:`cd /Users/acccan/dm-wt-backfill/server && npm test`(**全部通过**)、`npm run typecheck`;`cd /Users/acccan/dm-wt-backfill && make docs-check`、`git diff --check`。
4. Commit(如 `test(recruitment): update canary assertions for backfilled addresses`)。

## 文件边界

- **只允许改**:`server/tests/embodied-jobs-drops.test.mjs`、`server/tests/qqdoc-jobs.test.mjs`、`server/tests/split-city-sites.test.mjs`。
- **不碰**:数据文件、其他测试、src/、文档(除非测试改动需要,说明理由)。

## 汇报

追加到 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-address-first/reports/w2.md`
末尾(新段「## w2-fix 裁决更新」),并更新末两行:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

Conventional Commits。不 merge、不 push。
