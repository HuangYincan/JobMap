# Batch 20260821-candcat-list — 空态候选类别改为 Apple 风格列表

**目标(用户显式指定,已授权 UI 改动):** 无任何 POI 时,「选择类别开始浏览 / 尝试调整关键词或筛选条件」空态二级卡片(candidateCard)内的候选类别,从居中换行 pill chips 改为 **Apple 风格列表式排列,一类独占一行**(行末带 chevron,行间细分割线)。

**来源:** 用户 `/boss-agent` 指令(2026-08-21)。方向明确(列表、一行一类、Apple 风格),不属「需用户决策」的未授权 UI 改动,正常派发。

## Workstream 表

| ws | 分支 | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|
| ws-candcat-list | `feature/candidate-category-list` | 空态候选类别 chips → Apple 列表行(一行一类) | `server/src/components/poi-list.tsx`、`poi-list.module.css` | `filter-panel.module.css`(chips 保留给筛选面板)、`secondary-sidebar.tsx`、`map-shell.tsx`、`i18n.ts`、数据/后端 |

## 合并顺序

1. `feature/candidate-category-list` → dev(唯一 WS,合并后 push)
## 关键事实(探索结论)

- 渲染点唯一:`server/src/components/poi-list.tsx` 空态块(poi-list.tsx:161-179),`styles.candidateCard` 玻璃容器 + `filterStyles.chip` pill 按钮。
- 桌面(L2 侧栏)与移动(drawer)共用同一 `POIList`,改动一处双端生效。
- 候选数据:`candidateCategoriesFor`(secondary-sidebar.tsx:104)返回 `{key,value,label}[]`;work=jobTaxonomy/roleFamily,domain=category 9 类;交互 `onPickCategory` 写 filters,逻辑不变。
- `filterStyles` 在 poi-list.tsx 仅此一处使用,改后移除 import(需 worker 确认无其他引用)。
- 无针对候选类别的测试文件;门禁为全量 `npm test` + typecheck。
- `tech/09-secondary-sidebar.md` 未记录候选类别,无需文档同步;`make docs-check` 仍为门禁。
