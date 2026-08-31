# REPRO 汇报:实证复现「首访卡死在加载界面」(2026-08-22 第二轮)

## 环境

- dev server:**Next.js 16.3.1 (Turbopack)**,`npm run dev` 启动,`✓ Ready in 308ms`;首访问 `GET / 200 in 319ms`
  (冷编译极快);运行日志在后台任务文件 `/private/tmp/claude-501/.../tasks/bwyzkwk9e.output`(沙箱禁止重定向到 /tmp,
  dev-server.log 未能落批目录 logs/,已在 logs/ 记录此偏差)。
- Chrome 151.0.7922.173(真实 Google Chrome,`--no-sandbox --enable-unsafe-swiftshader --disable-breakpad`)。
- 引擎配置:.env.local 具名变量(仅列名,不打印值)= `NEXT_PUBLIC_AMAP_KEY / NEXT_PUBLIC_AMAP_SECURITY_CODE /
  NEXT_PUBLIC_TENCENT_JSAPI_KEY / NEXT_PUBLIC_BAIDU_AK` —— **三引擎全配置**,回退链 `amap → tencent → baidu` 可用。
- ⚠️ **重要环境偏差**:开工时端口 3000 **已被占用**(PID 49296/49297,`next dev` + `next-server`,12:10:11 启动,
  cwd=主树 server/)——与 prompt「已核实 3000 无监听」不符。该进程是**第一轮遗留 dev server**:它 12:10 启动,
  而本轮修复 merge(7b515e6)在 **12:17 落到其下**(round-1 的 merge.log 时间戳)。用户「修复后首访」很可能
  打的就是这台**带着 live-merge 状态**的旧 server。我已 kill 它并用干净 server(dev HEAD)复测。
- 脚本:repro-scripts/repro-1-first-visit.mjs(5 次正常访问)、repro-2-headed.mjs(有头)、repro-3-fault-inject.mjs、
  repro-4-allfail-retry.mjs、repro-5-chunk-stall.mjs、repro-5b-screenshot.mjs;截图 27 张在 repro-artifacts/(page-N-*.png)。
- 注:带 stalled chunk 的页面 Playwright 截图始终超时(稳定性等待永不满足,重试 3 次含 CDP 直捕均失败)——GATE_A
  卡屏证据以 DOM 文本(12s 时 `"Loading map…"`)与状态时间线为准;视觉样本为 repro-5 末尾成功捕获的
  `page-10-final.png`(61.6s,页面仍处 GATE_A)。

## 结果总览

| 运行 | 模式 | 条件 | 时间线 | 最终状态 |
|---|---|---|---|---|
| V1 | headless 全新 profile /tmp/dm-repro-cold-1-* | **冷首访** | GATE_A 0.6s → OK 2.1s | **OK** |
| V2 | 同 context | reload | GATE_A 0.8s → OK 1.8s | **OK** |
| V3 | headless 全新 profile /tmp/dm-repro-cold-2-* | **冷首访#2** | GATE_A 0.1s → OK 1.2s | **OK** |
| H1 | headed 全新 profile /tmp/dm-repro-headed-* | **冷首访(真实窗口)** | BLANK → LOADING 0.7s → OK 1.3s | **OK** |
| H2 | headed 同 context | reload | OK 0.6s | **OK** |
| R1 | headless | AMap CDN **停滞**(永不响应) | LOADING → OK 9.4s | **OK(腾讯 TMap 回退,amap:false)** |
| R2 | headless | AMap CDN **abort** | OK 1.6s | **OK(腾讯 TMap 回退,amap:false)** |
| R4 | headless | **三引擎 CDN 全 abort** | ERROR_UI **1.6s** → 放行+点重试 → OK 42.4s | **OK(真实 AMap)** |
| R5 | headless | **map-shell chunk 停滞** | **GATE_A "Loading map…" 0.1s→60s+,无错误态** | **STUCK(GATE_A)** |

## 详细证据

