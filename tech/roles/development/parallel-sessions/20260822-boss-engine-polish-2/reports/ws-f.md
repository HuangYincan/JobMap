# ws-f 汇报(2026-08-22)

分支 `fix/baidu-r3`(worktree `/Users/acccan/dm-wt-br3`),基于 `9e693a9`。
3 个 commit:`b43196c`(引擎修复)、`ba5a061`(测试重写)、`712ea4d`(docs 回填)。

## 实际改动

- `server/src/lib/map-engine/baidu/baidu-engine.ts`
  - **删除自定义 Overlay 主路径**(ws-pinfix2)——真机坐实为**静默失效路径**:
    `Map.addOverlay` 只调 `overlay._i(map)`(getscript 源码),Overlay 基类 `_i`
    把 `initialize(map)` 返回值存入 `this.domElement` 后**不挂载任何 pane**
    (经典 BMap「initialize 返回 div、SDK 自动挂载」契约在 GL v1.0 不成立)。
    引擎 Overlay 子类实测:initialize 被调、div 已定位,parentNode 恒 null →
    boss「标记全部消失」(0 徽章 + 0 聚合图标)实锤根因;1049 个 addOverlay 全
    静默失效 + SDK 长期持有无主 div(badge HTML/img)引用 → 内存膨胀(JS heap
    139→218MB 实测)+ 低 zoom 合成器负载(截图 3.5-4.5s,接近超时)
  - `createContentMarker` 重写为**厂商 Marker + 点击目标 DOM 注入主路径**:
    有 setContent(测试 mock/未来 SDK)→ 直调;无 setContent(真实 SDK)→ content
    HTML 注入 `BMap_Marker` 点击目标 DOM(addOverlay **同步创建**,实测 ms 级;
    位置 = 屏幕位 + 契约 offset 由空白 1×1 锚点图标 anchor=-offset 驱动);
    content+icon 并存(聚合徽章)→ **icon 为渲染主机制、content 不注入**
    (dataURL 图标纹理即视觉,防双渲染;远程 icon 未预检回落注入,预检 ok 后
    下次重建升级);点击 = 子元素冒泡到厂商 DOM → marker click
  - **注入重试零定时器**:ws-e 版 20×50ms `setInterval` 轮询删除(渲染卡死嫌疑),
    改**同步 + 微任务 4 轮 + rAF 5 帧**有界重试(实测同步就绪,重试纯防御);
    `createContentFallbackMarker`/`baiduOverlayProjectWarned`/Overlay draw 依赖
    一并删除
- `server/tests/map-engine-baidu.test.mjs`(重写 6 用例,83/83 通过)
  - DOM overlay 路径 5 用例 → 厂商 Marker + 注入语义:锚点 anchor=-offset 契约
    (图钉/徽章/蓝点/无 offset 四形态)、triggerClickFromDom 冒泡点击、on/off、
    setPosition→bd09、setContent 重入、setZIndex/setVisible、wrapper.remove
    摘除分派、有 setContent 直调路径、无定位 API 零依赖零告警
  - content+icon:icon 渲染主机制、content 不注入(防双渲染)、远程 icon 参与
    预检(未预检 → 空白锚点 + 注入回落;预检 ok → 真图标)、dataURL 恒可用
  - 延迟就绪重试:伪造 rAF 双面断言微任务+rAF 有界注入(零定时器)
- `tech/23-map-engines.md`(仅追加 `ws-f r3 回填` 一节,52 行)

## 门禁结果

- npm test: **1419 通过 / 0 失败 / 2 skip**(ws-e 报告中的 2 个数据域基线失败已由
  后续 geocode r5 提交修复,当前全绿)
- typecheck: 通过;docs-check: 通过;git diff --check: 干净

## 遇到的问题

1. **「截图持续超时」未 100% 复现,但负载证据与修复目标一致**:本 WS 复现时
   截图在 z8-10 需 3.5-4.5s(z12+ 0.1s),滚轮可用(与 boss 的完全卡死有环境差:
   真机 headed + 长会话合成器状态不同)。两个卡死嫌疑均已被修复消除:
   (a) Overlay 路径 1049 个无主 div + badge img 泄漏(内存 + 合成器压力);
   (b) ws-e 版 setInterval 轮询注入(每 marker 20×50ms 定时器)。修复后全级别
   截图 0.1-0.5s、滚轮全级别响应、固定 zoom 下无 marker 增长循环。若 boss 仍
   可复现卡死,建议在长会话/多引擎切换场景复测。
2. **worktree dev server 基建**:Turbopack 拒绝跨树 node_modules symlink →
   webpack 模式又被 markdown-text.module.css 的 `:global()` pure 校验挡住 →
   用 `cp -al`(硬链接)把主树 node_modules 复制进 worktree 后 Turbopack 正常
   (本地未跟踪改动,git 零影响)。dev server 运行于 **http://localhost:3100**
   (worktree `.env.local` 从主树复制,gitignored),供 boss 直接验证。
3. 聚合徽章 DOM 侧 `.dm-cluster` = 0 属**新设计语义**:聚合徽章(content+icon
   双传)改走 icon 纹理渲染(防双渲染),视觉在 GL 纹理层,不在 DOM —— 以
   marker 实例 + 像素证据验收(z8 蓝徽章元素遍布全国视野,135 个聚合 marker
   可见,个体 pin 隐藏互斥)。

## 证据

