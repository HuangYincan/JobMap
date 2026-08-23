# ws-1 汇报(2026-08-22)

## 实际改动(worktree `/Users/acccan/dm-wt-saved-layer-toggle`,分支 `fix/saved-layer-toggle`,2 commits:4c59191 + ccf932b)

- `server/src/lib/saved-camera-sync.ts`(新增)→ 收藏相机同步状态机纯函数:`SavedCameraSync` 接口、`cameraAtDestination`(250m 容差判定「相机在目标中心」)、`consumeSavedCameraSync`(消费 settle 事件,返回下一状态)。只依赖 `./types.ts`(无 `@` 别名,node 测试可直接 import)。
- `server/src/hooks/use-saved-layer.ts` → toggle 打开分支:删除 `suppressViewportRefreshUntilRef.current = Date.now() + VIEWPORT_SUPPRESS_MS` 时间窗写入;改为在 `map.setBounds` **之前**置位 `savedCameraSyncRef.current = { destCenter: 收藏点外接框中点, consumed: 0 }`(且只在真正发生 setBounds 时置位——无相机移动不置位,修掉了旧实现「无移动也开窗误伤下一次用户刷新」的隐患)。
- `server/src/hooks/use-work-viewport.ts` → 删除 `VIEWPORT_SUPPRESS_MS` 常量与时间窗检查;`onViewChange` 改为消费同步状态机:同步期内跳过 `loader.schedule()`,以事件到达时相机是否在目标中心判定归属(慢动画/迟到事件不逃逸),相机离开目标或消费满事件对后自动结束。**空批次不再置空 catalog**:`onBatch` 空批次分支从「catalogCoversView 判定 → 真空清空」简化为「一律保留旧目录」(保留 marker 池实例,b2「只增不删、跨视口保留」语义;目录只在真正搜索/非空批次时重建)。`catalogCoversView` 从本文件 import 移除(主加载路径 map-shell 仍用)。
- `server/src/components/map-shell.tsx` → ref 声明换为 `savedCameraSyncRef = useRef<SavedCameraSync | null>(null)`;接线传入 `useWorkViewport` / `useSavedLayer`(同一实例);`syncView` 在同步期内**冻结 distance 圆心 mapCenter**(根因 #2),相机离开目标即结束同步恢复跟随;`mapBounds` 照常更新(视野本身是真实移动)。
- `server/tests/component-contracts.test.mjs` / `hooks-contracts.test.mjs` → 契约断言从时间窗改为状态机(置位先于 setBounds、consume→return→schedule 顺序、空批次保留、时间窗符号不存在、lib 定义 + hook 再导出)。
- `server/tests/saved-layer-sync.test.mjs`(新增回归)→ 见「证据」。

## 根因 #1 修复方式 + 为何是结构性的

主因是「toggle 的 setBounds 程序化相机移动 → settle 事件触发视口刷新 → 空批次置空 catalog → markerPois 坍缩 → controller.clear() 只删不建」。旧修复(500ms 时间窗)是**时间常数补丁**:动画 >500ms 或腾讯 `idle`(底层 moveend/zoomend 后 300ms debounce)叠加后,事件到达窗口外即逃逸,清空链路照旧。

结构性修复 = 事件/状态语义,无任何时间常数:
1. **同步状态机**(lib/saved-camera-sync.ts):setBounds 前置位目标中心,settle 事件到达时以「相机是否位于目标中心」判定事件归属——事件迟到多久都正确归类为程序化移动,吞掉;相机离开目标(用户接管)或消费满事件对(moveend+zoomend;腾讯单 idle 由 `consumed` 兜底,下一次事件即结束)后自动结束,不残留、不误伤后续用户刷新。
2. **空批次 ≠ 无数据**(c):视口空批次不再把 catalog 置空——即使有事件漏出,空批次也不会销毁 marker 池;真空清空语义只保留在主加载路径(真实搜索/刷新的空结果仍显示空态,行为不变)。

验证:回归测试证明「打开收藏 → 动画期间任何事件(含迟到)→ schedule 不被调用 → catalog 不被清空;关闭后用户移动 → 刷新恢复正常」。

## 根因 #2 判定(work 模式):修了

判定为真且同类(程序化移动污染视图派生状态):`distanceOrigin = mapCenter`,syncView 在 moveend 更新 mapCenter;toggle 后圆心变收藏区域中心,带 distance 筛选的 work 模式把 radius 外 pin 整批裁掉,且 toggle OFF 不回移相机 → 用户卡在收藏区域、地图持续空。修复:`syncView` 同步期内冻结 mapCenter(distance 圆心),相机离开目标即恢复跟随。`mapBounds` 不冻结(视野本身确实变了,work 列表按视野裁剪是既有语义)。

## 根因 #3 判定(dev 专属):记录,不修

Layers 面板 dynamic import → disconnect/reconnect 链路:disconnect 时 `setView(null)` → usePOIMap 销毁控制器摘全部 marker,重连后 keepalive 链接管回放。该链路已被既有 keepalive 链(use-map-engine.ts:243-282)处理,只在 dev StrictMode double-invoke 下出现且自愈(生产无此路径);不是本 bug 的触发源(用户报告的是真实使用中 toggle 后消失)。dev-only + 自愈,不做改动,记录备查。

## 遇到的问题

- **docs-check 红(dev 既有,非本批,需 boss 裁决)**:`tech/roles/development/parallel-sessions/20260821-boss-{tencent-geocode,agent-thinkfix}/merge-report.md` 复述 grep 正则本身(`docs/roles/` 等)造成自匹配,早已并入 dev(前批 merge-report 已注明「docs-check 已知红(非本批)」)。本批零 `.md` 改动(实测 grep 命中仅上述 2 个旧文件,均为 dev 既有提交,非本分支引入)。按门禁规则「任一失败 → FAILED」如实上报;修复超出本批文件边界(需改 tech/ 下旧 merge-report),建议 boss:派 docs 修复批次,或给 docs-check 加 `--exclude-dir=parallel-sessions`。
- 测试运行器(node --test)无法解析 `@/` 路径别名 → 状态机纯函数抽到 `lib/saved-camera-sync.ts`(无别名依赖),hook 再导出;契约测试相应断言 lib 定义 + hook 再导出。
- 两处旧契约断言(component-contracts `doesNotMatch(if (batch.length===0) return;)`、hooks-contracts `VIEWPORT_SUPPRESS_MS=500`)与结构性修复冲突,已按新语义更新(见实际改动)。

## 证据

- `npm test`:**1102 pass / 0 fail**(新增 6 个回归测试全绿;基线 1094 + 8 变更)。
- `npm run typecheck`:通过(tsc --noEmit 0 错误)。
- `git diff --check`:通过。
- `make docs-check`:红——仅因 dev 既有 2 个旧 merge-report 自匹配 grep 正则(见「遇到的问题」);本批零 `.md` 改动,实测 grep 命中与改动前完全一致。
- 新增回归 `tests/saved-layer-sync.test.mjs`:
  - `cameraAtDestination` 几何判定(250m 容差,无时间语义);
  - `consumeSavedCameraSync` 事件对消费(1 次保持/2 次结束)、离开目标立即结束、快照缺失不残留;
  - 回归场景:打开收藏 → moveend+zoomend(含 3 秒后迟到的)→ schedule 恒为 0(catalog 不被清空);用户移动 → 恢复正常刷新;
  - 单事件引擎(Tencent idle)残留只吞下一次事件;
  - 根因 #2 回归:同步期内圆心冻结,离开后恢复跟随。
- 复现序列(修复前):登录 + 收藏若干点 → domain 模式带搜索词 → 点 Layers → 开关收藏图层 → 动画 >500ms(或腾讯引擎)→ POI 全部消失。修复后:任意引擎/任意动画时长,开关收藏 POI 不消失。

门禁: FAILED(docs-check 因 dev 既有 2 个旧 merge-report 自匹配而红,非本批引入;npm test 1102/0、typecheck、git diff --check、新增回归测试全绿)
结论: BLOCKED: docs-check 红为 dev 既有(20260821 两批 merge-report 自匹配 grep 正则),本批零 .md 改动无法在其内修复,需 boss 裁决(派 docs 修复批次或给 docs-check 加 --exclude-dir=parallel-sessions)
