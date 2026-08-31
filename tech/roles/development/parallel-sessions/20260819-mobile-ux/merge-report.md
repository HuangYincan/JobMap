# 合并报告(2026-08-19)

## 结果总览
- 成功合并: w3 x 1、w1 x 1、w2 x 1(共 3 分支)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w3 | chore/search-placeholder | 干净(ort) `f127673` | 296 pass/0 fail / typecheck ✅ / docs ✅ / diff ✅ | 无 |
| w1 | fix/mobile-drawer-chrome | 干净(ort) `4b02657` | 296 pass/0 fail / typecheck ✅ / docs ✅ / diff ✅ | 无 |
| w2 | fix/mobile-card-interactions | 有冲突 `60a449d` | 297 pass/0 fail / typecheck ✅ / docs ✅ / diff ✅ | 见下 |

## 冲突解决清单
- `server/src/components/map-shell.tsx`:w1 的 scale 显隐 effect(drawerFullish)与 w2 的
  detailPoi 返回滚动恢复 useLayoutEffect 是**两个独立 effect**,按「不碰」为据**两者均保留**,
  顺序:w1 scale 显隐 effect → w2 滚动恢复 useLayoutEffect。
- `tech/16-bug-fixes.md`:w1 与 w2 各自新增同日(2026-08-19)不同主题条目
  (抽屉 chrome / 二级卡片交互),按「保留两者条目」**两节均保留**、不互相覆盖。
- `CHANGELOG.md`:w1/w2 各自追加,git 自动合并成功,无冲突。
- 未改动任何 w1/w2 prompt「不碰」边界外的文件;桌面 secondary-sidebar 行为保持(不传 onDeselect)。

## 遗留问题
- 无阻塞遗留。Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,留给用户。
- 各 worktree 已移除、分支已删除;dev 已推送 `60a449d`(origin/dev)。

## 最终 dev 状态
- dev HEAD:`60a449d Merge fix/mobile-card-interactions into dev (w2)`
- origin/dev 同步:`60a449d`
- 合并顺序(manifest):w3 → w1 → w2,逐串行、红则停;三个分支全部门禁绿。
- 工作树干净(仅未跟踪的会话工件目录,符合预期)。

门禁: ALL_GREEN
结论: MERGED_ALL
