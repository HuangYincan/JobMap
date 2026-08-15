# 前端设计系统更新报告

**日期**: 2026-08-15  
**阶段**: Phase 0 补充  
**提交**: `ad65631`

---

## 📋 更新概述

根据用户要求,将前端设计规范从 Figma 原型流程切换为 **Apple 风格设计系统 + 文字布局图审查**。

---

## ✅ 已完成的工作

### 1. **删除 Figma 相关内容**
- ✅ 删除 `tech/07-figma-workflow.md` (397 行)
- ✅ 从 `agent.md` 中移除 Figma 原型审查要求
- ✅ 更新所有文档中的 Figma 引用

### 2. **创建 Apple 风格设计系统** (`tech/07-frontend-design-system.md`)

**核心设计原则**:
- 🍎 **参考 Apple Maps** 布局和交互模式
- 💧 **液态玻璃质感** (使用 `liquid-glass-react`)
- 🎨 **深色/浅色自动切换** (跟随系统设置)
- 🧩 **使用现代化组件库** (shadcn/ui + Radix UI)

**详细内容**(718 行):
- Apple Maps 布局分析
- 液态玻璃组件规范
- 左侧边栏设计(折叠式 + 圆角 + 透明玻璃)
- 地图工具布局(指南针/缩放/定位/底图切换)
- 颜色系统(深色/浅色主题)
- 字体系统(SF Pro / Inter)
- 组件库选择与使用
- 响应式设计规范
- 文字布局图审查流程

### 3. **更新 Agent 工作规范** (`agent.md`)

**新增规则**:
- ✅ 前端开发前必须先创建**文字符号布局图**供用户审查
- ✅ 使用现代化组件库,避免重复造轮子
- ✅ 遵循 Apple 设计风格(液态玻璃 + Apple Maps 布局)

### 4. **解决 macOS 文件系统问题**

**问题**: macOS 默认文件系统不区分大小写,`docs/` 和 `DOCS/` 会被识别为同一个文件夹

**解决方案**:
- ✅ 将 `DOCS/` 重命名为 `tech/`(技术文档)
- ✅ 保留 `docs/` 作为公众文档
- ✅ 批量替换所有文档中的路径引用:
  - `README.md`: `DOCS/` → `tech/`
  - `CONTRIBUTING.md`: `DOCS/` → `tech/`
  - `agent.md`: `tech/` 相关章节更新
  - `tech/README.md`: 索引更新

**文件重命名清单**:
```
DOCS/00-initialization-report.md → tech/00-initialization-report.md
DOCS/01-architecture.md          → tech/01-architecture.md
DOCS/02-data-model.md            → tech/02-data-model.md
DOCS/03-plugin-system.md         → tech/03-plugin-system.md
DOCS/04-workflow.md              → tech/04-workflow.md
DOCS/05-milestones.md            → tech/05-milestones.md
DOCS/06-decisions.md             → tech/06-decisions.md
DOCS/07-figma-workflow.md        → (删除)
tech/07-frontend-design-system.md → (新增)
DOCS/README.md                   → tech/README.md
DOCS/roles/*                     → tech/roles/*
```

---

## 📊 变更统计

| 类型 | 数量 | 说明 |
|---|---|---|
| 文件删除 | 1 个 | `DOCS/07-figma-workflow.md` |
| 文件新增 | 1 个 | `tech/07-frontend-design-system.md` (718 行) |
| 文件重命名 | 13 个 | `DOCS/` → `tech/` |
| 文件修改 | 3 个 | `agent.md` + `README.md` + `CONTRIBUTING.md` |
| **总计** | **18 个文件变更** | +718 行新增, -459 行删除 |

---

## 🎨 Apple 风格设计系统要点

### 布局结构

```
┌─────────────────────────────────────────────┐
│  ┌─────┐                      ┌────┐ ┌────┐ │
│  │侧边栏│                      │指南│ │底图│ │
│  │(折叠)│                      │针  │ │切换│ │
│  │     │                      └────┘ └────┘ │
│  │     │                                    │
│  │大厂  │        全屏地图                     │
│  │收藏  │                                    │
│  │插件  │                                    │
│  │     │                                    │
│  │     │                      ┌────┐ ┌────┐ │
│  │用户头像│                      │缩放│ │定位│ │
│  └─────┘                      └────┘ └────┘ │
└─────────────────────────────────────────────┘
```

