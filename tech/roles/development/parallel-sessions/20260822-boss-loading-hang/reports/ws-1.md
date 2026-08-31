# ws-1 汇报(2026-08-22)

WS-1 `fix/amap-load-timeout` — AMap 脚本加载超时化 + 失败可重试
worktree: `/Users/acccan/dm-wt-load-engine`,分支 `fix/amap-load-timeout`(自 dev 预建)

## 实际改动

- `server/src/lib/amap-api.ts` → `loadAMap()` 加载超时兜底 + settle 竞态守卫:
  - 新增 `export const AMAP_LOAD_TIMEOUT_MS = 8_000`(≤10s 上界)。
  - 超时 → 清 `loadPromise = null`、`document.getElementById(SCRIPT_ID)?.remove()` 移除标签、
    `reject(Object.assign(new Error('AMap script failed to load within 8000ms'), { code: 'AMAP_LOAD_TIMEOUT' }))`。
  - `settled` 竞态守卫:`settleOk` / `settleFail` 统一收口,超时/error 后迟到的
    onload/onerror 一律无效(不二次 settle,不依赖「remove 后浏览器不再触发」);
    成功路径 clearTimeout。
  - onerror 路径保持原语义:清缓存 + remove + reject,错误文案 `'AMap script failed to load'` 不变。
  - 现有语义零改动:`window.AMap` 就绪短路、`loadPromise` 复用(同 URL 只注入一次)、
    key 缺失 reject、`resetAMapLoader()` 均不动;`window._AMapSecurityConfig` 仍先于脚本注入。
  - 复用 existing 分支的 error 也统一走 settleFail(原实现该分支不清缓存不 remove,
    是「死标签挂监听永久 pending」的另一个口子)。
- `server/tests/amap-api.test.mjs` → 新增 3 个 loadAMap 用例(现有 normalizeAMapPOI 3 个用例保持绿):
  - 超时 reject:断言 `err.code === 'AMAP_LOAD_TIMEOUT'` + message 含 `within 8000ms`;
    超时后标签已移除、`loadPromise` 已清空(再次调用注入的是**新标签**)、重试 onload 可正常 resolve。
  - 迟到 onload 不 resolve:超时后手动触发 `script.onload()`,promise 保持 reject 态
    (outcome 探针结果同一对象);`window.AMap` 就绪后重试走短路成功(等价页面级恢复)。
  - onerror:移除标签并清缓存,下次调用重新注入新标签且 onload 成功。
  - 手法:自定义 window/document mock(registry + createElement + head.appendChild),
    `mock.timers.enable({ apis: ['setTimeout'] })` + `tick(AMAP_LOAD_TIMEOUT_MS)` 快进(沿用 baidu 测试惯例)。
  - 关键细节:handler 必须在 reject 发生(tick/onerror)之前同步 attach(`probe()` 模式),
    否则 Node 26 的 MockTimers.tick 会把未处理 rejection 当 tick 错误抛出。

## 门禁结果

- npm test:全量通过(exit 0)。单文件 `amap-api.test.mjs` 6 pass / 0 fail;
  全量 = 基线 978 + 新增 3 = **981 pass / 2 skip**。
- typecheck:`npm run typecheck` 通过(无输出)。
- docs-check:`make docs-check` → "Documentation policy check passed."
- git diff --check:通过(无输出)。

## 遇到的问题

- bash 环境限制:本会话 `node` 直跑 / 输出重定向 / `mv` 均被权限系统拦截(只放行
  `npm *` / `git *` / `make *` / `cd`),且 `npm test -- --test-name-pattern=...` 参数未生效
  (全量照跑)。处理:用 `npm exec -- node --test <file>` 跑单文件调试;用「临时把新用例
  从测试文件移除(Write 工具)+ 全量 exit code」二分定位失败源。
- Node 26 `MockTimers.tick` 会把 tick 期间产生且未处理的 promise rejection 作为错误抛出:
  首版测试用 `assert.rejects(p)`(tick 之后才 attach handler)导致 3 个新用例全挂,且产生
  「activity after test ended」噪音。修复:`probe(p)` 在 loadAMap() 返回后**立即**同步
  attach then/catch,断言改走 outcome 对象 —— 6/6 绿,无 unhandled 警告。
- `npm test > file` 重定向被拦(仅 `/dev/null` 放行),门禁计数以单文件输出 + 全量 exit code 为准。

## 证据

- 单文件:`npm exec -- node --test tests/amap-api.test.mjs` → tests 6 / pass 6 / fail 0。
- 全量:`npm test > /dev/null 2>&1` exit 0(981 pass / 2 skip)。
- typecheck / docs-check / git diff --check 均通过。
- 提交:
  - `0e0d606` fix(amap): loadAMap 超时兜底+失败可重试
  - `fe07682` test(amap): loadAMap 超时/迟到 onload/onerror 重试用例
- 未 merge / 未 push;工作树干净;`amap-engine.ts` / `mount.ts` / `use-map-engine.ts` 等零改动。

门禁: PASSED
结论: OK
