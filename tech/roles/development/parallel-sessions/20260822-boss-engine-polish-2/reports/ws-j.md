# ws-j 汇报(2026-08-23)

分支 `fix/tmap-mixed-block`(worktree `/Users/acccan/dm-wt-tmb`,基于 dev `6119a2d`)。
共 2 个 commit:
- `e1f37a8` fix(map-engine):tencent 矢量底图排除 point(POI 图标层)——「混合块」根因
- `da4a5fe` docs(23):ws-j 回填

## 根因(实测证据链,非推断)

**「混合块」 = 腾讯矢量底图自身的 POI 图标(light 标准样式),不是本应用的渲染 bug,也不是「两个元素偏移叠印」。**

boss 真机 light 模式复现的 3 处「混合块」(35×15 #2699f5 圆角蓝块 + 白 glyph + 光晕 + 阴影)是腾讯矢量底图在对应地理坐标渲染的 POI 类别图标。证据:

1. **裸 TMap 地图对照(决定性)**:零应用代码的 `file://` 页面 + 同 key,仅 `new TMap.Map({baseMap:{type:'vector'}})`——在 3 个混合块地理坐标(30.27757,120.14245 / 30.29346,120.18330 / 30.27549,120.09198)渲染**同款 35×15 图标**,三处 glyph 逐像素一致(同一 POI 类别),pan 锚定;
2. **枚举 overlay(任务 1)**:`TMap.MultiMarker` 构造器 + add/remove/setGeometries/setMap 全程 hook —— 仅 **1 个实例**、400 geometry、零 'default' styleId、无重复实体、无同 id 双实例;全部 400 geometry 经 `map.projectToContainer` 投影,**3 个混合块位置 500m 内零 geometry**(最近 1.1–2.4km)→ 不是我们的 marker;
3. **不在 DOM / 点击无响应**与「随地图移动」全部吻合底图矢量要素(向量渲染、无拾取);对照完整徽章(699,449)= 高频杭州(中心点 dm-mk-1..7 堆叠)可点击;
4. **明暗模式差异 = ws-i 与 boss 复现矛盾的根因**:headless 环境跟随系统深色 → 应用映射 whitesmoke → dark 样式,**dark 样式实测不渲染 POI 图标层**(ws-i 验收「零扁块」);boss 真机为 light 样式 → 渲染图标。与 viewport/等待时间/webpack 无关;
5. **「偏移叠印」误读**:图标自带光晕(上)+ 阴影(下)+ 白 glyph,在 1px 像素分析下被解读为「两个元素垂直偏移叠印」;实测为单一矢量图标。

## 二分各步结论(任务 2)

1. **禁 ws-i setGeometries 重推** → 混合块不消失(裸地图对照已证与全部应用代码无关,本步免测——混合块在零应用代码页面同样存在);
2. **禁 LOD 摘挂** → 同上,无关(枚举日志:静态加载零 remove,混合块与 LOD 无交互);
3. **禁 icon.horse 候选** → 无关(图标颜色 #2699f5 ≠ 任何徽章候选图标);
4. **枚举 overlay**:无第二渲染实体——「第二套渲染源」即底图自身(矢量样式 point 层)。

## 修复(最小改动)

`server/src/lib/map-engine/tencent/tencent-engine.ts` `styleToBaseMap`:
- 矢量底图 features 显式排除 `'point'`(POI 图标层):
  `{ type: 'vector', features: ['base', 'building3d', 'label', 'arrow'] }`
  (SDK v1.8.0.2 源码核实 `DEFAULT_BASEMAP.vector.features = [base, building3d, point, label, arrow]`;'base' 含道路);
- **保留 `'label'`**(地名/路名文字标注);卫星底图路径不受影响;
- 裸地图逐像素 diff 验证:排除 point 后 **仅 POI 图标簇消失**,道路/绿地/水体/建筑/地名标注全部保留;
- **产品含义(需 boss 知悉)**:腾讯底图不再显示任何 POI 图标(医院/商场/地铁等小图标,light 样式下视口内约 890 个)。若需保留底图 POI 图标,撤销该单点改动即可——混合块是底图原生内容,无其他应用侧修复路径(对应位置 catalog 无公司,无法「补徽章」)。

## 真机验收(worktree :3100 webpack + headless Chrome CDP,light 模式仿真)

- **腾讯**:3 个混合块消失(修复前同条件 :3000 light 模式稳定复现 3 块);14 个完整 40×40 徽章 + 1 个「双徽章」(dm-mk-14/15 两家相距 ~430m 的公司,diagonal 叠印为正常地图行为,非 bug);点击中心徽章 →「高频杭州」POI 卡弹出(地址/在招岗位/职能筛选,与 boss 主树实测一致);zoom +1 / pan 后徽章保持完整;3/3 全新 reload 复验:0 混合块 + 15 徽章组件;
- **console errors 不劣化**:首会话 360 行(180 唯一 favicon.im × 2,与 ws-i 基线一致,链式预检语义保持),第二会话 10 行(5 个 POI 候选链推进 icon.horse),第三会话 0 行;
- **AMap/Baidu 零回归**:amap 400 徽章 DOM 全渲染、baidu 400 徽章 DOM 全渲染;
- 测试更新:baseMap 断言(构造 + setStyle 两处)补 features 期望。

## 门禁结果

- npm test: 1461 通过 / 0 失败 / 2 skip(1463 total)
- npm run typecheck: 通过
- make docs-check: 通过(§6 追加后复跑)
- git diff --check: 通过

## 遇到的问题

1. **任务前提与实测不符**:「混合块 = 两个元素偏移叠印」的推断不成立——实测为底图原生 POI 图标(裸地图对照决定性)。已按实测机制修复(排除 point 层),未在代码注释写未证实结论;
2. **修复的视觉代价**:腾讯 light 底图 POI 图标整体隐藏(地名/路名标注保留)。这是唯一能让混合块消失的路径;若 boss 裁决保留底图 POI 图标,回退 `styleToBaseMap` 单点改动即可(混合块即恢复为底图原生内容,属可接受地图行为);
3. **环境差异**:ws-i「零扁块」与 boss「稳定复现」的矛盾 = 明暗模式(腾讯 dark 样式不渲染 POI 图标);headless 复现需 `Emulation.setEmulatedMedia` 强制 light;
4. worktree dev 服务器以 `next dev --webpack -p 3100` 运行(worktree node_modules 为指向主树的 symlink,turbopack 拒绝越根 symlink;webpack 无此限制),日志 `/tmp/wsj/dev-3100b.log`;`.env.local` 已复制入 worktree(本地运行用,gitignored 不入库)。

## 证据

- 复现与对照截图(/tmp/wsj/):`r1-reload.png`(dark 无块)、`r9-light-default.png`(:3000 light 3 块复现,坐标 (915,249)/(677,356)/(383,370) = boss 坐标换算)、`r10-bare-*.png`(裸 TMap 同位置同款图标,决定性)、`v1-fixed-light-reload1.png`(修复后 0 块)、`v2/v5-fixed-click*.png`(点击弹「高频杭州」卡)、`v3-fixed-zoom.png`/`v4-fixed-pan.png`(缩放/pan 完整)、`rel-1..3.png`(3/3 reload 0 块)、`reg-amap.png`/`reg-baidu.png`(零回归)、`r11/r12/r13/r14/r15-*.png`(features 对照实验)
- 枚举数据:/tmp/wsj/`r7-allproj.json`(400 geometry 全投影)、`r5-insp.json`(1 实例/400 geometry/零 default styleId)、`r6-proj.json`、`r2-mmlog.json`
- SDK 源码核实:/tmp/tmap-sdk.js——`DEFAULT_BASEMAP.vector.features=[base,building3d,point,label,arrow]`、base 层构造 point/label 分支、默认 pin 为红色 34×50(#2699f5 非 SDK pin 色);vector 样式 JSON `/tmp/wsj/tmap-style2.json`、图标表 `/tmp/wsj/tmap-icon.json`
- 像素分析脚本:/tmp/wsj/`{png,analyze,blobs,components,region,ascii,rgb}.mjs`
- 测试输出:tests 1463 / pass 1461 / fail 0 / skipped 2;typecheck / docs-check / diff-check 零告警
- 文件边界:仅 tencent-engine.ts / 3 个测试文件 / tech/23(仅追加 §6);「不碰」清单零改动;未 merge 回 dev、未 push;分支与 worktree 留原地

门禁: PASSED
结论: OK
