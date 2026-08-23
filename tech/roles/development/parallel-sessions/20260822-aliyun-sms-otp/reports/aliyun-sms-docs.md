# aliyun-sms-docs 汇报(2026-08-22)

WS: aliyun-sms-docs(分支 `feature/aliyun-sms-docs`,worktree `/Users/acccan/dm-wt-aliyun-sms-docs`)
契约来源:批次 `20260822-aliyun-sms-otp` README + `prompts/aliyun-sms-docs.md`(未读 ws-1 代码)

## 实际改动

- `tech/26-aliyun-sms.md`(新,106 行)→ 照 tech/25 风格:标题/版本 1.0/创建日期/状态;§1 背景与动机(D-04 遗留 → 阿里云真发 + demo hint 删除);§2 端点契约(phone 200 → `{ ok: true, provider, expiresAt, requestId }`,requestId 取自阿里云响应;错误映射表 5 行:503 `SMS_NOT_CONFIGURED` / 429 `SMS_RATE_LIMITED`(FREQUENCY_FAIL)/ 429 `SMS_DAY_LIMITED`(BUSINESS_LIMIT_CONTROL)/ 503 `SMS_PROVIDER_ERROR`(key 失效/签名错)/ 500 `SMS_SEND_FAILED`);§3 零依赖手写 RPC 签名(公共参数 + RFC3986 + 排序 + `GET&%2F&…` + HMAC-SHA1(secret+'&') + base64;`TemplateParam={"code":"6位码"}` 直接传值 + 不用 `##code##`/`CheckSmsVerifyCode` 的取舍);§4 重试(仅网络错误重试 1 次 ~500ms,业务错误不重试);§5 环境变量 4 条 `ALIYUN_*`(签名=系统赠送不支持自定义;未配置 → 503);§6 开通步骤 + 按条计费说明;§7 密钥纪律(同 tech/25 §7);§8 provider 拆分表;§9 备注(migration 005 注释已成事实,迁移不可变)
- `tech/14-api-contract.md` → 第 25 行 phone 行改写:demo stub 表述删除,改为阿里云短信认证服务真发(`{ ok, provider, expiresAt, requestId }` + 4 条 env + 错误映射/重试见 tech/26-aliyun-sms.md);email 行保持指向 tech/25
- `tech/README.md` → 索引表 25 行下顺位新增 `26-aliyun-sms.md` 行(仿 25 行格式)
- `tech/roles/development/deferred-ledger.md` → D-04:状态 PARTIAL → **CLOSED**(2026-08-22 aliyun-sms 批:phone 经阿里云短信认证服务真发,demo hint 已删除),来源批次补 `20260822-aliyun-sms-otp`,执行条件改为「遗留 Env-only:用户配置真实 `ALIYUN_*` 值 + 真实冒烟,见批次 deferred-notes」,内容列「仍在」改为「已删除」史实表述;新增 D-29 Env-only 行(用户配阿里云 key + 冒烟,镜像 D-28 格式)
- `tech/25-resend-email.md` → §1 现状 bullet 改为 phone 阿里云真发(引用 tech/26);§1 动机段补「phone 桩已于 2026-08-22 接入」;§1 客户端 bullet 补「后端已删除 demo/hint 字段」;**§2 端点契约表 phone 行**同步改为阿里云真发(见「遇到的问题」#3);§5 补「phone 走阿里云短信,见 tech/26」;§8 provider 拆分表 phone 行 → 阿里云真发(2026-08-22),「接入真实短信服务商后删除 demo hint」余项 → 已删除

## 门禁结果

- `make docs-check`:通过(Documentation policy check passed;grep 命中仅剩历史快照,非本 WS 新增)
- `git diff --check`:通过(提交后无残留 diff)

## 遇到的问题

1. **D-04 状态 token 用字面 `CLOSED`**:prompt 契约写死「PARTIAL → CLOSED」,但 deferred-ledger 图例行(表头下方)定义的已闭环 token 为 `DONE-记录`,全账本既有闭环行(D-22/23/25/26)均用 `DONE-记录`。按 prompt 契约用了字面 **CLOSED**,图例未动 → 若 boss 希望账本词表一致,可改回 `DONE-记录` 或补图例(一行改动,待裁决)
2. **tech/26 错误映射表 message 文案为推断**:契约只写死 code/HTTP 映射,message 文案未给死;按 tech/25 对应 code 的风格填(`SMS_DAY_LIMITED` 为新增文案「今日发送次数已达上限,请明天再试」)→ 若 ws-1 实现文案不同,以代码为准(报告如实记录,未臆造为事实)
3. **tech/25 §2 端点契约表顺带更新**:prompt 列的同步范围是 §1/§5/§8,但 §2 成功分支表 phone 行同样是 demo 桩表述;不更新会与 tech/26 §2 直接矛盾,故一并改为阿里云真发(超出清单一处,同属「phone demo 表述」清理)
4. **历史记录未动**:`quality-scans/20260819-all`、历史 `parallel-sessions/*`(如 20260820-boss-optimize deferred-notes D-04 行)仍含 `000000`/demo 桩表述 —— 属当时快照且不在本 WS 拥有范围,未改

## 证据

- 5 个 commit(小步,Conventional Commits):
  - `752baeb docs(auth): 新建 tech/26-aliyun-sms.md(...)`
  - `b67ec9a docs(auth): tech/14 契约 phone OTP 行改为阿里云真发`
  - `f1bdf7f docs(tech): README 索引补充 26-aliyun-sms.md`
  - `af27d05 docs(auth): tech/25 同步 phone 阿里云真发表述(§1/§2/§5/§8)`
  - `750472c docs(auth): deferred-ledger D-04 关闭并登记 D-29(阿里云 key + 冒烟)`
- 门禁输出:`Documentation policy check passed.` + `git diff --check` 无输出
- 校验:grep 复查 `demo: true`/`hint: '000000'`/`demo 桩` 仅剩 tech/26 §1(历史对比表述)与 tech/25 §1(动机段已注「已接入」)及历史快照文件

门禁: PASSED
结论: OK
