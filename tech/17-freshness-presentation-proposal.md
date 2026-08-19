# 提案：工作模式「校招进行中 / 官网直投」新鲜度呈现

> **状态:** PROPOSED — 等待用户批准（plugin-dev 门禁：前端呈现需 ASCII 布局 + 明确批准）。未实现。
> **命运（2026-08-20 补记）：已取代。** 2026-08-17 用户决策 A1（见 `tech/18-national-scale-plan.md` §A1:19-22）：
> 「不做复杂新鲜度徽标，呈现上只突出『在招中』信号，过期岗位自动隐藏」。本提案作历史存档保留，徽标 UI 不再排期；
> `server/src/lib/freshness.ts` 的 radar/portal 判定仍用于「真实岗位」过滤（`isAuthenticPositionId`，A1 的读路径守卫）。

## 背景

> **历史语境：** 下文两类信号描述与数字为 **2026-08-16/17 杭州 pilot** 时期的 catalog 状态，仅作历史参考。
> **现状（2026-08-20，`server/data/recruitment/` 文件口径）：** `radar-*` **763 条**（628 个公司文件，
> 2026-08-17 全国快照 + 后续策展/聚合标注）；`portal-*` **9803 条**（25 家公司，其中 9800 条为 Feishu-ATS
> 逐岗位条目 `portal-feishu-*`；策展入口仅余 betta×2（`portal-betta-campus/social`）+ deepseek×1
> （`portal-deepseek`）—— megvii/tigermed 入口已于 2026-08-18/19 移除）。

工作模式离线 catalog 现在带两类「新鲜度」信号（`data-quality.md`）：
- **radar-\* 岗位**：`xiaozhao-radar` 快照合并到已匹配公司 pin（12 个 pin / 27 条，真实投递链接）。
- **portal-\* 岗位**：策展的官网招聘入口（betta / megvii / deepseek，已验证链接）。

这两类不是具体 JD，而是「该公司此刻正在招 / 官方投递入口」。当前卡片与普通 seed 岗位无差别，用户分不清「这是活的开岗信号」还是「静态示例岗」。

## 目标

让两类新鲜度信号在卡片上一眼可辨，且不过度承诺（不写具体 JD）。

## ASCII 布局（工作模式 POICard）

```
┌────────────────────────────────────────────┐
│  ◉ 阿里巴巴                 ⭐ 4.6  2.4km │
│    [正在校招] [官网直投]                    │   ← 新鲜度徽标（蓝色 outline 小胶囊）
│    大厂 · 互联网 · AI                       │
│    ──────────────────────────────────────  │
│    前端开发工程师（2026 秋招）  18-28K      │   ← seed/radar 岗位列表
│    ▸ 基础模型/大模型应用/芯片（雷达快照）     │   ← radar-*：标题 + 「雷达快照」副标
│    ▸ 校园招聘（官网投递）          →        │   ← portal-*：跳转官方入口
└────────────────────────────────────────────┘
```

- **徽标规则**：pin 有任意 `radar-*` 开岗位 → 「正在校招」；有 `portal-*` → 「官网直投」。蓝色 `#007AFF` 1px outline 小胶囊（12px 文本用 `--blue-ink`）。
- **岗位行副标**：`radar-*` 行显示「雷达快照 · 直达投递」；`portal-*` 行显示「官网入口」，点击跳 `applyUrl`。
- **不做的**：不解析雷达聚合标题成具体 JD；不在地图上加新 marker 类型；不动 Saved/Recent（`portal-*`/`radar-*` 均非 persistable 场景——它们已是 catalog 行）。

## 影响面

- `server/src/components/poi-card.tsx`：徽标 + 副标渲染。
- `server/src/lib/`：新增 `positionFreshness(position)` 纯函数（`radar-`/`portal-` 前缀判断），可单测。
- 无 API/DB 变更；无新依赖。

## 验收

- 桌面 + 移动端工作模式：阿里/网易/字节卡片出现「正在校招」，betta/megvii/deepseek 出现「官网直投」。
- 域模式无徽标。测试 `npm test` + `tsc` + `docs-check`。
