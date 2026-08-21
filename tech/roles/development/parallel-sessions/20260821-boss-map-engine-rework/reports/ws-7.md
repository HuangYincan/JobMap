# ws-7 汇报(2026-08-22)

worktree `/Users/acccan/dm-wt-rw7`(branch `feature/engine-baidu-ready`,基线 f89b87d)。分支 tip `0ea2439`,2 个 commit。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts` → createView 加就绪等待 + 超时抛错:
  - 新增 `BAIDU_MAP_READY_TIMEOUT_MS = 1500`(与腾讯同量级);
  - 新增 `waitForMapReady(map)`:就绪信号**双通道**——`setMapReadyCallback`(BMapGL 2.0 官方就绪回调,存在即优先注册)+ `tilesloaded` 事件兜底(`EVENT_MAP.complete` 同源),任一先到即就绪;双通道防 SDK 单通道异常(回调注册了但永不触发)误判回滚;事件系统/回调通道均不可用 → 立即放行(不阻塞 mock/异常形态);就绪/超时均解绑 tilesloaded 监听;
  - 超时 → `map.destroy()` 销毁未渲染的 Map(容器交还回滚视图)后抛「BMapGL 地图就绪超时(1500ms)」——switch.ts:181-206 既有回滚契约直接生效,**switch.ts 零改动**;
  - **相机时序**:就绪信号到达后才应用 centerAndZoom/setTilt/setHeading/setStyle(创建后立即 centerAndZoom 会被异步初始化重置丢失相机;正常 AK 下 tilesloaded 数十 ms 内触发,延迟不可感知);
  - `BMapInstance` 类型面追加可选 `setMapReadyCallback?(cb)`。
- `server/tests/map-engine-baidu.test.mjs` → 新增 3 用例(46/46):
  - 就绪等待:tilesloaded 触发后才返回;就绪前相机未应用(防重置);就绪后相机/样式保持;监听解绑;
  - 超时抛错:mock.timers 快进 1.4s 仍挂起 → 1.5s 抛「BMapGL 地图就绪超时」+ Map 已销毁 + 监听解绑;
  - setMapReadyCallback 优先:存在时注册回调,回调触发即就绪;回调永不触发 → 1.5s 超时抛错同契约;
  - FakeMap 构造后 ~10ms 自动触发 tilesloaded(模拟 BMapGL 异步渲染);removeEventListener 空列表删 key(与 tencent MockView 语义一致);captures 增加 `maps`。
- `server/tests/map-engine-lifecycle.test.mjs` → 共享 RawMap 构造后追加触发 `tilesloaded`(与既有 `idle` 同款;ws-5 先例:tencent 就绪等 idle 时即如此适配)。
  ⚠️ **边界说明**:该文件不在任务书「只允许改」三文件清单内(也不在「不碰」清单)——不改则全量 npm test 必红(baidu 就绪等待在共享 mock 上 1.5s 超时),与任务书「以 mock 测试为验收主依据」矛盾;按 ws-5 对 tencent idle 的同一先例做最小 mock 适配,零生产代码影响。需 boss 知悉/追认。
- `tech/23-map-engines.md` → 追加「ws-7 就绪等待与超时回填」节(仅追加,47 行):诊断(根因 + 与腾讯超时模式的**有意差异**:腾讯超时兜底放行、百度超时抛错回滚)、修复、验收表、遗留(离线无法核实 getscript v=1.0 是否含 setMapReadyCallback,双通道防御兜住,真机由 boss 冒烟坐实)。

## 门禁结果

- npm test: **1107 通过 / 2 skip / 0 失败**(baseline 为 1104,新增 3)
- typecheck: 通过
- docs-check: **失败(基线红,零新增违例)**——既有 `20260821-boss-agent-thinkfix/merge-report.md:20` 复述 grep 正则自匹配(先于本批并入 dev);本批追加内容不含任何违例模式(`docs/roles/|docs/zh-cn/|预计发布时间|BOSS.*MVP.*爬|小红书` 逐一核对)
- git diff --check: 通过

## 遇到的问题

1. **map-engine-lifecycle.test.mjs 共享 mock 不触发 tilesloaded** → baidu 就绪等待在其上 1.5s 超时抛错,2 用例失败(全量 npm test 红)。处理:按 ws-5 对 tencent idle 的同一先例,在 RawMap 构造后追加触发 `tilesloaded`(测试文件最小改动)。**越边界说明见上**,请 boss 追认。
2. **FakeMap 监听簿记**:removeEventListener 留空 key,`listeners.size` 误报 1 → mock 改为空列表删 key(与 tencent MockView 语义对齐),非引擎问题。
3. **未处理拒绝噪音**:超时测试的派生 promise(`p.then`)不带拒绝分支 → node:test 报 unhandledRejection → 测试改为 then 双分支。
4. **setMapReadyCallback 是否存在于 getscript v=1.0 无法离线核实**(官方标注 BMapGL 2.0 API)→ 双通道防御实现(存在即优先),真机行为由 boss 合并后 Playwright 冒烟坐实。

## 证据

- `cd server && node --test tests/map-engine-baidu.test.mjs` → 46 pass / 0 fail(新增 3 用例标题含「就绪等待」「1.5s 超时抛」「setMapReadyCallback」)
- `cd server && npm test` → `tests 1109 / pass 1107 / fail 0 / skipped 2`
- `npm run typecheck` → 零输出退出 0
- `make docs-check` → 仅既有 thinkfix 自匹配两行(见门禁节),本批零新增
- `git diff --check` → 零输出
- commit:`632e392` fix(engine) + `0ea2439` docs(map-engines);`git status --short` 干净

门禁: FAILED
结论: OK
