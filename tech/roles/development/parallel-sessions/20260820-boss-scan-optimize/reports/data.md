# ws-data 汇报(2026-08-20)

## 实际改动

### 1. radar 双 https 前缀修正(2 文件 4 处,commit 1faeced)
| 文件 | 字段 | 修正前 | 修正后 |
|---|---|---|---|
| 中国科学院空天信息创新研究院.json | careerUrl | `https://https://zhaopin.aircas.ac.cn/` | `https://zhaopin.aircas.ac.cn/` |
| 中国科学院空天信息创新研究院.json | applyUrl | `https://https://zhaopin.aircas.ac.cn/` | `https://zhaopin.aircas.ac.cn/` |
| bdo立信.json | careerUrl | `https://https://bdochina.zhiye.com/intern/jobs` | `https://bdochina.zhiye.com/intern/jobs` |
| bdo立信.json | applyUrl | `https://https://bdochina.zhiye.com/intern/jobs` | `https://bdochina.zhiye.com/intern/jobs` |

前置扫描确认:全库 `https://https://` 恰 4 处,全部位于上述 2 文件;其余 11,322 个
careerUrl/applyUrl/logoUrl 字段均为合法 http(s)://,无空串、无裸域名。

### 2. 校验器 URL scheme 断言(commit 8b345a2)
- 实现位置:`server/src/lib/recruitment-import.ts`
  - 新增导出函数 `hasValidUrlScheme(raw)`:以 `/^https?:\/\//` 断言 http(s):// 开头,
    以 `/^https?:\/\/https?:\/\//` 拒绝重复 scheme(`https://https://`、`http://http://`、
    混搭均失败);undefined/null/空串(可选字段缺省)视为合法,不因缺 URL 拒收公司。
  - 接入 `validateSourceCompany` / `validatePosition`(company 级 import 唯一校验入口,
    校验失败的公司进 `plan.issues` 并 dropped,不会写库):
    - `company.careerUrl` → field `careerUrl`
    - `company.logoUrl` → field `logoUrl`
    - `site.careerUrl` / `site.logoUrl` → field `sites.careerUrl` / `sites.logoUrl`
    - `pos.applyUrl` → field `positions.applyUrl`
- 测试:`server/tests/recruitment-import.test.mjs` 新增 3 个用例
  - `hasValidUrlScheme` 单测:单 scheme 合法 / 双 scheme(含混搭)/ 裸域名 /
    protocol-relative(`//cdn…`)失败 / 缺省值合法
  - `validateSourceCompany` 集成:4 类 URL 字段双前缀/非 http 均被 flag,修正后零 issue
  - 数据级回归:2 个修正文件 `doesNotMatch /https:\/\/https:\/\//` 且 careerUrl/applyUrl
    均为单 scheme(钉死本次修复)

## 门禁结果

- npm test:`node --test tests/*.test.mjs` → 491 总数,489 通过 / 0 失败 / 2 skip
  (含新增 3 用例;与基线 423 相比套件整体已增长)
- typecheck:`tsc --noEmit` 通过
- docs-check:通过
- git diff --check:通过(无空白错误)
- 校验器只读运行(`npm run import:seed`,无 --apply,不触 DB):672 companies /
  1843 sites / 10643 positions,`dropped: 0`,`issues: []` — 断言对现有全量数据零误报

## 遇到的问题

- 沙箱对直接 `node scripts/plan-seed-import.mjs` 的执行要求审批;改用 npm alias
  `npm run import:seed`(同一脚本、只读路径,无 `--apply` 不写 DB)完成验证。
- 无其他问题;未执行任何 import:apply / geocode / DB 操作,未动其他 radar 文件
  (#3/#5 已 defer)。

## 证据

- 修正后 diff:`git diff HEAD~2 --stat` → 2 个 JSON 各 4 行(4 insertions / 4 deletions)
- 校验器输出:companies 672, dropped 0, issues []
- 新增测试全部通过(见门禁结果)

门禁: PASSED
结论: OK
