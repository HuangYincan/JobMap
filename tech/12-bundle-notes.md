# Bundle 盘点（2026-08-16）

首页 `page.tsx` 是 Server Component，只渲染 `HomeMap`。`home-map.tsx`（`"use client"`）再用 `next/dynamic` + `ssr: false` 加载 `MapShell`。Next 15 不允许在 Server Component 里写 `ssr: false`。高德脚本仍走 `loadAMap()`，不进 npm bundle。

**第一方 npm（server/package.json）**

| 包 | 用途 | 客户端？ |
|---|---|---|
| next 15.5 / react 19 / react-dom 19 | App Router | 是 |
| pg | 有 `DATABASE_URL` 时的账户存储 | 否，只在 API / account-store |

**刻意没装**

- react-virtuoso — 列表用 `content-visibility` + 固定 intrinsic size
- framer-motion / shadcn / Tailwind — CSS Modules + 自写动画
- zustand — 状态在 `MapShell`

**拆分约定**

- `home-map.tsx` `dynamic` 加载整个 `MapShell`。壳里的 Explore 搜索/列表/筛选保持同步 import（首屏工作路径）。详情、JD、登录、Profile / Recent / Saved / Layers 用 `next/dynamic` 拆出，点开才下；主导航 hover / focus 预取对应 chunk。不要再为了数字把霜面卡打散。
- 公开读 API 有 30s 进程缓存，不替代这份前端拆分。
