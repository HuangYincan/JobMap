# ws-c 汇报(2026-08-22,boss 验证版)

批次: 20260822-boss-poi-city-center / worktree: /Users/acccan/dm-wt-pcc-c / 分支: fix/geocode-r5-readiness

> ⚠️ **汇报说明**:worker 完成提交后汇报环节丢失(logs/ws-c.log 仅 1 字节,无 report 写入)。
> 分支已有 2 个 commit(d8012e3 脚本 + 0b49a8c 文档),boss 按「信任但验证」亲自补跑门禁并
> 复核产出,以下数字均为 boss 实测。

## 实际改动(worker 提交, boss 复核)

1. **`server/scripts/audit-city-center-pins.mjs`(新增,180 行)**:只读诊断脚本,输出
   DB+JSON 双口径中心钉点构成基线。boss 实测运行:needsRerun 1092 / stayCenter 249 /
   noAddress 5,与 manifest 与 tech/29 完全一致。
2. **`tech/29-geocode-r5-status.md`(新增,123 行)**:geocode r5 状态与操作清单——
   三层根因(JSON 1346 / r5 未执行 / DB 1556 未同步)、r5 前基线(plan 916/962/1248/0)、
   中心钉点构成表 + Top 城市表、工具链就绪核查表(9 项,含 1 缺口:占位串「厦门」含「门」
   误判街道特征 6 站)、r5 操作清单(Env-only,用户执行)。boss 已通读,数据与实测一致。
3. **`tech/README.md`**:索引 +1 行。

## 工具链就绪核查结论(boss 复核 tech/29 §3)

- 多城市占位站走公司名 place-text 检索分支:✅ 就绪(apply:362-390)
- memo 变体 key / 每站 ≤2 次 / 裸公司名:✅ 就绪
- 唯一缺口:占位串含「门」(如「厦门」)6 站误判街道特征 → 不影响 r5 主路径,记 tech/29 §3.1
- **r5 无需代码改动**(ws-a grader 放宽除外,同批次)

## 门禁结果(boss 实测)

- npm test: **1393 通过 / 2 失败 / 2 skip**(1397 总;2 失败 = dev 既有 split-city-sites r4
  数据契约,ws-b 分支已修,非本 ws 引入)
- typecheck: 通过(tsc --noEmit)
- docs-check: Documentation policy check passed
- git diff --check: OK

## 遇到的问题

1. worker 汇报环节丢失(logs/ws-c.log 空、report 未写),boss 亲自验证补写本报告;2 个
   commit 保留在分支,无需返工。

## 证据

- commit: `d8012e3` feat(geocode): 新增只读诊断脚本 audit-city-center-pins(180 行)/
  `0b49a8c` docs(geocode): tech/29 geocode r5 状态与操作清单 + README 索引
- audit 实测输出与 manifest/tech/29 数字完全一致(1092/249/5)
- worktree 干净(未 merge 未 push)

门禁: PASSED
结论: OK
