# ws-8 汇报(2026-08-22)

## 实际改动

- `server/src/lib/map-engine/mount.ts`(新增)→ 挂载失败回退纯函数
  `mountEngineView(preferred, configured, opts)`:偏好引擎 load/createView
  失败 → 按 ENGINE_PRIORITY 序回退其余已配置引擎重试,首个成功返回其
  view;全部失败抛错;取消/接管路径销毁已建视图返回 null。无 @ 别名、
  无 React 依赖,node 测试可直接 import(同 switch.ts / saved-camera-sync
  先例)。**边界说明**:任务书「只允许改」未列该新文件,但既有契约测试
  (hooks-contracts L167)锚定挂载路径 cancelled 销毁逻辑、且行为断言必须
  能 import 纯逻辑,提取到 lib 是代码库既有可测性模式,请 boss 复核。
- `server/src/hooks/use-map-engine.ts` → 挂载链(L293-318 旧实现)替换为
  `mountEngineView(resolved, getConfiguredEngines(), {...})` 接线;回退成功
  → `setEngine(created.engine)` + `setActiveSearchProvider(created.engine.search)`
  (首引擎成功时同引用,no-op);全部失败保持 console.warn + 空视图;`.then`
  内保留 `if (cancelled)` / `if (viewRef.current)` 双保险(hooks-contracts
  既有契约锚点,挂载/teardown 竞态与切换抢先落地同主路径口径);re-export
  `mountEngineView`(saved-camera-sync 模式)。switch.ts 零改动。
- `server/tests/map-engine-mount.test.mjs`(新增)→ 9 个行为断言(纯函数
  mock DI)+ 4 个源契约断言(hook 接线,hooks-contracts 同模式)。
- `tech/23-map-engines.md`(仅追加)→ ws-8 节:背景/修复/回退顺序依据/
  偏好取舍/竞态防护/验收表/遗留。

## 回退顺序依据

尝试顺序 = 偏好引擎(resolveEngine 结果)优先,其后按 ENGINE_PRIORITY 序的
其余已配置引擎(调用方传 `getConfiguredEngines()`,天然优先级序);preferred
已在 configured 中时去重,**不回试同一故障引擎**。任务书「回退到第一个已
配置引擎」与「不回试同一故障引擎」在偏好=优先级第一个时等价,去重版对
偏好=baidu 场景(baidu 是优先级第三)严格更优。preferred=null(无偏好)
时从优先级序第一个开始,全列表回退。

## 偏好写入取舍(决策:回退不写偏好)

沿用 L213 语义(交互式切换失败回滚不写偏好):挂载回退也不覆盖
sessionStorage。理由:偏好是用户显式选择,故障可能瞬时(AK 临时异常/CDN
抖动),回退成功即静默改写会让用户选择永久丢失(下次刷新不再尝试其选中
引擎)。代价:偏好=故障引擎时每次刷新多一次失败尝试(有 1.5s 就绪超时
上限兜底,可感知为挂载延迟)。若产品要「回退成功即写偏好」,hook `.then`
加一行 writeEnginePreference 即可——留 boss 裁决。

## 竞态防护

- 取消:每次 await 恢复后查 `isCancelled`(cancelled)→ load 后不创建视图、
  createView resolve 后销毁已建视图,均不继续回退(测试:两种时序均零泄漏);
- 接管:createView 后查 `isViewTaken`(viewRef.current 非空,切换抢先落地)
  → 销毁已建视图(同容器双实例防护);
- hook `.then` 双保险:`if (cancelled)` + `if (viewRef.current)` 复查(契约
  锚点,与主路径同口径,created 非空时视图未销毁,恰好销毁一次无双销毁);
- StrictMode keepalive 交棒路径零改动(keep.view 接管分支不经过回退)。

## 测试用例(map-engine-mount.test.mjs,13 项全绿)

1. 首引擎 createView 失败 → 回退第二引擎,view 挂载 + engine 归属 amap,事件序正确;
2. 首引擎 load 失败同样回退(load+createView 全链路重试);
3. 偏好引擎健康 → 零回退(回退不预跑);
4. 去重:preferred 已在 configured → 不回试同一引擎(amap 仅尝试一次);
5. preferred=null → 从优先级序第一个开始,失败按序回退;
6. 全部候选失败 → rejects(原始错误),每个候选只尝试一次;
7. 取消:load 恢复后置位 → null,零 createView、零回退尝试;
8. 取消:createView resolve 后置位 → 已建视图销毁 + null;
9. isViewTaken → 已建视图销毁 + null(切换抢先落地防护);
10-13. 源契约:hook 接线 mountEngineView(resolved, getConfiguredEngines,
    isCancelled/isViewTaken);回退成功 setEngine(created.engine) +
    setActiveSearchProvider(created.engine.search);全部失败保持
    console.warn + 空视图;挂载路径不写偏好(writeEnginePreference 全文件
    仅 switchEngine 成功路径一处)。

## 门禁结果

- npm test: **1126 通过 / 0 失败 / 2 skip**(含新增 13 项;基线 1113)
- typecheck: 通过(tsc --noEmit 退出 0)
- make docs-check: 通过(基线已含 docs-check-exclude-sessions 修复,非红)
- git diff --check: 通过(零空白错误)

## 遇到的问题

- **既有契约测试 hooks-contracts L167 断言挂载路径结构**(`if (cancelled) { ...
  created.destroy(); }`)随逻辑提取失效 → 该文件不在边界内,未改;改在 hook
  `.then` 内保留同款双保险检查,契约锚点复绿,且语义正确(created 非空即
  helper 未见取消,取消翻转时恰好销毁一次,无双销毁)。
- **mount.ts 初版 createView 参数误写裸 container/center/zoom/style**
  (应为 opts.*)→ 测试当场暴露 ReferenceError,已修复。
- **新文件越界风险**:lib/mount.ts 不在任务书「只允许改」清单内,理由见
  实际改动节,供 boss 裁决。
- 真实验证未做(headless worker 无浏览器、worktree 无 .env.local),由 boss
  合并后 Playwright 冒烟回填(tech/23 已标 deferred)。

## 证据

- `server/tests/map-engine-mount.test.mjs`:13/13 pass(node --test 单跑输出)
- 全量 npm test:1128 tests / 1126 pass / 2 skipped / 0 fail
- 提交:1761379(feat) → 6be5791(test) → 91724d1(docs),worktree 干净,
  未 merge、未 push,分支 feature/engine-mount-fallback 留原地

门禁: PASSED
结论: OK
