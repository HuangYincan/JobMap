# WS: ws-candcat-list — 空态候选类别改为 Apple 风格列表(一行一类)

## 背景

用户指令:无任何 POI 时,「选择类别开始浏览 / 尝试调整关键词或筛选条件」空态二级卡片内的候选类别,改为 **Apple 风格列表式排列,一类独占一行**。这是用户显式指定的 UI 改动,设计方向已定,按 liquid glass 设计系统实现。

当前实现:`POIList` 空态(`server/src/components/poi-list.tsx:161-179`)用 `styles.candidateCard` 玻璃容器 + `filterStyles.chip` pill 按钮,flex-wrap 居中排列。桌面 L2 侧栏与移动 drawer 共用此组件,改动一处双端生效。

## 任务(绝对路径)

**worktree:** `/Users/acccan/dm-wt-candcat-list`(已预建,分支 `feature/candidate-category-list`;boss 统一合并,不要 merge/push)
**汇报文件:** `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-candcat-list/reports/ws-candcat-list.md`

改动两个文件:

1. **`/Users/acccan/dm-wt-candcat-list/server/src/components/poi-list.tsx`** — 候选类别渲染:
   - 结构:每类从 `filterStyles.chip` 按钮改为全宽列表行按钮 + 行末 chevron SVG。
   - 容器 `role="group"` + aria-label 保留。
   - 行按钮保留 `onClick={() => onPickCategory?.(chip.key, chip.value)}` 与 `key`(交互逻辑不变)。
   - `filterStyles` import 仅此一处使用 → 移除 import(先 grep 确认无其他引用)。
   - 更新该块注释(F2 候选类别:玻璃卡片 + filter-panel chips → 玻璃卡片 + Apple 列表行)。
2. **`/Users/acccan/dm-wt-candcat-list/server/src/components/poi-list.module.css`** — `.candidateCard` 改列表布局,新增行/标签/chevron/分割线样式(规格见下)。

**不碰:** `filter-panel.module.css`(chips 保留给筛选面板)、`secondary-sidebar.tsx`、`map-shell.tsx`、`i18n.ts`、后端/数据、其他组件。

## 布局图(现状 vs 目标)

### 现状 — 居中换行 pill chips

```
┌──────────────────────────────────────────────┐
│  🔍 (空态 icon)                                │
│  选择类别开始浏览                                │
│  尝试调整关键词或筛选条件                         │
│ ┌──────────────────────────────────────────┐ │
│ │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐      │ │
│ │  │技术│ │产品│ │运营│ │设计│ │职能│ …       │ │  ← pill chips(flex-wrap 居中)
│ │  └────┘ └────┘ └────┘ └────┘ └────┘      │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 目标 — Apple 风格分组列表,一行一类

```
┌──────────────────────────────────────────────┐
│  🔍 (空态 icon,不变)                           │
│  选择类别开始浏览(不变)                          │
│  尝试调整关键词或筛选条件(不变)                   │
│ ┌──────────────────────────────────────────┐ │
│ │  技术开发                          ›     │ │  ← 行 1:label 左,chevron 右
│ │ ──────────────────────────────────────── │ │  ← 细分隔线(1px)
│ │  产品设计                          ›     │ │
│ │ ──────────────────────────────────────── │ │
│ │  数据算法                          ›     │ │
│ │ ──────────────────────────────────────── │ │
│ │  市场运营                          ›     │ │
│ │ ──────────────────────────────────────── │ │
│ │  职能支持                          ›     │ │  ← 末行无分隔线
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

## 样式规格(遵循 liquid glass + Apple HIG)

| 元素 | 规格 |
|---|---|
| 容器 `.candidateCard` | 保留玻璃外观(现有 bg/blur 20px saturate 165%/border/box-shadow/radius 14px,含现有暗色 override);改为 `display:flex; flex-direction:column; padding:0; overflow:hidden`(行满宽、首末行圆角随容器裁剪)。原 `text-align:left` 保留 |
| 行 `.candidateRow`(button) | `display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:13px 14px; min-height:44px; text-align:left; cursor:pointer; border:0; background:transparent; border-bottom:1px solid var(--line); transition: background 0.2s cubic-bezier(0.32,0.72,0,1)`;`:last-child { border-bottom:0 }` |
| 行 hover | 亮 `background: rgba(255,255,255,0.45)`;暗 `rgba(255,255,255,0.07)` |
| 行 active(按下) | 亮 `background: rgba(255,255,255,0.65)`;暗 `rgba(255,255,255,0.12)` |
| 标签 `.candidateLabel` | `font-size:14px; font-weight:600; color:var(--ink); flex:1; min-width:0`(超长省略由 flex 收缩处理,不强制 nowrap) |
| chevron `.candidateChevron` | 内联 SVG,`viewBox="0 0 12 20"`,path `m4 2 8 8-8 8`,`fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"`,`aria-hidden="true"`;CSS `width:9px; height:15px; color:var(--muted); opacity:0.75; flex-shrink:0`(iOS chevron 灰调) |
| 焦点 | 全局 `:focus-visible` outline(globals.css)已覆盖,行不额外定义 |
| 暗色 | 容器沿用现有 dark override;分隔线 `var(--line)` 暗色自动翻转;hover/active 用上表暗色值 |

## 验收门禁(全部通过才写汇报)

在 worktree 根目录(命令需相对路径):

```bash
cd server && npm test          # 基线 566 pass / 2 skip(2026-08-21),不得出现新增失败
cd server && npm run typecheck # 严格模式,零错误
make docs-check                # 文档规范检查
git diff --check               # 无空白错误
```

若门禁全绿,用 Conventional Commits 提交(建议单个 `feat:` 或 `fix:` + 说明);提交前 `git merge dev` 保持分叉小(仅当 dev 有新 commit)。

## 回报

写入汇报文件,格式:
- 改了哪些文件/行、关键 CSS/JSX 决策
- 门禁各命令结果摘要
- 遇到的问题(若有)

末两行必须精确(机器读取):

```
门禁: PASSED
结论: OK
```

若被阻断(门禁红/冲突无法解决),末两行写 `门禁: FAILED` 与 `结论: BLOCKED: <一句话问题>`,并记录遇到的问题。
