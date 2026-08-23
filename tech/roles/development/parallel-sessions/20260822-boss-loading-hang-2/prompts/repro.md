# REPRO —— 实证复现「首访卡死在加载界面」(2026-08-22 第二轮)

## 背景

上一轮静态分析定位的三链缺口(amap-api 8s 超时、mountError/retryMount、首访逐页超时)已
全部合入 dev(7b515e6)。但用户确认:**修复后首次进入仍卡死在加载界面,刷新后正常**。
「必定卡死」是确定性特征,静态推演未完全解释。本轮必须先**实证复现**,拿到第一手证据
(console / network / DOM 状态 / AMap 生命周期计数),再定位遗漏根因。不写修复代码。

## 任务(主仓库 /Users/acccan/domain-map,cwd=主树;dev HEAD 含全部修复)

### Step 1 — 起 dev server

1. 确认 `server/.env.local` 存在(有 AMAP key;**不打印内容**)。
2. 确认 localhost:3000 无监听(已核实)。后台起:`cd server && npm run dev > /tmp/dm-repro-dev.log 2>&1 &`
3. 轮询就绪:`curl -s -o /dev/null -w '%{http_code}' http://localhost:3000`,直到 200 或
   /tmp/dm-repro-dev.log 出现 "Ready"(最多 120s)。**记录 dev server 的 Next 版本与启动耗时**。
4. 注意:dev 首次访问时 Turbopack 冷编译 chunk,首帧可能慢;这不是 bug,是基线噪声,记录即可。

### Step 2 — Playwright 冷会话首访(模拟「第一次进入」)

写脚本到 `<batchDir>/repro-scripts/repro-1-first-visit.mjs`(参考 `/tmp/dm-verify-user-server.mjs` 的模式):

```js
import { chromium } from '/Users/acccan/.npm/_npx/86170c4cd1c5da32/node_modules/playwright-core/index.mjs';
// 新持久 profile(/tmp/dm-repro-cold-N,每次全新,零缓存=第一次进入)
// 真实 Chrome:/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
// headless: true + args: ['--no-sandbox','--enable-unsafe-swiftshader','--disable-breakpad']
```

采集(全部写入报告):
- `console` 消息(类型+前 140 字符,过滤 React DevTools 噪音)
- `pageerror`(✗ 重点!)
- `requestfailed`(url + 原因;区分 AMap CDN / 本地 API)
- AMap 生命周期补丁计数(参照 dm-verify-user-server.mjs 的 __dmLog:create/destroy 计数)——**这是关键证据**:若 destroy>create 或 create 后未 destroy 但无 view,说明 keepalive/StrictMode 链仍有洞
- 访问 http://localhost:3000,轮询最多 **90s**,判定并记录页面状态机:
  - 出现「地图加载失败」+ 重试按钮(修复生效:卡死已变错误态)→ 记 STATE=ERROR_UI
  - "Loading map..." 持续 90s 未消失 → STATE=STUCK(卡死仍存在,重点取证)
  - 地图正常渲染(AMap 容器有 canvas/瓦片)→ STATE=OK
  - 白屏/只剩 "Loading map…"(home-map 的 fallback)→ STATE=GATE_A(说明 chunk/dynamic 层)
- 每个状态转换点截图存 `<batchDir>/repro-artifacts/`(page-1.png 等,相对文件名)
- **记录 state 转换时间线**(什么时候出现 Loading → 什么时候变 OK/错误/不动)

### Step 3 — 对照组(判定「刷新即好」是否仍复现)

同一 context 内 `page.reload()` → 等 30s,记录同样信号(应 OK)。
再开**第二个全新 context**(repro-2,同样零缓存)首访 → 等 90s,记录。
两次全新首访的对比是「必定」的最硬证据。

### Step 4 — 证据报告

写 `<batchDir>/reports/repro.md`:
- 环境(dev server 版本/启动耗时、Chrome 版本)
- 三次访问(首访1/刷新/首访2)各自的:最终状态、关键 console/pageerror/requestfailed 摘录
  (带时间戳)、__dmLog create/destroy 计数
- **你的结论**:是否复现卡死?卡在哪一层(Gate A / Gate B / 错误态没出现 / 其他)?最可疑的
  新根因(带证据行)
- 不写代码、不改任何文件(除批目录内脚本/产物)
- 末两行:`门禁: PASSED | FAILED`(PASSED=复现取证完整完成,不代表修复有效)/ `结论: OK | BLOCKED: <问题>`

### 纪律

- 红线:不 git、不 push、不 merge、不 export、不 chmod、不 sudo、不 rm -rf、不 npx、
  不 npm install/ci/build。dev server 用后 `pkill -f "next dev"` 清理(或记录 pid 留给 boss)。
- 若 dev server 起不来(端口冲突等)→ 如实 BLOCKED。