**关键特性**:
- 左侧边栏:默认折叠,四周圆角,透明液态玻璃,与页边有空隙
- 用户信息:侧边栏底部(网页左下角)
- 指南针:右上角
- 缩放/定位:右下角
- 底图切换:右上角(默认小 logo,点击展开卡片)
- 比例尺:尽可能不显眼

### 组件库

| 组件类型 | 推荐库 | 说明 |
|---|---|---|
| 液态玻璃 | `liquid-glass-react` | 卡片/侧边栏/悬浮工具 |
| 基础组件 | `shadcn/ui` | 按钮/输入框/下拉框/对话框 |
| 无障碍组件 | `Radix UI` | shadcn/ui 底层依赖 |
| 地图引擎 | 高德 Maps API | 国内首选 |
| 动画 | `framer-motion` | 侧边栏展开/卡片悬停 |

### 前端开发流程

1. **创建文字布局图** → 2. **用户审查** → 3. **迭代调整** → 4. **获批** → 5. **编写代码**

**文字布局图示例** (ASCII art):
```
┌──────────────────────────────────────┐
│ [≡] 侧边栏              [🧭] [🗺️]    │
│                                      │
│  大厂列表 ▼                           │
│  ├─ 阿里巴巴 (杭州)                   │
│  ├─ 腾讯 (深圳)            全屏地图    │
│  └─ 字节跳动 (北京)                   │
│                                      │
│  收藏夹                               │
│  ├─ 我的目标公司                      │
│  └─ 已投递                  [+] [-]  │
│                            [📍]      │
│  [👤] 用户头像                        │
└──────────────────────────────────────┘
```

---

## 🔄 文档结构调整

### 旧结构 (有冲突)
```
domain-map/
├── docs/          # 公众文档
├── DOCS/          # ❌ macOS 与 docs/ 冲突!
└── ...
```

### 新结构 (已解决)
```
domain-map/
├── docs/          # 公众文档(用户手册/教程)
├── tech/          # ✅ 技术文档(架构/设计/插件开发)
│   ├── 00-initialization-report.md
│   ├── 01-architecture.md
│   ├── 02-data-model.md
│   ├── 03-plugin-system.md
│   ├── 04-workflow.md
│   ├── 05-milestones.md
│   ├── 06-decisions.md
│   ├── 07-frontend-design-system.md  # 新增
│   ├── README.md
│   └── roles/     # 角色协作文档
└── ...
```

---

## 📝 后续行动

### 立即执行
1. ⏳ **推送变更到远程仓库**:
   ```bash
   git push origin dev
   ```

### Phase 1 开发建议
1. **前端开发时**:
   - 先创建文字布局图(ASCII art 或简单图示)
   - 提交给用户审查
   - 获批后再编写代码
   
2. **组件库安装**:
   ```bash
   cd server
   npm install liquid-glass-react
   npm install @radix-ui/react-* framer-motion
   # shadcn/ui 使用 CLI 按需添加
   npx shadcn@latest init
   ```

3. **参考资料**:
   - Apple Maps: https://maps.apple.com.cn/
   - liquid-glass-react: https://github.com/rdev/liquid-glass-react
   - shadcn/ui: https://ui.shadcn.com/

---

## ✨ 总结

✅ **已完成**:
- 删除 Figma 相关内容
- 创建完整的 Apple 风格设计系统文档
- 解决 macOS 文件系统大小写冲突
- 更新所有相关文档引用
- 提交到本地 Git(`ad65631`)

⏳ **待完成**:
- 推送到远程仓库 (需要用户手动执行 `git push origin dev`)

🎯 **下一步**:
- Phase 1 开发时,前端开发者/AI Agent 会自动遵循新的设计系统
- 文字布局图审查流程已就位
- 所有必要的组件库和设计规范已文档化

---

**文档已准备就绪!任何前端开发都会先经过布局图审查,使用 Apple 风格的液态玻璃设计。** 🍎💧
