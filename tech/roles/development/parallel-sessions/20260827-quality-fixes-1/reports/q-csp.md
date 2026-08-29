# q-csp 汇报(2026-08-27)

## 实际改动
- `server/next.config.ts` → 将原先全站共享 CSP 拆成 `MAP_CSP` 与 `STRICT_CSP`：根路径 `/` 使用地图兼容策略，非根路径 `/:path+`（包含 `/api/*` 与未来独立账号页）使用严格策略；公共安全头保持原有语义。
- `server/next.config.ts` → 地图策略继续显式允许 AMap、百度地图、腾讯地图脚本/样式 host，保留地图所需的 `https:` 图片与连接来源；`'unsafe-inline'` 仅在根路径保留；`'unsafe-eval'` 仅在 development 条件下拼入根路径脚本策略，生产构建不含该项。
- `server/tests/security-headers.test.mjs` → 增加路由绑定、严格策略无 `'unsafe-*'`、地图策略保留 `'unsafe-inline'`、地图 SDK 脚本 host 及 development-only `'unsafe-eval'` 的配置回归测试。
- `tech/15-deploy.md` → 记录 CSP 路由范围、账号/Agent 当前仍属于根路径 overlay、残余 `'unsafe-*'` 的精确范围、`https:` 图片/连接宽泛来源的地图兼容原因，以及 nonce/hash 未落地的剩余风险。

## 复验与兼容性证据
- 复验原始 `server/next.config.ts`：原策略通过 `source: "/:path*"` 覆盖全站，`script-src` 同时包含 `'unsafe-inline'`/`'unsafe-eval'`，`style-src` 包含 `'unsafe-inline'`。
- 生产 webpack 构建生成的 `.next/routes-manifest.json` 验证：`/` 命中地图策略，`/:path+` 命中严格策略；生产根路径 `script-src` 无 `'unsafe-eval'`，非根路径无任一 `'unsafe-*'`。
- `npm run build -- --webpack` 成功，证明 Next.js 16.3.1 接受 `/:path+` 路由 header 配置并完成静态页生成。默认 Turbopack 构建另有环境阻断（见下）。
- 现有地图相关测试在完整 server 测试套件中保持通过；AMap 动态脚本 host、地图样式 host 仍在根路径策略中，账号/Agent 组件未改动。

## 门禁结果
- `npm test`: 1688 通过 / 0 失败 / 3 跳过（共 1691；包含新增 CSP 测试）
- `npm run typecheck`: 通过
- `make docs-check`: 通过
- `git diff --check`: 通过
- 额外 `npm run build -- --webpack`: 通过

## 遇到的问题
- 默认 `npm run build`（Turbopack）在读取 worktree 的 `server/node_modules` symlink 时失败：`Symlink [project]/node_modules is invalid, it points out of the filesystem root`。这是当前 worktree/沙箱依赖布局问题，不是 CSP 或路由配置错误；使用 Next.js 16 支持的 `--webpack` 构建成功验证了配置。
- 未引入 nonce/hash：当前地图 SDK 通过运行时 DOM 注入脚本，并由地图/marker 运行时创建 style 元素；现有架构没有统一 nonce 注入链或稳定 hash 清单。为避免“删除字符串但地图运行即坏”，保留根路径 `'unsafe-inline'`，并把风险隔离到地图页；生产已移除 `'unsafe-eval'`。
- 根路径的 `img-src`/`connect-src` 仍有 `https:`，因为外部地图瓦片/CDN 与公司 logo/岗位照片 host 会变化；该宽泛来源只作用于地图路由，后续应以浏览器 Network/CSP violation 清单继续收窄。

## 证据
- 生产路由清单：`server/.next/routes-manifest.json`（构建产物，未纳入提交）显示 `/` 与 `/:path+` 两条 header 规则及其最终 CSP。
- 提交：`7fa5b57`（CSP 路由拆分）、`6d45add`（header 测试）、`6a92c9f`（部署文档）。

门禁: PASSED
结论: OK
