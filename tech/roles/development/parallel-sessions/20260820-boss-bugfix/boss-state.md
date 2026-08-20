# Boss State — 20260820-boss-bugfix

## meta
- slug: 20260820-boss-bugfix
- date: 2026-08-20
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-bugfix
- goal: 修复 3 个 BUG——①Next 版本陈旧警告(升 16.3.1)②poi-card 重复 key 警告(DB 重复 position 行,本批 import 回归)③公司 POI 屏闪(marker 反复删除/添加)
- owner: boss-agent(无人值守;承接 20260820-boss-optimize 批,dev @ f13fbb6)
- dev_tip: f13fbb6

## 已查明根因
- **重复 key**:DB positions 21111 行 / 10578 distinct external_id → **10533 重复行**(= 本批 import 落库数)。根因:20260820 w5 让 import 尊重 drop source,8/17-8/19 的旧行 source_id=seed(10578 行)与今日新行(source 31/32/33)并存,同 external_id 双行。positions 无 FK 引用(applications 表存 position_id 无约束)。修复:import 预清理+source 迁移+组件防御。
- **Next 陈旧**:next@15 最新 = 15.5.23(已在最新)→ 须升 next@16.3.1 + react/react-dom@19.2.8(Node 26 ✓)。
- **屏闪**:Explore 调查中(见 prompts/b2.md)。

## stage
- current: VERIFY→NEXT(终态:3 bug 全部修复并经端到端验证;dev @ aefcfd4 已 push)
- updated_at: 2026-08-20

## 最终结果
- dev @ aefcfd4(4 个 merge:85ecceb b1 / 8837fe9 b2 / 2e43886 b3 / 788e9c6 b1f + chore 生成文件)
- 门禁:488 tests / 486 pass / 2 skip / 0 fail;typecheck 0;build ✓(Next 16.3.1 + Turbopack)
- 端到端验证:①version-staleness 消失(dev server 启动无警告,16.3.1=latest)②重复 key 警告消失
  (DB 10578/10578 零重复;import 自愈落地)③zoom 15→8 六级缩放 + 聚合边界,控制台零目标警告;
  截图(modlens 转录):zoom8 聚合徽章「上海市 23」「杭州 2」正常渲染,无成都假徽章
- Env 执行:主树 node_modules 同步 16.3.1;import:seed:apply 重跑成功(自愈去重 21111→10578)

## workstreams
| ws | 主题 | 分支 | worktree | prompt | report | status | last_tip | verdict |
|---|---|---|---|---|---|---|---|---|
| b1 | positions 重复:import 预清理+source 迁移+组件防御 | fix/positions-dedup | /Users/acccan/dm-wt-b1 | prompts/b1.md | reports/b1.md | DONE | a82ce21 | OK→**实测失败(迁移先于去重撞唯一键),b1f 修复中** |
| b2 | marker 屏闪:实例稳定、只增不重建 | fix/marker-stability | /Users/acccan/dm-wt-b2 | prompts/b2.md | reports/b2.md | DONE | 8ea1fa5 | OK(485/483;add-only+setVisiblePOIs+分桶) |
| b3 | Next 16.3.1 + React 19.2.8 升级 | chore/next-16 | /Users/acccan/dm-wt-b3 | prompts/b3.md | reports/b3.md | DONE | cc9eeba | OK(零破坏点;build ✓ 16.3.1) |
| b1f | 自愈顺序修复(先删重后迁移) | fix/positions-dedup-order | /Users/acccan/dm-wt-b1f | prompts/b1f.md | reports/b1f.md | RUNNING | 2e43886 | |

## merge_order
1. b1(数据去重,独立)→ 2. b2(marker)→ 3. b3(Next 升级,最后,风险最高)
合并后 boss Env:重跑 import:seed:apply(验证不再产生重复)+ 清理 SQL 兜底(如需要)+ build/smoke 验证

## adjudication_log
(空)

## deferred_notes
见 deferred-notes.md(承接 20260820-boss-optimize 的 D-01~D-18)

## next_plan
- [1] PLAN:根因(2/3 已定位)+ 屏闪 Explore → prompts
- [2] DISPATCH:b1/b2/b3(并行;b3 需 boss 先跑 npm install)
- [3] COLLECT → MERGE → VERIFY(含 import 重跑验证去重、build 冒烟)
- [4] 终态 + 总汇报

## recovery
- last_stage_written: PLAN(init)
- resume_history: 无
