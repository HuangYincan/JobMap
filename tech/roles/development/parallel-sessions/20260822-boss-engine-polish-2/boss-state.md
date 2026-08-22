# Boss State — engine-polish-2

## meta

- slug: 20260822-boss-engine-polish-2
- date: 2026-08-22
- batch_dir: /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-engine-polish-2
- goal: 用户 5 bug(百度卫星/深色、百度 POI、腾讯 POI 偏移、腾讯 POI 无 icon、腾讯/百度定位不真实)
- owner: boss
- decision: 全部技术类,直接派发 4 ws 并行

## stage

- current: DISPATCH(轮10 ws-k/ws-l 并行:腾讯 icon 边框 + 百度滚轮闪烁,2026-08-23)
- updated_at: 2026-08-23

## 轮10(2026-08-23,ws-k + ws-l)用户新报 2 bug

- **ws-k 腾讯「只有 icon 没有边框」**:boss 实测 = icon.horse 预检升级后纹理 = 裸 favicon
  (无白底边框,hook 实证 dm-st-11+ = icon.horse src);修复 = 升级时把远程 icon 包进徽章
  SVG(badgeWithRemoteIcon,白底 + 边框 + 居中 logo,与 AMap/百度同语言;CORS 实测决定
  <image> 跨域 or fetch base64 内联)。
- **ws-l 百度「滚轮缩放 POI 闪烁」**:boss 高频帧实锤 f00→f01 全部 30 徽章瞬移(消失 23 +
  新增 23)、f01→f02 再 11、后稳定;二分(校准循环/LOD 摘挂/注入定时器)定位修复。

## 轮8/9 终态(2026-08-23,ws-i + ws-j)

- **ws-i(轮8)**:初始渲染竞态修复(setTimeout(0) 全量 setGeometries 重推)+ icon 预检链式
  推进 → MERGED push f8efbdd。
- **ws-j(轮9)**:「混合块」根因 = **腾讯矢量底图自身 POI 图标层**(light 样式;裸地图对照
  决定性;dark 样式不渲染 → 解释 ws-i 与 boss 复现矛盾);修复 = styleToBaseMap features
  排除 point(保留地名/路名标注)→ MERGED push 56735a6。
- **主树最终复验(boss,2026-08-23,light 模式)**:3 个混合块消失;15 徽章完整;点击弹卡
  (高频杭州);剩余扁平元素均为视口边缘/固定 UI;首会话 errors 794 行 = 397 唯一
  favicon.im × 2(400 POI × 1 候选链式,后续会话 0 行)。

## 最终复验(boss,轮5 合并后主树)

- ✅ 百度徽章:32 视口内 40px 徽章,位置正常(无 ±worldSize 偏移),0 errors
- ✅ 百度点击:徽章→POI 卡完整打开(公司名/Save/职位列表)
- ✅ 缩放跟随:滚轮放大后 31 徽章仍可见
- ✅ 腾讯 icon:53 个 icon.horse 全部 200 加载
- ✅ 卫星/深色:生效
- ✅ 定位:三引擎浏览器高精度 + 蓝点渲染

## workstreams

