# ws-i 汇报(2026-08-23,修订版)

分支 `fix/tmap-badge-overlap`(worktree `/Users/acccan/dm-wt-tov`,基于 dev `58bc838`)。
共 6 个 commit(自上而下):
- `c16e0d5`(docs 修订)、`441231a`(初始渲染竞态修复 + 根因修正)
- `cd27acd`(构造后 setMap 挂图)、`f14e289`(测试)、`26e7673`(预检链式推进)、`ff2e5ce`(tech/23 回填)

> 幂等恢复:上轮中断会话已留 4 个 commit;本会话二次审查 + 补做任务 C 真机
> 验收,实测推翻上轮「level=4 被标注遮挡」根因推断,完成修订(见下)。

## 混合块/渲染问题根因(本会话实测修正)

**上轮推断「构造传 map → layer level=4 → 被底图文字标注遮挡」不成立**:
- SDK v1.8.0.2 实包源码:GeometryOverlay 构造器先 `_setGeometryType()`(置
  `_layerType="MARKER"`)再 `e.map ? i.setMap(e.map)` → `_createLayer` 时
  type 恒为 marker → **构造传 map 与构造后 setMap 的 layer.level 都是 7
  (OVERLAY_NAA)**,页面内双形态实验均验证 level 7 / rank 70020;
- layerResource 实测排序:`vector_top_poi`(文字标注)rank 60000 < MARKER
  层 70020 → 徽章恒在标注之上,「文字盖徽章」不存在;
- **真正问题 = 初始渲染竞态**:`geometry_changed → _createLayer 重建 layer
  + redraw` 链在页面初始(地图 idle/渲染管线未稳)可能整体错过 → 首帧
  0 徽章(layer.sourceData 快照停留在创建时 1 个 geometry,而 geojson
  source 内已是全量 400);实测 reload 后 0/15 徽章随机;一次缩放/平移
  (LOD 摘挂)或任意数据变化(add/setGeometries)后全部渲染;
- 修复(441231a,tencent-engine.ts):共享实例挂图后 `setTimeout(0)` 一次
  **全量 `setGeometries(geometries.slice())`** 重推(宏任务让同步批量 add
  先完成;SDK guard 引用相同数组直接返回,必须传副本;老 SDK 无
  setGeometries → 跳过,用户交互兜底)。

## 实际改动

- `server/src/lib/map-engine/tencent/tencent-engine.ts`
  - 保留:构造不传 map + 构造后 setMap(形态收敛,destroy setMap(null) 对称);
  - 新增:`setTimeout(0)` 全量 setGeometries 重推(初始渲染竞态修复);
  - 注释重写:根因按实测修正(level 恒 7、标注层排序、竞态机制),不再写
    未证实结论。
- `server/tests/map-engine-tencent.test.mjs`
  - 构造顺序断言更新:补「setGeometries 全量重推(副本)」断言;断言消息
    按实测措辞修正(不再声称 level=4)。
- `tech/23-map-engines.md`
  - 追加「§5 修订」:根因修正 + 竞态机制 + 修复 + 真机验收结果(仅追加)。
- `server/src/lib/map-markers.ts`(上轮 26e7673,链式预检)
  - `resolveTMapIconSrc` 只 push 候选链第一个 unknown(logoUrl 优先);
    失败记忆化后下次重建推进下一候选;纯函数契约与调用方不变。

## 真机验收(本会话完成,worktree :3100 webpack + headless Chrome CDP)

- **腾讯初始渲染**:连续 5/5 全新 reload,徽章全部渲染(13-15 个完整
  40×40);修复前同法多次复现 0 徽章态(07/11/17 截图);零 34×14 扁块
  (boss 的「混合块」形态未出现;视口底部边缘裁剪为正常地图行为);
- **点击弹卡**:点击徽章 → POI 详情卡弹出(「代塔供应链 · 1 在招岗位 ·
  上城区九盛路…」),关闭按钮正常;
- **缩放/pan**:zoom ±、drag 后徽章保持完整(4 个全尺寸 + 边缘裁剪 1),
  无中部混合块;
- **层级实测**:layer level 7 / rank 70020,layerResource 排序在文字标注
  层(60000)之上;
- **console errors**:首会话 360 行 = 180 唯一 favicon.im URL × 2 行,
  **每 POI 仅预检候选链第一个**(链式语义达成;修复前整链 ~8 URL/POI);
  绝对行数 = 2 × 活跃 POI 数(当前工作模式 catalog 180+ POI,远大于
  boss 实测时的 24 → 高于 ≤50 行预估,属数据规模差异非修复失效);
  **第二会话(记忆化)0 行**;
- **AMap/Baidu 零回归**:AMap 13 个完整徽章 0 错误、Baidu 20 个完整徽章
  0 错误。

## 门禁结果

- npm test: 1461 通过 / 0 失败 / 2 skip(1463 total)
- npm run typecheck: 通过
- make docs-check: 通过(§5 追加后复跑)
- git diff --check: 通过

## 遇到的问题

1. **上轮根因推断被真机实测推翻**(构造时序 → level=4):本会话下载 SDK
   实包(map.qq.com/api/gljs,v1.8.0.2)逐段核实构造链 + 页面内双形态
   实验 → level 恒 7;混合块与「文字遮挡」无因果,真实问题为初始渲染
   竞态。已修订代码注释与 tech/23 §5,未改上轮 4 个 commit 的提交历史。
2. **首会话 errors 绝对行数超 boss ≤50 预估**:链式语义正确(每 POI 1
   个、零重复、第二会话 0),行数 = 2×活跃 POI 数;当前数据规模
   (180+ POI)与 boss 实测时(24 POI)不同。若需压行数,方向是缩小预检
   候选面(如优先 icon.horse 白名单),已记录待 boss 裁决。
3. 真机环境为 headless Chrome(SwiftShader 软件 GL),与真机 GPU 渲染
   有细微差异;徽章颜色/尺寸/层级均已像素级验证,点击/缩放/平移经
   CDP 事件验证,建议 boss 合并后按 §5 真机复核一次。

## 证据

- 截图:/tmp/ws-i-{07(reload 0 徽章复现),17(reload 0),22-try1..4(修复后
  5/5 全渲染),26(缩放后),27/28(pan 后完整),29(AMap 13),30(Baidu 20)}.png;
  关键对比:22-try1..4 每张 13+ 个 40×40 蓝簇,零扁块
- SDK 源码核实:/tmp/tmap-sdk.js(1.8.0.2)——GeometryOverlay 构造顺序、
  Jl level 公式(dn.OVERLAY_NAA=7)、layerResource rank 排序、setMap/
  _bindEventHandler 链
- 页面内实验:构造双形态 level/rank 对比、setGeometries 重推恢复渲染、
  add 触发链、layerResource 5 层排序(标注 60000 < MARKER 70020)
- 测试输出:`tests 1463 / pass 1461 / fail 0 / skipped 2`;typecheck /
  docs-check / diff-check 零告警
- 文件边界:仅 tencent-engine.ts / map-engine-tencent.test.mjs /
  tech/23-map-engines.md(map-markers.ts 为上轮 ws-i 允许改动),「不碰」
  清单零改动;未 merge 回 dev、未 push

门禁: PASSED
结论: OK
