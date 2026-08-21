# Batch Manifest — 20260821-boss-map-engine-rework

## 目标(用户 goal 2026-08-21)

**完善三大服务商(高德/腾讯/百度)切换功能;尊重厂商实现细节差异,遵循「一切皆插件」;若确实实现不了则删除该功能。** 用户已授权深度重构(「当这些代码是傻子写的,自己做好重构与优化」)。

## 根因(两个诊断 agent 已坐实,带 file:line)

1. **POI 控制器绕过契约包装直操厂商裸实例**(map-markers.ts:462 `marker = wrapper.raw`),随后用 AMap 专属 API(`setzIndex` 小写/`setIcon`/`setOffset`/`new Icon/Size/Pixel`/`.on`/`setMap(null)`/`show()hide()`)打裸实例 → TMap marker 全灭、Baidu marker 脱管泄漏 → **「非高德 POI 消失」直接机制**
2. **破坏性切换无回滚**(switch.ts:121 `from.destroy()` 先于目标创建;失败即死态)
3. **切换重入被静默丢弃**(use-map-engine.ts:139 + layers-panel 双保险)→「不能来回切换」
4. **TMap idle 3s 超时固定成本**(tencent-engine.ts:137-164)+ idle 不触发(瓦片失败)时每次切换冻结 →「卡死」
5. **vendor z-index 逃逸**:`.mapCanvas` 无 stacking context(map-shell.module.css:41-46)+ Baidu 零控件防御 + TMap 控件防御时序错误(disableDefaultControls 在初始化前空转 tencent-engine.ts:679-680)→「层级过高」
6. **domain 关键词回退硬绑 amap-api**(poi-service.ts:154)
7. **切换后 POI 重建靠隐式 setState 链**(use-poi-map 的 view 是 ref 值,map-shell.tsx:1538)
8. **baidu 聚合徽章泄漏**(map-shell.tsx:1343 `setMap(null)`)
9. **挂载 createView 与切换竞态**(use-map-engine.ts:242-258 双实例/泄漏)

**决策:重构,不删功能**(根因是适配层被绕过,非厂商差异不可控;修复后三引擎行为一致可达)。

## Workstreams(文件边界互不相交)

| ws | 分支 | worktree | 主题 | 轮次 |
|---|---|---|---|---|
| 1 | feature/poi-contract | /Users/acccan/dm-wt-rw1 | 契约扩展(types)+ 三引擎适配层补齐 | 轮1 |
| 2 | feature/poi-controller | /Users/acccan/dm-wt-rw2 | map-markers 控制器引擎无关化 | 轮2 |
| 3 | feature/engine-switch-lifecycle | /Users/acccan/dm-wt-rw3 | 切换生命周期(两阶段+重入+view state 化) | 轮2 |
| 4 | feature/engine-zindex | /Users/acccan/dm-wt-rw4 | 层级隔离 + 控件防御 + TMap 超时 | 轮2 |
| 5 | feature/engine-search-cleanup | /Users/acccan/dm-wt-rw5 | domain 搜索引擎化 + 聚合徽章清理 + 收尾 | 轮3 |

## 派发轮次与合并顺序

```
轮1: ws-1(契约先行,其余依赖) → 合并
轮2: ws-2、ws-3、ws-4 并行(均依赖轮1,文件不相交) → 合并 2→3→4
轮3: ws-5(依赖轮2 的 map-shell 形态) → 合并
每轮 push origin/dev(门禁绿即自动)
```

## 门禁(每 WS、每轮合并)

- `cd <worktree>/server && npm test`(基线 1034:1032 pass/2 skip,零漂移)+ `npm run typecheck`
- `cd <worktree> && make docs-check`(**注意:docs-check 现为基线红**——其他会话批次文件自匹配 grep 正则,与本批次无关;ws 需确认自己的改动零触发,基线红如实报告)+ `git diff --check`
- 契约测试:map-markers 不得出现 `wrapper.raw` 直操/AMap 专属 API(ws-2 完成断言)

## 冲突防护

- 不碰:`tech/01-architecture.md`、`tech/03-plugin-system.md`、`tech/06-decisions.md`、`agent.md`(docs-maintenance 活跃)、`server/data/**`、qqdoc 文件
- map-shell.tsx 与其他会话并行改动(agent 批次等)——各 ws 只动自己授权的行段,合并冲突显式解决
- 批次目录自身完成后入库 commit(既有模式)