### V1/V2/V3(首访1 / 刷新 / 首访2)— 无卡死

- 状态机时间线:V1 `[0.6s] GATE_A → [2.1s] OK`;V2 `[91.8s→93.6s] GATE_A→OK`(reload 后 1.8s);V3 `[0.1s] GATE_A → [1.2s] OK`。
  **「Loading map...」最长仅存活 ~1s,90s 观测期内零 STUCK。**
- pageerror:**0 条**(V1/V2/V3 全部)。V2 有 101 条 requestfailed、V3 有 266 条 —— **全部是
  `favicon.im/...` → `net::ERR_BLOCKED_BY_ORB`**(招聘站 favicon 采集,ORB 拦截),与卡死无关;本地 API 与 AMap
  CDN **零失败**(AMap CDN 49 项全部 200/304,瓦片正常拉取:jsapi-data1~5.amap.com 200)。
- console 仅 4 条:[HMR] connected / Canvas2D willReadFrequently 警告 / [Fast Refresh] rebuilding+done(175ms,
  dev 噪声,页面在重建前已 OK)。
- 首访唯一差异:V1 在 OK 瞬间 `0 个结果`(V2/V3 为 `20 个结果`)——dev log 显示首次 `/api/pois` 冷编译
  (911ms/1146ms)期间的在飞状态,90s 终态同样 20 个结果,**非缺陷**。
- H1 附加细节:`#map-canvas` 内 canvas 1280×720,`mapCanvasChildren` 从 2(overlay+容器)变 1(**canvas 全程保持 1,
  无 destroy 迹象**);pageerror 0、requestfailed(amap/local)0。

### __dmLog 计数器 —— 补丁不可用(已定位原因)

两轮脚本的 `AMap.Map` 生命周期补丁均 `create=0 destroy=0`。repro-2 探针证明:补丁在脚本加载后 ~0.9s
**成功安装且 `assigned=true`**(早于地图创建 ~0.2s),但创建仍未被记录 → **厂商在补丁之后重建/替换了
`AMap.Map` 引用**(补丁安装时 `protoCtor='S'`,为占位类)。结论:**create/destroy 计数证据作废**;本文以
canvas 数量恒为 1 作为「零销毁/零重建」证据(更可靠且直接)。

### R1/R2 —— 上一轮「amap-api 8s 超时 + 引擎回退」修复链实证生效

- R1(AMap 脚本停滞):**8s 超时 → 引擎回退(腾讯 TMap)→ OK 9.4s**;页面无错误 UI、无 pageerror;
  `window.AMap=false` 全程(证明地图是回退引擎渲染的)。dev server 日志出现唯一痕迹:
  `[browser] [map-engine] TMap 无 lngLatToContainerPoint,...(tencent-engine.ts:563)`。
- R2(abort):onerror 立即触发 → 回退 → **OK 1.6s**。

### R4 —— 全引擎失败:错误态 + 重试链完整闭环

- 三引擎 CDN 全 abort → **1.6s 出现 ERROR_UI**:「地图加载失败 / 重试 / `script-load-failed · [map-engine] baidu
  load 失败(script-load-failed):BMapGL script failed to load`」;console 输出分类诊断
  (`{code, stage, guidance}`)与 `[use-map-engine] ... load/createView failed`。
- 错误态稳定保持 0→39s(无自动恢复、无假 OK);放行 CDN + 点「重试」→ LOADING 40.9s → **OK 42.4s(amap:true,
  真实高德)**。
- 小标注:`mountError.engine` 显示 `amap`(偏好引擎)而 message 是 baidu 的 —— 全链失败时 engine 字段取
  `resolved.id` 而非最后失败引擎,标注不一致(不阻断,供 boss 知悉)。

### R5 —— 关键:当前代码唯一能「卡死在加载界面」的层 = GATE_A(chunk 层)

