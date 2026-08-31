# Deferred Notes — engine-polish-2(2026-08-22/23)

## 需用户决策项(改现有 UI 设计 / Env-only / 数据口径)

### 1. 腾讯底图 POI 图标整体隐藏(UI设计取舍,2026-08-23,ws-j 修复的副作用)

- 修复「腾讯底图公司 POI 渲染很奇怪」(混合块)= 腾讯矢量底图**自身 POI 图标层**(医院/
  商场/地铁等小图标,light 样式下视口内约 890 个)与公司徽章叠印。修复方式:
  `tencent-engine.ts` `styleToBaseMap` 的矢量底图 features 排除 `'point'`(POI 图标层),
  **保留** `'label'`(地名/路名文字标注)。
- **副作用**:腾讯底图(light 样式)不再显示任何 POI 小图标。这是让混合块消失的唯一
  应用侧路径(对应位置 catalog 无公司,无法「补徽章」)。
- **如需保留底图 POI 图标**:撤销 `styleToBaseMap` 的 point 排除即可(混合块恢复为底图
  原生内容,属可接受地图行为)。请用户确认取舍。

### 2. favicon.im 域名级黑名单(可选优化,2026-08-23)

- 首会话 console errors 794 行 = 397 唯一 favicon.im URL × 2(400 活跃 POI × 1 候选,
  链式预检已生效;后续会话 sessionStorage 记忆 0 行)。
- favicon.im 已知无 CORS 头(恒失败)→ 可静态黑名单跳过预检,首会话噪音 → 0 行。
- 属锦上添花,不阻塞;需要时派一轮小 fix。

### 3. 既有遗留(数据域,非本批次)

- 主工作树 `server/data/` 8+ radar JSON 疑似 geocode 误写残留(多家公司 drop-site 被改成
  深圳百度国际大厦同一点)+ `.address-work/` 目录 —— 数据域问题,未处理。
