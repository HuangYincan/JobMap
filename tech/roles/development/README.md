# 开发文档

> **状态：角色记录模板；子文件仅在有真实证据时创建。最后审查：2026-08-15**


## 实施记录(Implementation)

每个 Phase 的开发过程记录在 `implementation/phase-X.md`,包含:

1. **目标**:本阶段要完成什么
2. **技术方案**:如何实现(架构/技术选型)
3. **关键代码**:核心文件清单
4. **遇到的问题**:开发中遇到的坑 + 解决方案
5. **测试验证**:如何验证功能正确
6. **待优化**:已知问题/技术债

## Code Review

`phase1-code-review.md` 记录 Phase 1 的 Code Review 结论与检查清单(通用 review-checklist 尚未单独建立)。

每个 PR 需要通过检查:
- [ ] 代码规范(ESLint/Black)
- [ ] 测试覆盖率 > 80%
- [ ] 文档已更新
- [ ] 无安全漏洞
- [ ] 性能可接受

## 并行开发批次(Parallel Sessions)

`parallel-sessions/` 存放全部并行开发批次(每批一个目录:manifest/prompts/reports/
merge-report/boss-state/deferred-notes)。**批次索引见
[parallel-sessions/README.md](parallel-sessions/README.md)**(24 批,按日期倒序);
各批遗留待办的合并追踪见 [deferred-ledger.md](deferred-ledger.md)。

## 质量扫描(Quality Scans)

`quality-scans/` 存放 boss-scanner 产出的只读质量扫描报告(scope: 文档/前端/后端/数据库/
数据),报告含发现清单 + 修复建议批次,供 boss 审批后派 fix 批次。最新报告:
[20260820-all](quality-scans/20260820-all/scan-report.md)(15 发现 + 修复状态回填),
历史:[20260819-all](quality-scans/20260819-all/scan-report.md)、
[20260819-docs](quality-scans/20260819-docs/scan-report.md)。