| ws | branch | worktree | prompt | report | status | last_tip | dispatched_at | finished_at | verdict |
|---|---|---|---|---|---|---|---|---|---|
| a | fix/baidu-style | /Users/acccan/dm-wt-bs | prompts/ws-a.md | reports/ws-a.md | DONE | 262b49d | 轮1 | 2026-08-22 | OK(3 commits, 1379/1377 pass, boss 已验证) |
| b | fix/baidu-poi-locate | /Users/acccan/dm-wt-bp | prompts/ws-b.md | reports/ws-b.md | DONE | f77cad0 | 轮1 | 2026-08-22 | OK(3 commits, 1381/1379 pass, boss 已验证;POI 单点级核查三环节正确,定位改浏览器高精度) |
| c | fix/tencent-poi-icon | /Users/acccan/dm-wt-ti | prompts/ws-c.md | reports/ws-c.md | DONE | 171c544 | 轮1 | 2026-08-22 | OK(3 commits, 1384/1382 pass, boss 已验证;anchor=-offset 契约修正 + icon 候选链) |
| d | fix/tencent-locate | /Users/acccan/dm-wt-tl | prompts/ws-d.md | reports/ws-d.md | DONE | 2545985 | 轮1 | 2026-08-22 | OK(3 commits, 1375/1373 pass, boss 已验证) |
| e | fix/baidu-round2 | /Users/acccan/dm-wt-br2 | prompts/ws-e.md | reports/ws-e.md | DONE | 230ff5c | 轮2 | 2026-08-22 | OK(3 commits;POI 根因=BMapGL v1.0 无 setContent 实锤,深色切 vector,蓝点判定) |
| f | fix/baidu-r3/r4 | /Users/acccan/dm-wt-br3/br4 | prompts/ws-f.md | reports/ws-f.md | DONE | bf1dd7c | 轮3/4 | 2026-08-22 | OK(r3:Overlay 静默失效→Marker 注入主路径;r4:定时器兜底,主树复验 136 警告修复) |
| g | fix/baidu-r5 | /Users/acccan/dm-wt-br5 | prompts/ws-g.md | reports/ws-g.md | DONE | 385155e | 轮5(fixPosition 反绕) | 2026-08-22 | OK(3 commits, 1434/1432 pass;SDK fixPosition 反绕根因 + 实例遮蔽修复) |
| i | fix/tmap-badge-overlap | /Users/acccan/dm-wt-tov | prompts/ws-i.md | reports/ws-i.md | MERGED | c16e0d5 | 轮8 | 2026-08-23 | OK(6 commits, 1461/1461 pass boss 复验;竞态修复 + 链式预检) |
| j | fix/tmap-mixed-block | /Users/acccan/dm-wt-tmb | prompts/ws-j.md | reports/ws-j.md | MERGED | da4a5fe | 轮9 | 2026-08-23 | OK(2 commits, 1461/1461 pass boss 复验;根因=底图 POI 图标层,features 排除 point) |
| k | fix/tmap-icon-frame | /Users/acccan/dm-wt-tif | prompts/ws-k.md | reports/ws-k.md | RUNNING | dev c6a919a 切 | 轮10 | — | — |
| l | fix/baidu-blink | /Users/acccan/dm-wt-bbl | prompts/ws-l.md | reports/ws-l.md | RUNNING | dev c6a919a 切 | 轮10 | — | — |

## 关键证据(2026-08-22)

- **bug 4 实锤**:favicon.im 403 + 无 CORS 头;icon.horse 实测 `access-control-allow-origin: *`(HTTP 200)→ TMap icon 候选链可行
- **bug 5 根因**:AMap=浏览器高精度;腾讯缺 enableHighAccuracy + maximumAge:60s 缓存;百度=SDK IP 定位
- **bug 1 嫌疑**:卫星常量 `BMAPGL_SATELLITE_MAP` 可能错误(BMapGL 用 BMAP_SATELLITE_MAP);深色无实现
- **bug 2**:百度聚合级正常;单点级待 worker 实测
- **bug 3 疑点**:聚合徽章 size/anchor 组合、状态尺寸 styleId 复用、content+icon 并存公式

## merge_order

轮1: ws-a → ws-b → ws-c → ws-d(并行开发,按序合并;baidu-engine.ts / tencent-engine.ts 段切分已隔离)。每轮 push origin/dev。

## next_plan

1. 轮1 派发(本 stage)
2. COLLECT → ADJUDICATE → MERGE(按序)→ push
3. Playwright 验证 5 bug 矩阵(百度卫星/深色、百度 POI 单点、腾讯 icon logo、腾讯偏移、三引擎定位)

## recovery

- last_stage_written: DISPATCH(轮1 派发)
- resume_history: —
