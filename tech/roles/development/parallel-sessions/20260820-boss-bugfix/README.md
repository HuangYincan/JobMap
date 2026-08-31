# Batch Manifest — 20260820-boss-bugfix

## 目标

修复 3 个 BUG(承接 20260820-boss-optimize 批,dev @ f13fbb6):
1. **positions 重复行导致 poi-card 重复 key 警告**(本批 import 回归:DB 21111 行 / 10578 distinct external_id → 10533 重复行;8/17-8/19 旧行 source_id=seed 与今日新行(source 31/32/33)并存)
2. **公司 POI 屏闪**(marker 反复删除/添加,zoom 时控制台大量警告)
3. **Next 版本陈旧警告**(next@15 已在最新 15.5.23 → 升级 next@16.3.1 + react/react-dom@19.2.8)

## 背景

重复 key 根因:20260820 w5 让 import 尊重 drop source,同 external_id 双行并存;positions 无 FK
引用(applications 表存 position_id 无约束)。修复:import 预清理 + source 迁移 + 组件防御。
b1 原实现(迁移先于去重)契约测试全绿但真实 DB 失败(唯一键瞬时冲突)→ 派发 b1f 交换为先
去重(保 MIN(id))再迁移再 upsert。

## Workstreams

| ws | 主题 | 分支 | worktree | prompt | report | status |
|---|---|---|---|---|---|---|
| b1 | positions 去重:import 预清理+source 迁移+组件防御 | fix/positions-dedup | /Users/acccan/dm-wt-b1 | prompts/b1.md | reports/b1.md | DONE→**实测失败,b1f 修复** |
| b2 | marker 屏闪:实例稳定、只增不重建 | fix/marker-stability | /Users/acccan/dm-wt-b2 | prompts/b2.md | reports/b2.md | DONE(门禁 PASSED) |
| b3 | Next 16.3.1 + React 19.2.8 升级 | chore/next-16 | /Users/acccan/dm-wt-b3 | prompts/b3.md | reports/b3.md | DONE(门禁 PASSED,build ✓) |
| b1f | 自愈顺序修复(先删重后迁移)+ 顺序断言 | fix/positions-dedup-order | /Users/acccan/dm-wt-b1f | prompts/b1f.md | reports/b1f.md | DONE(门禁 PASSED) |

## 合并顺序

1. b1(数据去重,独立)→ 2. b2(marker)→ 3. b3(Next 升级,最后,风险最高)
实际:b1→b2→b3→b1f(4 个 no-ff merge:85ecceb/8837fe9/2e43886/788e9c6,均无冲突)

## 合并后

- 门禁:dev @ 788e9c6 → **488 tests / 486 pass / 2 skip / 0 fail**;typecheck 0 错误;
  docs-check ✅;git diff --check ✅;b3 worktree 内 `npm run build` ✓(Next 16.3.1 + Turbopack)
- 端到端验证:version-staleness 消失;重复 key 警告消失(DB 10578/10578 零重复);zoom 15→8
  六级缩放 + 聚合边界控制台零目标警告;截图:zoom8 聚合徽章「上海市 23」「杭州 2」,无成都假徽章
- Env(后续执行):主树 node_modules 同步 16.3.1;`import:seed:apply` 重跑成功(自愈去重 21111→10578)
- 遗留:deferred-notes E-01~E-04(观察/技术,见 deferred-ledger)
