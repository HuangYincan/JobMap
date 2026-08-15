# 04 - 贡献工作流

## 分支策略

- `main`:生产环境,只接受 release tag
- `dev`:开发主分支,所有功能分支合并到这里
- `feature/*`:功能开发分支
- `fix/*`:Bug 修复分支
- `docs/*`:文档更新分支

## 工作流程

### 1. 创建分支

```bash
git checkout dev
git pull origin dev
git checkout -b feature/user-profile-plugin
```

### 2. 开发 + 测试

```bash
# 编写代码...
# 编写测试...
make test
make lint
```

### 3. 提交代码

Commit message 格式:`<type>(<scope>): <subject>`

- **type**:feat / fix / docs / test / refactor / chore
- **scope**:插件名或模块名
- **subject**:简短描述

示例:
```bash
git add .
git commit -m "feat(user-profile): add resume upload and AI parsing"
```

### 4. 更新文档

- 同步技术文档:`tech/`
- 写使用教程:`docs/zh-cn/tutorial/`
- 更新角色文档:`docs/roles/development/implementation/`

### 5. 推送并创建 PR

```bash
git push origin feature/user-profile-plugin
gh pr create --base dev --title "feat(user-profile): add resume upload" --body "实现用户画像插件的简历上传功能..."
```

### 6. Code Review

使用 `/code-review` skill 自我审查,或等待人工审查。

### 7. 合并

PR 通过后合并到 `dev`。

## Code Review 检查清单

- [ ] 代码符合 ESLint / Black 规范
- [ ] 测试覆盖率 > 80%
- [ ] 文档已更新
- [ ] 无安全漏洞
- [ ] 性能可接受(大查询有索引)
- [ ] 插件系统未破坏(新代码兼容抽象层)

## 发布流程

1. 从 `dev` 创建 `release/v1.0.0` 分支
2. 运行完整验证:`make verify`
3. 更新 `CHANGELOG.md`
4. 合并到 `main` 并打 tag:`git tag v1.0.0`
5. 部署到生产环境

详见 `docs/roles/operations/deployment/release-checklist.md`
