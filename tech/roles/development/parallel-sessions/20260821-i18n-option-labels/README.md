# Batch: 20260821-i18n-option-labels — 选项标签英文适配

## 目标(用户原话)

> 用户体验相关:部分地方未做好英文适配,如 default map 选项、industries、filter 卡片里的选项、排序下拉框的选项

即:UI 语言切到 English 时,以下位置仍显示中文:
1. **default map 选项**(账户偏好设置里「默认地图」下拉的选项名)
2. **industries**(求职偏好「意向行业」选项 + 触发钮文本)
3. **filter 卡片里的选项**(筛选面板:分类/行业/规模/学历/岗位类型树/职能等全部选项)
4. **排序下拉框的选项**(SortSelector 各排序项)

## 根因(boss 侦察结论,file:line)

- `server/src/lib/modes.ts` 与 `server/src/lib/job-taxonomy.ts`:所有 `FilterConfig.label` / `FilterOption.label` / `SortOption.label` 硬编码中文;`ModeConfig.nameEn` 已有但 UI 未用。
- `server/src/components/filter-panel.tsx`、`sort-selector.tsx`:直接渲染 `config.label` / `option.label`,不感知 `lang`。
- `server/src/components/account-panel.tsx`:
  - `defaultModeText = getMode(prefs.defaultMode).name`(381 行)与 defaultMode 下拉 `label: getMode(m).name`(456-458 行)— 中文 `name`,应改用 `nameEn`。
  - `industriesText`(366-372 行)与 industries 下拉 `label: i.label`(445 行)— 应走 `labelEn`。
- JSX 文本层已全部走 `t()`(i18n.ts 已有 zh/en 全量表,`jobFamilyIntern` 等 taxonomy 翻译条目已存在),`status/families/strengths` 已用 `labelKey` 模式适配 ✓ 不动。

## 方案(契约,三个 WS 共用)

- `FilterConfig` / `FilterOption` / `SortOption` 增加**可选** `labelEn?: string`;`FilterConfig` 增加 `unitEn?: string`;`ModeConfig` 增加 `searchPlaceholderEn?: string`。
- `server/src/lib/i18n.ts` 增加辅助函数(唯一签名,WS-2/WS-3 依赖):
  ```ts
  export function uiLabel(o: { label: string; labelEn?: string }, lang: Language): string {
    return lang === "en" ? (o.labelEn ?? o.label) : o.label;
  }
  ```
- 渲染层统一:`lang === "en" ? <labelEn> : <label>` 或 `uiLabel(...)`;aria-label / title / 触发钮文本同规则。
- **value 字段一律不动**(category 值如「餐饮服务」、education 值「本科」是与 DB/API 对齐的数据键)。
- 不改任何布局/交互/样式(仅文案随 lang 变化)→ 符合「修复 bug 保持设计语义」。

## Workstream 表

| ws | 分支 | worktree | 文件边界 | 主题 |
|---|---|---|---|---|
| w1 | feature/i18n-option-labels-foundation | /Users/acccan/dm-wt-i18n-foundation | lib/types.ts、lib/i18n.ts、lib/modes.ts、lib/job-taxonomy.ts | 类型扩展 + 全量 labelEn/unitEn/searchPlaceholderEn + uiLabel + 单测 |
| w2 | feature/i18n-option-labels-renderers | /Users/acccan/dm-wt-i18n-renderers | components/filter-panel.tsx、components/sort-selector.tsx | 渲染层走 uiLabel |
| w3 | feature/i18n-option-labels-prefs | /Users/acccan/dm-wt-i18n-prefs | components/account-panel.tsx、mode-switcher.tsx、secondary-sidebar.tsx、map-shell.tsx | defaultMap/industries 选项 + switcher name + searchPlaceholder |

## 合并顺序(依赖序)

1. w1(类型 + 函数契约 + labelEn 数据)→ 2. w2(渲染消费方)→ 3. w3(偏好/切换器消费方)

w2/w3 均依赖 w1 的 `uiLabel` / `labelEn` / `searchPlaceholderEn` 契约(契约已写死在各 prompt,不互读文件)。

> **merger 必读(契约依赖说明)**:w2/w3 的**分支上** self-typecheck 会红(4 处 TS 报错,全部是 w1 的 `uiLabel`/`searchPlaceholderEn` 尚未合入 dev),但二者汇报的 npm test 均全绿(993 pass)。**门禁以合并到 dev 后的运行结果为准**:严格按 1→2→3 顺序合并,每步合并后在 dev 上跑 `cd server && npm test && npm run typecheck`;w1 合入后 w2/w3 的 typecheck 应即全绿。若仍红,才是真缺陷,红则停报 PARTIAL_RED。

## 门禁(每个 ws)

- `cd <worktree>/server && npm test`(基线 566 pass / 2 skip)
- `cd <worktree>/server && npm run typecheck`
- `make docs-check`(如改到 tech/ 文档;纯 ts 改动通常无影响)
- `git diff --check`

## 汇报契约

worker 写 `reports/<ws>.md`(背景/改动摘要/遇到的问题/门禁),**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
