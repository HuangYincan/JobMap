# Deferred Notes — 20260819-mobile-ux

> 需用户决策 / 口径确认 / 不自动执行的项,任务全部完成后统一告知。

- [口径确认] **默认模式已是工作模式**:`map-shell.tsx:190` `useState('work')` + `account.ts:120`
  `DEFAULT_PREFERENCES.defaultMode:'work'`。无需改码。注:登录用户若曾在 Profile 存过
  domain 偏好,登录后会按偏好恢复(预期行为,非 bug)。若用户观察到非 work 默认,请检查自身偏好。
- [口径确认] **搜索占位文案不做 i18n**:现有 `searchPlaceholder` 为中文硬编码(zh/en 同显),
  本批维持该模式,不改 i18n.ts。
- [待办] **视觉验收**:worker 均为 headless(无浏览器),未产出截图。建议带浏览器会话/用户复核:
  抽屉全开高度是否到指南针中心、全开时指南针/比例尺是否隐藏、指南针下定位按钮(移动端)尺寸、
  详情返回后滚动位置保留、点卡片边缘取消选中;桌面端 compass/scale 不被误隐藏。
