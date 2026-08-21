# Workstream c — fix/baidu-diagnostics(百度加载失败诊断 + 防御)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-ic`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-c.md`(末两行 token,见文末)。

## 背景(boss 真实验证 + 用户反馈)

**bug 3「百度为什么还是加载不了」**:boss 环境 Playwright 实测百度**正常**(bmapPresent=true、canvas 渲染、无错误)—— 排除代码回归。用户端加载不了,可能原因(按概率):
1. **浏览器缓存旧 JS bundle**(用户未硬刷新;旧 bundle 无 ws-c 就绪修复)→ 指引:硬刷新(Cmd+Shift+R)
2. **访问 URL 非 localhost:3000**(127.0.0.1 / 局域网 IP / 其他端口)→ 百度 referer 白名单只含 localhost:3000 → 瓦片/SDK 被拒
3. **dev server 未重启**(.env.local 修改后 Next dev 应自动重启,但用户进程若为旧进程则新 key 未加载)
4. 用户浏览器 console 有具体错误(未提供)

## 任务

### 1. 加载失败诊断增强(baidu-engine.ts + use-map-engine.ts 错误路径)

- 引擎 load/createView 失败时,把**失败原因细节**输出到 console(已有)并**显示到 UI**(toast/横幅,复用现有错误提示组件,不新增设计)—— 用户下次遇到可直接看到「百度加载失败:xx」而非空白
- 失败原因分类:AK 被拒(APP不存在/服务被禁用)、referer 校验失败、就绪超时(瓦片未加载)、脚本加载失败 —— 给出**可操作指引文案**(如「检查 lbsyun 控制台 referer 白名单是否含当前访问地址」)
- 注意:不改现有 UI 设计 —— 复用现有错误展示通道(若有 toast/alert 组件);无则仅在 console 输出结构化错误(如实记录,不新增 UI 组件)

### 2. 防御:脚本加载幂等性核查

- 核查 getscript 加载的幂等:重复加载(切走再切回/多次切换)时 script 标签是否重复注入、命名空间等待是否死锁
- 核查 waitForBaiduNamespace 轮询在「script 加载成功但 AK 拒绝」场景的行为(是否会卡在轮询直到超时)—— 若会,提前探测 AK 有效性(如检测 SDK 内错误标记)

### 3. 测试与文档

- `server/tests/map-engine-baidu.test.mjs`:错误分类断言、幂等加载断言
- `tech/23-map-engines.md`:百度加载失败排查清单(回填)
- 全量门禁见批次 README(基线 1212)

## 文件边界

- 只允许改:`server/src/lib/map-engine/baidu/baidu-engine.ts`、`server/src/hooks/use-map-engine.ts`(错误路径段)、`server/tests/map-engine-baidu.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:腾讯/高德引擎、`switch.ts`、`map-markers.ts`、`map-shell.tsx`、`map-shell.module.css`、`server/data/**`、`tech/01|03|06`、`agent.md`

## 门禁

1. `cd /Users/acccan/dm-wt-ic/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-ic && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-tmap-interaction/reports/ws-c.md`:错误分类与指引文案、幂等核查结论、排查清单回填摘要。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
