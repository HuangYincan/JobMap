# WS-gate-a fix/gate-a-guard —— dynamic chunk 加载层超时守卫(GATE_A)

## 背景(REPRO 实证,reports/repro.md R5)

`server/src/components/home-map.tsx:5-20` 用 `next/dynamic(() => import("@/components/map-shell"), { ssr: false, loading: () => <div ...>Loading map…</div> })`。
**该 loading fallback 无任何守卫**:map-shell chunk 的 import promise 一旦挂起(dev Turbopack
live-merge 坏状态 / 网络),页面永留 "Loading map…" —— 唯一一条「必定卡死且刷新即好」仍在的路径
(R5 实证:拦截 map-shell chunk → 60s+ 永留,无错误、无超时、无重试;且此层卡死时 GATE_B 的
错误态 UI 根本不渲染,解释「修复了 GATE_B 用户仍看到卡死」)。本轮给 GATE_A 加守卫出口。

## 任务(worktree: /Users/acccan/dm-wt-gate-a,分支 fix/gate-a-guard,从 dev 预建)

修改文件(边界):
- `server/src/components/home-map.tsx`(必改)
- `server/src/components/home-map.module.css`(若不存在则新建;新样式走 CSS module)
- `server/src/lib/i18n.ts`(仅追加 key,若 HomeMap 能拿到 lang——**先核实**:HomeMap 里
  getBrowserLanguage / t 的可用性;不可用则失败态文案与现状 "Loading map…" 一致,
  硬编码 zh 文案 + en 兜底也可,报告里说明取舍)
- `server/tests/component-contracts.test.mjs`(如需)

### 实现要点

1. **守卫组件**:把 `loading` 参数从 inline JSX 换成一个小组件 `MapLoadingGuard`(文件内或同组件):
   - 挂载即启动 `GUARD_TIMEOUT_MS`(具名常量,**15_000**)计时(useEffect + setTimeout,cleanup 清;
     组件卸载(dynamic 完成)后 timer 不再生效——零泄漏)。
   - 计时内正常显示现状 `Loading map…`(零视觉改动)。
   - **超时后**切换为失败态(布局图见下):主文案 + 重试按钮 + 小字。
   - 重试按钮点击 → `window.location.reload()`。原因写明在注释:Next dynamic 的 import
     promise 挂起后不会重试,reload 是唯一可靠通道(与用户「刷新即好」行为一致)。
2. **失败态布局图**(GATE_B 同款视觉语言,可参考 `map-shell.module.css` 中 ws-3 的失败态类):

```
┌──────────────────────────────────────────────┐
│                    (地图区域)                   │
│                地图加载失败            ← 16px/600/var(--ink) │
│              [ 重试 ]                ← 胶囊按钮 │
│      加载超时,请检查网络后重试        ← 12px/var(--muted) │
└──────────────────────────────────────────────┘
```

   - 按钮样式沿用 GATE_B 约定:胶囊 `border-radius:999px`、`padding:8px 20px`、`fontSize:14px`;
     背景 `rgba(0,122,255,0.12)`、文字 `#007AFF`;hover `rgba(0,122,255,0.2)`;
     `:focus-visible` outline 2px `#007AFF`;dark mode 同 token;`<button type="button">`。
3. **不改 dynamic 配置本身**(ssr:false 保持;不要挪到 page.tsx —— 项目铁律)。
4. **i18n**:新增 key 若走 `t()` 则 zh+en 双写;若 HomeMap 无 lang 通道,硬编码时注释说明
   与现状 `Loading map…` 的处理一致。

### 必做验证(本 WS 门禁的一部分,不能省略)

用 Playwright 复刻 repro R5 的拦截法,证明守卫生效(这是本 bug 唯一可复现路径):
1. 起 dev server:先查 `lsof -i :3000`,若有在跑且 cwd 是主树 server(dev HEAD)→ 可直接复用;
   否则 `cd server && npm run dev > /tmp/... 2>&1 &` 等 Ready。
2. 写脚本到批目录 `repro-scripts/verify-gate-a-fix.mjs`(参考 `repro-scripts/repro-5-chunk-stall.mjs`;
   playwright-core import 路径与 Chrome 路径同 repro):
   `page.route('**/_next/static/chunks/**map-shell**', route => {/* 永挂,不 continue */})`
   → 冷 profile 访问 `/` → 时间线记录:0-15s 应见 "Loading map…",**15s 后应见「地图加载失败」**;
   `map-shell` 相关 chunk 恢复放行(`route.continue()`)后(或直接 reload)→ 应正常进 OK。
3. 截图存 `repro-artifacts/gate-a-fix-error.png`(15s 后)与 `gate-a-fix-ok.png`(reload 后)。
4. 报告里给时间线(不能只有结论)。

## 不做(边界)

- 不改 map-shell.tsx / use-map-engine / amap-api / viewport-search;不碰 tech/ 文档
  (boss 统一补);不 merge、不 push、不碰主树(主树只读;验证脚本/截图写批目录)。

## 门禁(worktree 内;cd server 运行)

- `npm test` 全绿(当前基线 1446 pass / 2 skip)
- `npm run typecheck` 通过
- `make docs-check` 通过
- `git diff --check` 通过
- **Playwright 守卫验证通过**(15s 出现失败态)→ 证据写报告
- Conventional Commits(如 `fix(home-map): dynamic chunk 加载超时守卫 + 失败态`),小步提交

## 回报

`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-loading-hang-2/reports/ws-gate-a.md`:
改动摘要、i18n 取舍、**Playwright 时间线**(含截图路径)、门禁结果(五项)、遇到的问题。
**末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
