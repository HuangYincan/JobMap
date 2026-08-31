# ws-e 汇报(2026-08-22) — fix/icon-cors-preflight(favicon CORS 预检 + 降级徽章)

worktree:`/Users/acccan/dm-wt-icon`,分支 `fix/icon-cors-preflight`,基座 `6b260c0`(20260822 agent-panel-v2 批次入库)。

## 实际改动(4 commits)

1. **`server/src/lib/map-engine/icon-preflight.ts`(新,feat)** — 共享 CORS 预检模块:
   - `remoteIconStatus(src)` → `'data' | 'ok' | 'fail' | 'unknown'`:data: URI 恒 `'data'`(本地无需预检);已预检成功 `'ok'` / 失败 `'fail'` / 未预检 `'unknown'`;
   - `preflightRemoteIcon(src)` — 幂等后台预检 `fetch(src, { mode: 'cors' })`:无 ACAO 头 → fetch reject → fail;CORS/网络/非 2xx 一律 fail;**成功与失败均记忆化**(模块级 Map,同会话同 URL 不重复,失败不重试);pending 期间去重;data: 不预检;无全局 fetch 时 no-op(保持 unknown 降级,不抛);
   - `isRemoteIconUrl(src)` — http(s) 闸:data:/相对路径/blob: 同源恒安全直通,避免对相对路径误触发 fetch(既有 baidu 测试传 `'pin.svg'`/`'x.png'`,此闸保证零漂移);
   - `resetIconPreflightCache()` — 测试钩子(生产不调用);纯模块无 React/引擎依赖。
2. **`server/src/lib/map-markers.ts`(fix,仅 TMap icon 构造段 L539 起)** — 远程未验证/已失败 → 降级 `svgToDataUri(recruitmentBadgeSVG(...))`(白底蓝框 emoji 徽章,纯本地 data URL,SDK 加载必成功 → 零报错零 SDK 默认 marker);data:/已预检 ok → 真 src;未验证时触发后台预检,**成功后下次 LOD 重建/重渲染自然升级**真 logo(不做已渲染 marker 原地升级,为未来 CORS 合规图源预留)。
3. **`server/src/lib/map-engine/baidu/baidu-engine.ts`(fix,核查性防御)** — **核查结论:BMapGL 确有 icon 路径接收远程 URL**(`createMarker` 内 `new BMapGL.Icon(opts.icon.src, ...)`,L670 段;BMapGL 同为 WebGL,远程纹理同样需要 CORS)→ 接入同款预检闸:远程未验证/已失败 → 不构造远程 Icon,回退 content 锚点路径(透明 1×1 dataURL 图标,msTarget DOM 渲染 `<img>` 无需 CORS);data:/相对路径/已 ok → 原样。现有 content 路径零改动,相对路径 icon 行为不变。
4. **`tech/23-map-engines.md`(docs,仅追加)** — 末尾追加 ws-e 节:三引擎 icon 路径 CORS 敏感度表(AMap DOM 免 CORS / TMap icon 纹理必须 / BMapGL 当前 content 免)、机制说明、实现与验收标准。

## 测试(新增 15 项,零漂移)

- 新 `server/tests/icon-preflight.test.mjs`(13 项):data 直通 / unknown / 2xx→ok / CORS 拒绝→fail / 404→fail / pending 去重 / fail·ok 记忆化 / data 不预检 / 无 fetch no-op / reset 钩子 / **TMap icon 构造断言**(未验证→徽章 dataURL + 预检触发 `{mode:'cors'}`;ok→真 src + 升级路径;fail→徽章不重试;data URL 与缺 logo 零预检;**AMap 引擎零变化不设 icon**)。
- `server/tests/map-engine-baidu.test.mjs` 追加 2 项:远程未验证 icon + content → 回退 content 锚点(dataURL 1×1)+ 后台预检;预检 ok → 真 URL Icon 直通 / fail → 回退不重试(afterEach 加 `resetIconPreflightCache` 防串扰)。

## 门禁结果

- npm test: **1359 通过 / 0 失败 / 2 skip**(基线 1344 + 新增 15,零漂移)
- typecheck: 通过(修过一处 TS 收窄:`if (iconUsable)` → `if (iconUsable && opts.icon)`)
- make docs-check: 通过;git diff --check: 通过

## 遇到的问题

- **既有 baidu 测试传相对路径 icon(`'pin.svg'`/`'x.png'`)** → 直接按「远程」处理会破坏既有 Icon 构造断言 → 加 `isRemoteIconUrl` http(s) 闸,相对路径/dataURL 恒直通,仅真远程 URL 走预检;
- **`iconUsable` 默认 true 时无 icon 分支误入** → 重构为 `opts.icon` 存在才判定,无 icon 仍走 content 分支(与原语义一致)。

## 证据

- 测试输出摘要:icon-preflight 13 pass / baidu 63 pass(含新增 2)/ 全量 1359 pass 2 skip;
- commits:`fa5a437`(feat 模块+测试)、`c8126d0`(fix map-markers)、`9de4ce8`(fix baidu-engine+测试)、`3124474`(docs tech/23)。

门禁: PASSED
结论: OK
