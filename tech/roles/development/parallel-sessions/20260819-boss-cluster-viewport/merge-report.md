# Merge Report — 20260819-boss-cluster-viewport

## 结果总览

| 分支 | tip | 状态 | 合并 commit |
|---|---|---|---|
| fix/viewport-poi-update (ws-b) | 5ba679e | ✅ 已合并 → dev `3ab9502` | `3ab9502` |
| feat/city-clustering (ws-a) | 6cc50bb | ✅ 已合并 → dev `963700f` | `963700f` |

- 合并顺序:ws-b → ws-a(先视口修复,后叠加聚类)。merge base 均为 dev `9cf961f`,
  两分支 map-shell 段位不同,合并零冲突(`ort` 策略自动合)。
- 每步合并后门禁全绿:
  - ws-b 后:npm test 398 通过 / typecheck / docs-check / diff-check ✔
  - ws-a 后:npm test **411 通过**(含 13 项聚合单测)/ typecheck / docs-check / diff-check ✔
- 已 push origin/dev 两次:`9cf961f..3ab9502`、`3ab9502..963700f`
- worktree 与分支清理完成:`dm-wt-wsA`、`dm-wt-wsB` 已 remove;`feat/city-clustering`、
  `fix/viewport-poi-update` 已 -d(无 dangling 分支)。

## 合并内容

1. **ws-b `fix(viewport)`: distance 圆心实时化** —— map-shell.tsx `distanceOrigin` 由
   挂载时一次性 `userLocation` 改为实时 `mapCenter`。这是「工作 POI 不随视角改变」的
   真实根因:distance=10 过滤持久化跨会话还原后,client pipeline 用陈旧圆心(距新视口
   37km)裁剪,把视口内公司整批裁空 → pois=[] + 旧 marker 视口外残留。
2. **ws-a `feat(cluster)`: B3 城市聚合(zoom ≤ 8)** —— city-cluster.ts 纯函数 +
   map-markers 聚合徽章渲染 + map-shell 接线。zoom ≤ 8 圆形徽章「城市名 N」,点击
   setZoomAndCenter(11) 下钻展开个体 pin。

## 浏览器验收(boss 实测,dev :3000)

- **B3 聚合**:zoom 拉至 8 以下 → 徽章出现「北京市17 / 上海市13 / 杭州市12 / 深圳市4 /
  杭州2 / 成都市1 / 广州市1」,白底 #007AFF 描边✅。点击「杭州市」徽章(真实鼠标坐标
  607,411)→ 平滑下钻 zoom 11,徽章消失、52 个个体 pin 展开 ✅。zoom 回 9+ → 徽章消失
  个体恢复;回 ≤8 → 徽章重建,切换互斥无残留 ✅。
- **ws-b 视口更新(核心)**:zoomin 至城市级(zoom 9)平移地图 → 结果数「50→48」实时更新,
  marker 随视角增删(51→51 差分)✅。**distance=10 过滤 + 跨城平移**复现验证:平移后按
  新视野裁剪,距离标注变「50 公里」、视野只有 2 个残留 🏢(位置 x=-208..-211 视口外边缘,
  属空视野正确行为);关闭 distance 过滤 → 立即恢复 18 结果 + 20 marker ✅(语义:「离当前
  视野中心最近」,过滤仍生效;这不是旧的「整批裁空不恢复」bug,圆心已跟随地图)。

## 遇到的问题

- ws-b worker 两轮均超预算(`Exceeded USD budget (3)`):第 1 轮改好 distanceOrigin 未
  commit;boss 追加「续作附录」重派,第 2 轮 commit `5ba679e` 后仍中断、未写报告。
  boss 用 `git fsck` 丢对象核查 + 主树逐段核对后**如实补写** ws-b 汇报。「空批次三态补
  pipeline 裁空清理层 / 契约测试」列为 follow-up(ws-b 汇报记录)。此缺口已在浏览器验收
  覆盖:即便 distance 圆心已实时化,`pois=[] → setPOIs([]) → 差分移除` 已在
  map-markers.ts:424 收敛,仅 keep-on-collection-fit 深分支未显式补,无可见回归。
- merger 脚本亦空输出退出(status completed 但有 0 字节 log);boss 直接改在主树按
  merge-instructions 手动合并 + 门禁 + push + 清理,完成事项与 merger 契约一致。

门禁: ALL_GREEN
结论: MERGED_ALL(ws-b + ws-a 均已合并入 dev 963700f 并 push)