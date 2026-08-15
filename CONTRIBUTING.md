# 贡献指南

感谢你对 Domain Map Platform 的关注!这份指南将帮助你参与项目贡献。

## 🌟 贡献方式

### 1. 报告问题(Issues)

发现 bug 或有功能建议?请在 GitHub Issues 中提交:

**Bug 报告应包含**:
- 清晰的标题(如:`[Bug] 地图缩放到极限时崩溃`)
- 复现步骤
- 预期行为 vs 实际行为
- 环境信息(浏览器/操作系统/Node 版本)
- 截图或错误日志(如果适用)

**功能建议应包含**:
- 功能描述
- 使用场景
- 期望的用户体验
- 可选的实现思路

### 2. 贡献代码

#### 开发流程

1. **Fork 仓库**
   ```bash
   # 在 GitHub 上 fork https://github.com/HuangYincan/JobMap
   git clone https://github.com/YOUR_USERNAME/JobMap.git
   cd JobMap
   git remote add upstream https://github.com/HuangYincan/JobMap.git
   ```

2. **创建功能分支**
   ```bash
   git checkout dev
   git pull upstream dev
   git checkout -b feature/your-feature-name
   # 或 bugfix/your-bug-name
   ```

3. **开发与测试**
   ```bash
   # 启动开发环境
   make setup
   make dev
   
   # 运行测试
   make test
   
   # 代码检查
   make lint
   ```

4. **提交代码**
   ```bash
   # 遵循 Conventional Commits 规范
   git add .
   git commit -m "feat(plugin): add housing plugin"
   
   # 推送到你的 fork
   git push origin feature/your-feature-name
   ```

5. **提交 Pull Request**
   - 在 GitHub 上从你的分支创建 PR 到 `dev` 分支
   - 填写 PR 模板(目的/改动/测试/截图)
   - 等待 Code Review

#### Commit Message 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Type**:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式(不影响功能)
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具/依赖更新

**Scope**(可选):
- `plugin`: 插件系统
- `map`: 地图功能
- `api`: API 接口
- `ui`: 前端 UI
- `crawler`: 爬虫
- `db`: 数据库

**示例**:
```bash
feat(plugin): add housing plugin with rent data
fix(map): resolve zoom level crash on Safari
docs(api): update authentication endpoint docs
```

### 3. 贡献文档

文档同样重要!你可以:
- 修正错别字/链接
- 改进教程清晰度
- 添加使用案例
- 翻译文档(英文版)

文档位置:
- 用户文档:`docs/zh-cn/`
- 技术文档:`tech/`
- API 文档:`docs/zh-cn/developers/api-reference.md`

### 4. 贡献插件

Domain Map Platform 的核心是插件化!你可以:

1. **官方插件**(需要 PR 审核):
   - 复制 `server/plugins/_template/`
   - 实现插件接口
   - 编写测试
   - 提交 PR

2. **第三方插件**(将来支持):
   - 发布到 npm
   - 在插件市场分享

详见 [tech/03-plugin-system.md](tech/03-plugin-system.md)

## 📋 开发规范

### 代码风格

**前端(TypeScript)**:
- ESLint + Prettier
- 2 空格缩进
- 使用 `const` / `let`,避免 `var`
- 函数式编程优先
- 组件使用 TypeScript 严格模式

**后端(Python)**:
- Black + Ruff
- 4 空格缩进
- Type hints(Python 3.12+)
- Docstring(Google Style)

运行检查:
```bash
make lint    # 所有代码检查
make format  # 自动格式化
```

### 测试要求

- 新功能必须有测试覆盖
- Bug 修复需要回归测试
- 测试覆盖率不低于 80%
- 关键路径需要 E2E 测试

运行测试:
```bash
make test           # 所有测试
make test-unit      # 单元测试
make test-e2e       # E2E 测试
```

### Code Review 标准

PR 需要通过以下检查:

- [ ] **CI 通过**(lint + test)
- [ ] **代码规范**:遵循项目风格
- [ ] **功能完整**:实现了 Issue 要求
- [ ] **测试覆盖**:新代码有测试
- [ ] **文档更新**:API/功能变更更新了文档
- [ ] **无安全风险**:没有 SQL 注入/XSS/敏感信息泄露
- [ ] **性能可接受**:没有明显性能退化

详见 [docs/roles/development/code-review/review-checklist.md](docs/roles/development/code-review/review-checklist.md)

## 🎯 寻找贡献点

### Good First Issue

适合新手的 Issue 会标记为 `good first issue`,包括:
- 文档改进
- 简单 bug 修复
- UI 优化
- 测试补充

### Help Wanted

复杂但需要帮助的 Issue 标记为 `help wanted`,包括:
- 新插件开发
- 性能优化
- 复杂功能实现

### 优先级

- 🔥 `P0 - Critical`: 严重 bug,需要紧急修复
- ⚡ `P1 - High`: 重要功能/bug
- 📌 `P2 - Medium`: 一般优先级
- 💡 `P3 - Low`: 优化/nice-to-have

## 🏗️ 项目结构

```
domain-map/
├── server/              # Next.js 前后端
│   ├── app/            # App Router
│   ├── components/     # React 组件
│   ├── lib/            # 工具库
│   └── plugins/        # 插件
├── crawler/            # Python 爬虫
│   ├── app/
│   │   ├── plugins/   # 爬虫插件
│   │   └── core/      # 核心逻辑
│   └── tests/
├── db/                 # 数据库 migrations
├── tests/              # 集成/E2E 测试
├── docs/               # 公众文档 + 角色协作文档
└── tech/               # 技术文档
```

详见 [tech/01-architecture.md](tech/01-architecture.md)

## 🤝 社区规范

### 行为准则

我们致力于提供友好、安全、包容的社区环境。参与者应该:

- ✅ 友善、尊重他人
- ✅ 包容不同观点
- ✅ 接受建设性批评
- ✅ 关注对社区最有利的事情

- ❌ 使用性暗示语言或图像
- ❌ 人身攻击或政治攻击
- ❌ 骚扰(公开或私下)
- ❌ 未经许可发布他人隐私信息

违反者可能被暂时或永久禁止参与社区。

### 沟通渠道

- **GitHub Issues**: Bug 报告 / 功能建议
- **GitHub Discussions**: 问题讨论 / 经验分享
- **Pull Requests**: 代码审查
- **邮件**: Yincan_Huang@zju.edu.cn(私密问题)

## 📜 许可

提交贡献即表示你同意你的代码使用 MIT License 发布。详见 [LICENSE](LICENSE)。

## 🙏 致谢

感谢所有贡献者!你的参与让这个项目更好 ❤️

---

**有问题?** 查看 [FAQ](docs/zh-cn/guide/faq.md) 或在 GitHub Discussions 提问。
