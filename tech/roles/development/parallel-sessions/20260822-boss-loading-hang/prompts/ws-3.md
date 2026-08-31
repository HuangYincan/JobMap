# WS-3 fix/loading-error-ui —— 加载覆盖层失败态(地图加载失败 + 重试)

## 背景(boss 已定位)

BUG:首次进入卡死 "Loading map..."(`map-shell.tsx:2254-2263` 覆盖层,`mapReady` 恒 false),
刷新即好。ws-2(并行)在 `useMapEngine()` 追加 `mountError` + `retryMount`(见契约);本 WS
给覆盖层加**失败态出口**:卡死不再是无反馈的永转,而是可操作的重试 UI。正常路径
(加载中/配置缺失文案)视觉零改动 —— 属于 bug 修复必需的交互补充,**不是设计改版**。

## 契约(ws-2 输出,钉死)

```ts
// useMapEngine() 返回追加:
mountError: { engine: string; code?: string; message: string } | null
retryMount: () => void   // 重新执行挂载链;挂载中/已有活 view 时 no-op
```

## 任务(worktree: /Users/acccan/dm-wt-load-ui,分支 fix/loading-error-ui)

修改文件:**仅** `server/src/components/map-shell.tsx` + `server/src/components/map-shell.module.css`
+ `server/src/lib/i18n.ts`(仅追加 key)+ `server/tests/component-contracts.test.mjs`(如需)。

### 覆盖层三态(map-shell.tsx:2256-2262)

1. `!mapReady && !mountError` → **现状零改动**("Loading map..." / "Set NEXT_PUBLIC_AMAP_KEY…" 文案、
   inline style 均不动)。
2. `!mapReady && mountError` → **新增失败态**(布局图见下)。
3. 配置缺失环境 —— 现状文案不动(不归 mountError 管)。

### 新增失败态布局图(boss 已批准方向;像素级微调归你)

```
┌──────────────────────────────────────────────┐
│                    (地图区域)                   │
│                                                │
│                 地图加载失败          ← 16px,fontWeight 600,var(--ink) │
│                                                │
│              [ 重试 ]              ← 按钮(胶囊) │
│                                                │
│          AMAP_LOAD_TIMEOUT · 网络超时   ← 12px,var(--muted),有则显示,单行 ellipsis │
│                                                │
└──────────────────────────────────────────────┘
```

- 容器:复用现有覆盖层 div(绝对定位 inset 0、flex 居中),增加 `flexDirection: column` 类
  (或包一层 column flex);原 inline style 改为 CSS module class 也行,但**加载中态必须
  渲染结果完全一致**——建议:覆盖层容器不动,失败态内部用新 class。
- 主文案:16px、fontWeight 600、`var(--ink)`;文案走 i18n key `mapLoadFailed`
  (zh 地图加载失败 / en Map failed to load)。
- 重试按钮(关键交互):
  - 胶囊:`border-radius: 999px`、`padding: 8px 20px`、`fontSize: 14px`;
  - 静置:背景 `rgba(0, 122, 255, 0.12)`、文字 `#007AFF`;hover 背景 `rgba(0, 122, 255, 0.2)`;
  - `:focus-visible` outline 2px `#007AFF` + offset 2px;dark mode 用同 token
    (若 `--blue` 等 token 在 globals.css 已定义,优先用 token);
  - 点击 → `retryMount()`;点击后按钮进「重试中…」态(disabled + `opacity 0.6`,文案
    `mapLoadRetrying` zh 重试中… / en Retrying…,**立即切回加载中态文案或保持按钮 pending
    皆可**,由 ws-2 的 mountError 清除时机自然驱动 —— 你只需在 mountError 为 null 后显示
    现状加载态;按钮 pending 动画不要求,简单 disabled 即可;
  - `<button type="button">` + aria-label(i18n);键盘可达。
- 错误小字:仅当 `mountError.message || mountError.code` 非空显示;12px、`var(--muted)`、
  单行 ellipsis(max-width 自适应,`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`)。
- i18n.ts 追加 key 必须 **zh+en 双写**(缺 key 会让 `t()` throw);按现有 key 命名风格
  (如 camelCase)加 `mapLoadFailed` / `mapLoadRetry`(zh 重试 / en Retry)/ `mapLoadRetrying`。

### 设计系统约束

- 蓝 `#007AFF` chrome;绿仅语义色(薪资/工时),此处不用;
- 不引入新组件库 / 不新 dynamic() 面板(StrictMode 纪律:覆盖层内不得挂 dynamic import);
- 移动端(≤767px)同样生效(覆盖层是绝对定位全屏,天然适配;无需额外断点,验证即可)。

## 不做(边界)

- 不改加载中/配置缺失文案与样式;不动 useMapEngine / amap-api / viewport-search。
- 不新增全局 toast/alert;不碰 tech/ 文档(文档槽位 boss 统一补)。
- 不 merge、不 push、不碰主树。

## 门禁(worktree 内;cd server 运行)

- `npm test` 全绿(基线 978 pass / 2 skip)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- Conventional Commits(如 `fix(map-shell): 加载覆盖层失败态 + 重试按钮`),小步提交

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang/reports/ws-3.md`:
实际改动摘要、i18n key 表(zh/en)、门禁结果(四项逐条)、遇到的问题(尤其
component-contracts 断言是否需更新,更新了什么)、测试前后计数。
**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