- 拦截 `**/_next/static/chunks/**`(含 `src_components_map-shell_tsx_0wrl7z5._.js`,即 home-map
  `dynamic(() => import("@/components/map-shell"))` 的 chunk)永不响应 → 页面 **0.1s 起只剩
  `"Loading map…"`(home-map fallback,U+2026)**并保持 **60s+**(State 快照 0.1s→58.2s 全程 GATE_A;
  独立复验:12s 时 DOM 文本三次确认 `"Loading map…"`):无 ERROR_UI、无 pageerror、无超时、无重试。
  视觉样本 `page-10-final.png`(61.6s 捕获,页面仍处 GATE_A)。
- 放行网络后**仍不恢复**(模块加载失败/挂起不重试;页面也无任何恢复机制)→ 与「刷新后正常」完全一致的
  唯一机制就是 refresh(重新请求 chunk)。
- 对比:map-shell 到达后(mount 链)已有 8s/25s 双超时 + 三引擎回退 + ERROR_UI + 重试(R1/R2/R4 实证)。

## 结论:是否复现卡死?卡在哪层?

1. **「首访必卡死」在干净环境下未复现**:dev HEAD + 全新 server + 全新 profile(headless 2 次冷首访 + headed 1 次
   冷首访)全部 1.2~2.1s OK,刷新对照亦 OK。
2. **静态分析定位的三链缺口修复已实证有效,但修的是「错层」**:R1/R2/R4 证明 mount 链(CDN 停滞/失败/全失败)
   如今被 8s 超时 → 引擎回退 → 25s watchdog → ERROR_UI → 重试 完整覆盖,**在当前代码下 mount 链不可能导致
   >25s 静默卡死**。
3. **「卡死在加载界面」唯一还能成立的层 = GATE_A(home-map 的 `Loading map…` chunk 层)**——R5 实证:该层
   **无任何守卫**(无超时/错误态/重试),chunk 请求挂起即永久停留在加载界面,与用户症状逐字吻合
   (加载界面 = fallback 全屏),且刷新(重新请求 chunk)必然恢复。
4. **最可疑的触发源(环境/时序,非代码)**:用户首访打的是 **12:10 启动、12:17 被 merge 落在其下的 round-1 遗留
   dev server**(本次开工时仍在监听 3000)——Turbopack live-merge 后首次 chunk 编译/服务处于不确定状态;
   或浏览器缓存持有 merge 窗口期的不完整 chunk(首访用坏 chunk → 挂起;刷新重新校验 → 正常)。
   两机制都与「必定卡死 + 刷新即好」的单次性完全相容,且都无法在新 server+新 profile 上复现。
5. 次要事实:bug 报告的「卡死」现象中对修复的验证窗口(错误态按钮)在 GATE_A 层根本不可达 —— 若用户确实
   处于 GATE_A 卡死,即便 ERROR_UI 修复上线,该屏也不可能变化,这解释了「修复后仍卡死」的观感。

## 对 boss 的建议(待裁决;本轮未写任何代码)

- 让用户**重启 dev server(建议同时清 `server/.next/dev`)**后用干净 server 复测;若仍卡死,抓
  `Loading map…`(带 U+2026)还是 `Loading map...`(ASCII)的区分 + DevTools network 中 map-shell chunk
  请求的挂起证据 → 可 100% 定层。
- 若要代码层兜底(下轮任务候选):给 home-map 的 `dynamic()` 挂 chunk 级守卫(超时/错误 boundary/重试
  import),或对 `_next/static/chunks` 挂起做可见恢复 —— 属新功能设计,不在本 REPRO 任务范围。
- 遗留 server 已 kill;守护命令:`npm --prefix /Users/acccan/domain-map/server run dev`(日志输出走后台任务,
  /tmp 重定向被本会话沙箱禁止)。

门禁: PASSED
结论: OK — 取证完整;「首访卡死」在干净环境未复现,已实证其唯一可能层为 GATE_A(chunk 层,无守卫),最可疑触发源为 round-1 遗留 dev server 的 live-merge 状态/浏览器坏缓存,等待用户侧按建议复测