- 根因(真机 + 真实 SDK,headed Chromium):
  - `B.Map.prototype.addOverlay.toString()` = `function(i){if(i&&cs(i._i)){...;
    i._i(this);...}}`(只调 `_i`,不挂载)
  - `B.Overlay.prototype._i.toString()` = `this.domElement=this.initialize(mw)`
    + draw,无 appendChild;引擎形态 overlay 实测 `initialize` 被调、div left/top
    正确、`inDom: false`(parentNode null)
  - 修复前:1049 次 addOverlay(kind=custom-overlay)、DOM `.dm-badge` 0 个;
    内存 139→218MB;z8/z10 截图 3.5-4.5s
- 修复后验收(同环境):
  - z13 单点级:1048 `.dm-badge` 全部可见;badge 真实点击 → POI 详情面板 +
    `.dm-badge-selected`;setContent 重入更新 DOM
  - z≤8 聚合级:135 聚合 marker 可见(GL dataURL icon 纹理),1048 个体 pin
    setVisible(false) 隐藏(互斥正确);回 z13 个体恢复可见
  - zoom 6→16 全级别:截图 0.1-0.5s(z9 峰值 0.88s = 瓦片加载;修复前 3.5-4.5s),
    滚轮全级别响应(6.4/8.4/…/16.4),console 零报错
  - 样式:标准/卫星/深色/回标准全通过(深色 rgb 230→110 变暗;ws-e 卫星→深色
    先切 vector 修复保持),切换后徽章仍在
  - 固定 zoom 20s+ 无 marker 增长;zoom 分桶切换 addOverlay 增量有界(≤135)
- 测试:`node --test tests/map-engine-baidu.test.mjs` 83 pass / 0 fail;
  `npm test` 1419 pass / 0 fail / 2 skip;`npm run typecheck` 零错误;
  `make docs-check` passed;`git diff --check` 干净
- git log:`b43196c fix(baidu): Overlay 主路径在真实 SDK 静默失效…` /
  `ba5a061 test(baidu): r3 主路径断言重写…` / `712ea4d docs: tech/23 ws-f r3 回填…`

门禁: PASSED
结论: OK

---

# ws-f r4 续作汇报(2026-08-22,主树复验失败 → 定时器兜底修复)

分支 `fix/baidu-r4`(worktree `/Users/acccan/dm-wt-br4`,基于 dev HEAD `692324a`
含 agent-inputbar 合并;原 dm-wt-br3 已被 merger 清理,worktree 重建)。
3 个 commit:`c3776fb`(引擎)、`5b7b04f`(测试)、`bf1dd7c`(docs)。

## 主树复验失败定位(dev server :3000,Playwright)

- boss 复验证据:136 条注入超时警告 + `.dm-badge` = 0 + 页面交互正常(无卡死)。
  我侧复现:主树全新会话/缓存重载/4×-12× CPU 节流均**通过**(0 警告 + 徽章渲染,
  与 worktree 验收一致)——常规时序 domElement 由 addOverlay 同步/数帧创建。
- **真机 8× 节流 + 缓存重载坐实根因**:addOverlay 后 domElement 迟至 **1-10s**
  才创建(400/400 marker),期间 **rAF 帧回调停摆**(r3 链既不注入也不告警 →
  静默悬挂);应用侧 setContent(状态变化)只是偶然救援,状态不变时不触发 →
  boss 场景(缓存数据快 + MCP 长会话重负载)即「5 帧窗口耗尽 → 警告 + 徽章
  永久缺失」。注入链不依赖 rAF 帧调度 + 窗口覆盖迟到量级是必要条件。

## 修复(baidu-engine.ts r4)

- 注入链 = 同步 + 微任务 4 轮 + **rAF 3 帧快路径** + **定时器兜底**(首 tick
  100ms 后 250ms 步进,80 tick ≈ 20s,自终止;内容不变不重写零抖动);
- `pendingContentInjection` 登记表:注入成功 / wrapper.remove 摘除 / 链耗尽
  即摘除;重试链**先查登记再注入**(修掉「已摘除 marker 仍被写入」的顺序缺陷);
- 超时警告降为 20s 全失败后一次性输出(正常时序零噪音);
- 定时器频率远低于 ws-e 版(50ms→250ms)且无 Overlay 无主 DOM 拖累(r3 已
  消除)→ 不构成渲染负担(主树 r3 已无卡死,boss「页面交互正常」佐证)。

## 门禁结果

- npm test: **1427 通过 / 0 失败 / 2 skip**(baidu 85/85)
- typecheck / docs-check / git diff --check: 通过

## 验证(r4 worktree :3100,真机 Chromium + 真实 AK)

- 全新会话:1048 徽章 / 0 警告;缓存重载 + 8× 节流:400 徽章 / 0 警告
  (domElement 迟至 2s 的 marker 由定时器兜底注入)
- 回归(r3 验收矩阵全过):z≤8 聚合徽章、z>8 单点 1048 徽章、badge 点击 →
  POI 详情 + 选中态、滚轮缩放、标准/卫星/深色切换、截图 0.1s 级、零报错
- 测试:定时器兜底注入(无 rAF 环境 = node)/ rAF 快路径 / remove 终止链三用例

## 遇到的问题

1. 主树 136 警告场景未能 100% 复现(需「缓存数据快 + 渲染慢 + 无状态变化」
   三条件同时成立;我侧节流下 setContent 救援偶发介入)——但 rAF 停摆 +
   domElement 迟到的机制已被真机坐实,定时器兜底为该机制的直接修复,单元
   测试在无 rAF 环境确定性验证注入成功。
2. 原 worktree `/Users/acccan/dm-wt-br3` 已被 merger 清理,本次在重建的
   `/Users/acccan/dm-wt-br4` 续作(r4 基于 dev HEAD,含 agent-inputbar)。

门禁: PASSED
结论: OK
