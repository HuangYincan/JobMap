# Workstream — fix/icon-cors-preflight(favicon CORS 预检 + 降级徽章)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-icon`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-e.md`(末两行 token,见文末)。

## 背景(boss 真机验证实锤,2026-08-22)

**用户报「疯狂报错」+ bug 1/7(TMap POI 失效/样式不对)**:boss Playwright 实测实锤根因——

1. **favicon.im 不返回 CORS 头**(`Access to image at 'https://favicon.im/...' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`)—— 浏览器实测确认
2. **TMap GL 是 WebGL 渲染**:marker 图标作为 GPU 纹理加载,纹理必须 CORS-clean → favicon.im 无 CORS 头 → **永远加载失败**
3. TMap SDK 对失败的 icon 报 `Image加载失败: <url> 改为用默认marker`(SDK 内部 console.error,**疯狂刷屏**:单次引擎加载 179-190 errors;dev log 累计 10192 次)并**把 marker 替换成 SDK 默认样式** → bug 7「POI 样式不对」的直接成因
4. 我们的候选链(favicon.im → icon.horse)内联 onerror 只在 **AMap content 的 HTML 路径**生效;TMap 走 **icon 路径**(`map-markers.ts` L539-545 把 `poi.company.logoUrl` 直接作 `icon.src` 交给 SDK),SDK 自己的 onerror 处理失败,**候选链在 TMap 上无机会执行**
5. AMap 是 DOM 渲染,`<img>` 无需 CORS → favicon.im 正常显示;百度 BMapGL 公司 POI 走 content 路径(DOM 覆盖层)→ 也正常。**问题特定于 TMap 的 icon 纹理路径**

## 任务

### 1. 共享预检模块(新文件 `server/src/lib/map-engine/icon-preflight.ts`)

- `remoteIconStatus(src: string): 'data' | 'ok' | 'fail' | 'unknown'`
  - `data:`(data: URI → 本地,无需预检,恒安全)
  - `ok:` 已预检成功 / `fail:` 已预检失败 / `unknown:` 未预检
- `preflightRemoteIcon(src: string): void` —— 幂等:CORS 预检 `fetch(src, { mode: 'cors' })`(失败即 CORS/网络失败);结果缓存于模块级 Map(同会话同 URL 不重复);进行中(pending)不重复发起
- 纯模块,无 React 依赖,可测试

### 2. map-markers.ts TMap icon 段改造(L539-545)

- `engine?.id === 'tencent'` 的 icon 构造:
  - src 为 data URL → 原样
  - src 为远程 URL 且 `remoteIconStatus === 'ok'` → 原样(真 logo)
  - **否则(data URL 徽章不经过,远程未验证/已失败)→ 降级为 `svgToDataUri(recruitmentBadgeSVG(...))`**(白底蓝框 emoji 徽章,纯本地 data URL,SDK 加载必成功 → **零报错、零 SDK 默认 marker**)
  - 远程未验证(unknown)时触发 `preflightRemoteIcon(logo)` 后台预检;预检成功后**下次 LOD 重建/重渲染自然升级**为真 logo(首帧降级 + 成功升级,不做已渲染 marker 的原地升级——favicon.im 在 TMap 上恒失败,升级路径是为未来 CORS 合规图源预留)
- **验收标准**:TMap 下 favicon.im 加载失败 → console 零「Image加载失败」报错;失败公司显示我们的 emoji 徽章(不是 SDK 默认样式);已验证 URL 显示真 logo

### 3. 百度引擎核查(若涉及)

- boss 判断:百度公司 POI 走 content 路径(BMapGL DOM 覆盖层,`<img>` 无需 CORS)不涉及;但**核查** baidu-engine 是否在 icon 路径接收远程 URL(BMapGL `new Icon(src)`),若可能涉及,同样接预检防御(仅防御,不改变现有 content 路径行为)

### 4. 测试与文档

- 新测试 `server/tests/icon-preflight.test.mjs`(或并入现有):data URL 直通、远程 unknown 首次降级 + 预检触发、预检成功后 ok、失败后 fail 不重试、map-markers TMap icon 构造断言(未验证→徽章 dataURL;ok→真 src;fail→徽章且不重试)
- `tech/23-map-engines.md` 回填(仅追加):WebGL 纹理 CORS 限制 + 预检降级机制记录
- 全量门禁见批次 README(基线 1296,合并后主树)

## 文件边界

- 只允许改:`server/src/lib/map-engine/icon-preflight.ts`(新)、`server/src/lib/map-markers.ts`(**仅 TMap icon 构造段 L539-545**)、`server/src/lib/map-engine/baidu/baidu-engine.ts`(仅 icon 路径核查性防御,若无涉及则零改动)、`server/tests/`(相关测试)、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:tencent-engine.ts 其他段、amap 引擎、switch.ts、use-map-engine.ts、map-shell.tsx、其他组件、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-icon/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-icon && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-e.md`:预检模块设计、map-markers 改造、百度核查结论、测试、验证摘要。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
