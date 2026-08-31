# ws-candcat-list 汇报(2026-08-21)

## 实际改动

- `server/src/components/poi-list.tsx`
  - 移除 `import filterStyles from "./filter-panel.module.css";`(grep 确认仅此一处使用,候选行不再复用 filter-panel chips)
  - 候选类别渲染从 `filterStyles.chip` pill 按钮改为 `styles.candidateRow` 全宽列表行按钮:保留 `key`、`onClick={() => onPickCategory?.(chip.key, chip.value)}`、容器 `role="group"` + aria-label 双语
  - 行内结构:label 在 `<span className={styles.candidateLabel}>`(flex:1 左对齐),行末内联 chevron SVG(`viewBox="0 0 12 20"`,path `m4 2 8 8-8 8`,`fill="none" stroke="currentColor" strokeWidth="2.2"` + round cap/join,`aria-hidden="true"`)
  - 更新块注释与 props 文档注释(chips → Apple 列表行)
- `server/src/components/poi-list.module.css`
  - `.candidateCard`:保留玻璃外观(1px rgba(255,255,255,0.72) 边框 / rgba(255,255,255,0.2) bg / blur(20px) saturate(165%) / box-shadow / radius 14px,含原暗色 override);`flex-wrap + center + gap + padding:14px` → `flex-direction:column + padding:0 + overflow:hidden`(行满宽,首末行圆角随容器裁剪),`text-align:left` 与 `margin-top:12px` 保留
  - 新增 `.candidateRow`:flex + space-between + gap 12px,width 100%,padding 13px 14px,min-height 44px,cursor pointer,border 0,background transparent,`border-bottom:1px solid var(--line)`,transition background 0.2s cubic-bezier(0.32,0.72,0,1);`:last-child` 去底边;hover 亮 `rgba(255,255,255,0.45)` / 暗 `rgba(255,255,255,0.07)`;active 亮 `rgba(255,255,255,0.65)` / 暗 `rgba(255,255,255,0.12)`(暗色 hover/active 放入现有 dark override 块)
  - 新增 `.candidateLabel`:14px/600/`var(--ink)`,flex:1,min-width:0(超长由 flex 收缩处理)
  - 新增 `.candidateChevron`:9×15px,`var(--muted)`,opacity 0.75,flex-shrink 0(iOS chevron 灰调)
  - 焦点不额外定义(globals.css 全局 `:focus-visible` 覆盖)
- `server/tests/component-contracts.test.mjs`(契约测试同步——原断言旧实现,门禁必改)
  - 两个候选类别契约测试标题/注释 chips → 候选行;`import filterStyles` / `filterStyles.chip` 断言改为 `doesNotMatch(filterStyles)` + 新断言:`styles.candidateRow`/`candidateLabel`/`candidateChevron` 类、chevron `viewBox="0 0 12 20"`、path `m4 2 8 8-8 8`、`strokeWidth="2.2"`、CSS `.candidateRow` 底边 `var(--line)`、`:last-child` 去边、`.candidateChevron` width 9px
  - sidebar/map-shell 接线断言(sidebar/shell 未动,行为不变)原样保留

## 门禁结果

- npm test: 815 通过 / 0 失败 / 2 skip(基线之上还有 245 个额外用例,全部通过)
- typecheck(tsc --noEmit): 通过,零错误
- docs-check: 通过("Documentation policy check passed.")
- git diff --check: 通过,无空白错误

## 遇到的问题

- 契约测试 `component-contracts.test.mjs` 断言旧实现(`import filterStyles` + `filterStyles.chip`),npm test 首次跑红 1 条。该测试非「不碰」清单文件,且源实现已按用户指令变更 → 同步更新测试为新的行/chevron 契约(桌面 L2 + 移动 drawer 共用 POIList,改动一处双端生效,测试仅需改 poi-list 侧断言)。
- 门禁里 `make docs-check` 需在 worktree 根跑(cwd 曾停在 server/ 导致首跑找不到 Makefile)——已从根目录复跑通过。
- dev 无新 commit(`HEAD..dev` = 0),无需 `git merge dev`。

## 证据

- npm test 摘要:`ℹ tests 815 / ℹ pass 813 / ℹ fail 0 / ℹ skipped 2`
- 提交:`268590a feat(poi-list): 空态候选类别改为 Apple 列表行(一行一类,行末 chevron)`(3 files, +97/-23)
- 工作树干净,未 merge 回 dev、未 push

门禁: PASSED
结论: OK
