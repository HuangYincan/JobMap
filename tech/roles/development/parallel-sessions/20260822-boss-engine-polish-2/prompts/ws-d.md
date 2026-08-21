# Workstream d — fix/tencent-locate(腾讯定位高精度对齐)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-tl`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-d.md`(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22)

**用户 bug 5 腾讯部分「用户定位不是真实位置」**:
- `tencent-engine.ts` L1106-1120 `browserPosition()`:`navigator.geolocation.getCurrentPosition(..., { timeout: 8000, maximumAge: 60000 })` —— **缺 `enableHighAccuracy: true`**(部分浏览器回退 IP/基站级精度)+ **`maximumAge: 60000`(60s 位置缓存**——用户移动后 60s 内重复定位返回旧位置,观感「不是真实位置」)
- AMap 对照:`AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000 })`(无 maximumAge 缓存)
- 腾讯已走浏览器定位(wgs84→gcj02 转换正确),只需参数对齐

## 任务

### 1. 定位参数对齐 AMap

- `browserPosition()`:`enableHighAccuracy: true` + `maximumAge: 0`(不缓存旧位;注意 maximumAge:0 每次都重新请求,符合「定位 = 真实当前位置」语义)
- timeout 8000 保留
- wgs84→gcj02 转换保留(腾讯底图 gcj02)
- 测试:mock navigator.geolocation 断言调用参数(enableHighAccuracy true / maximumAge 0)、坐标转换断言

### 2. 测试与文档

- `server/tests/map-engine-tencent.test.mjs` 追加:定位参数断言(mock getCurrentPosition 调用 opts)、转换断言
- `tech/23-map-engines.md` 回填(仅追加):三引擎定位通道对照(AMap=浏览器高精度 / 腾讯=浏览器高精度 / 百度=SDK IP 定位,ws-b 修)
- 全量门禁见批次 README(基线 1364)

## 文件边界

- 只允许改:`server/src/lib/map-engine/tencent/tencent-engine.ts`(**仅 getCurrentPosition / browserPosition / 定位段**)、`server/tests/map-engine-tencent.test.mjs`、`tech/23-map-engines.md`(回填,仅追加)
- **不碰**:tencent-engine.ts 的 marker/icon/anchor 段(ws-c 拥有)、构造/相机段、baidu/amap 引擎、map-markers.ts、map-shell.tsx、`server/data/**`、其他 tech 文档、agent.md

## 门禁

1. `cd /Users/acccan/dm-wt-tl/server && npm test`、`npm run typecheck`
2. `cd /Users/acccan/dm-wt-tl && make docs-check`、`git diff --check`
3. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2/reports/ws-d.md`:定位参数对齐改动、测试。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
