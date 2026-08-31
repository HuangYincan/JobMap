# WS: ws-data — radar 双 https 前缀修正 + import 校验器 URL 断言(scan #4)

## 背景
2026-08-20 全库扫描发现:2 个 radar drop JSON 的 careerUrl/applyUrl 均为 `https://https://…` 双重协议前缀(全库仅此 4 处),JD 面板「投递」链接不可用。

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-data)

1. **修正 4 处双前缀**(去重复 `https://`):
   - /Users/acccan/dm-wt-data/server/data/recruitment/radar/中国科学院空天信息创新研究院.json(2 处:careerUrl + applyUrl)
   - /Users/acccan/dm-wt-data/server/data/recruitment/radar/bdo立信.json(2 处)
2. **校验器加 URL scheme 归一断言防复发**:找到 import 校验器(server/scripts/plan-seed-import.mjs 或 server/src/lib 下对应校验逻辑,以实际文件为准),加断言:URL 字段以 `http(s)://` 开头且**不含重复 scheme**(`https://https://` 直接失败)。
3. **跑校验器确认通过**(校验器只读,不 import——import apply 是 Env-only 已 defer)。

## 文件边界
上述 2 个 JSON + 校验器代码 + 校验器相关测试。
**不要执行任何 import/apply/DB 操作**;**不要动其他 radar 文件**(#3/#5 已 defer 等用户拍板)。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-data && make docs-check
cd /Users/acccan/dm-wt-data/server && npm test
cd /Users/acccan/dm-wt-data/server && npm run typecheck
cd /Users/acccan/dm-wt-data && git diff --check
```
(若校验器是独立脚本:`node scripts/plan-seed-import.mjs --validate` 类只读运行)

## 提交
Conventional Commits:`fix(data): radar 双 https 前缀修正(2 文件 4 处)` + `feat(import): 校验器 URL scheme 断言防复发`。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-scan-optimize/reports/data.md:
- 修正的 4 处 URL(修正前后)
- 校验器断言实现位置 + 测试
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
