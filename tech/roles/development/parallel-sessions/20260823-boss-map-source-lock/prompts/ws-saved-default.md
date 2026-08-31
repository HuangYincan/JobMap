# WS: ws-saved-default — 收藏图层默认改为不开启

> 本 prompt 由 boss 生成。worktree 已预建(下面绝对路径),**不要 merge / push / 建分支**,
> 完成后把汇报写到批次目录(绝对路径)。

## 背景

用户决策(2026-08-23):**默认不开收藏图层。**
当前实现:进入应用时收藏图层默认开启(useState(true)),挂载后读 sessionStorage
偏好 `domain-map:saved-overlay` 覆盖。

目标口径:首次渲染默认**关**;挂载后读偏好——显式开过的用户('1')保持开,
未存过 / 显式关('0')的用户保持关。即「默认值翻转为 false,显式偏好仍尊重」。

## 任务(worktree 内绝对路径)

1. `server/src/hooks/use-saved-layer.ts`
   - 第 46 行 `const [savedOverlay, setSavedOverlay] = useState(true);` → `useState(false)`
   - 第 50 行 `setSavedOverlay(readSavedOverlayPref(true));` → `readSavedOverlayPref(false)`
   - 顺带更新文件头部注释中关于默认值的描述(若有),注明 2026-08-23 用户决策。
2. `server/tests/hooks-contracts.test.mjs`
   - 第 105 行契约断言 `readSavedOverlayPref\(true\)` 需同步为 `readSavedOverlayPref\(false\)`。
3. 全面复查(你负责,不限于下列):
   - grep `useSavedLayer|savedOverlay|readSavedOverlayPref` 全部消费方,确认
     没有其他地方硬编码默认 true(如 map-shell 初始化、layers-panel prop 兜底、移动端抽屉);
   - 检查 `server/tests/` 中 saved-layer-* / saved-overlay / component-contracts /
     hooks-contracts 是否有断言「默认开」的行为(除上述 105 行外);
   - `readSavedOverlayPref(fallback=false)` 语义:raw 无/无效 → false;'0' → false;'1' → true。
     不需要改 saved-overlay.ts 本体,除非复查发现默认值另有入口;
   - 检查 tech/ 文档 / agent.md 是否有「收藏图层默认开启」的描述需同步
     (文档契约,make docs-check 必须过)。
4. 门禁全跑(见下)。

## 文件边界

- 可改:`use-saved-layer.ts`(默认值 + 注释)、`hooks-contracts.test.mjs`(105 行附近断言)、
  其他**经你复查确认必须同步**的测试/文档(在汇报「遇到的问题」段说明)。
- 不可改:`saved-overlay.ts` 纯函数、`map-shell.tsx` 接线、`layers-panel.tsx`、
  `use-map-engine.ts`、`engine-registry.ts`。
- 不碰主树 `/Users/acccan/domain-map/` 下任何文件(汇报除外)。

## 门禁(全绿才算 PASSED)

```bash
cd /Users/acccan/dm-wt-saved-default/server && npm test        # 1487 全量,须全绿(0 fail,skip 允许)
cd /Users/acccan/dm-wt-saved-default/server && npm run typecheck
cd /Users/acccan/dm-wt-saved-default && make docs-check && git diff --check
```

## 提交

- Conventional Commits:`fix(saved-layer): 收藏图层默认不开启(useState/readSavedOverlayPref false)`,
  测试断言同步可并入同一 commit。
- 提交前 `git status` 确认改动仅限边界内文件。

## 汇报

写到 **`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260823-boss-map-source-lock/reports/ws-saved-default.md`**:
- 做了什么(文件:行 + 一句话)
- 复查结论(默认值消费方清单、测试影响面)
- 「遇到的问题」段(若有)
- **末两行必须精确**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
