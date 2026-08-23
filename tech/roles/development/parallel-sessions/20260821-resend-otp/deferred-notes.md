# Deferred Notes — 20260821-resend-otp

> 需用户决策/操作的项目,任务完成后统一告知。类型:UI设计 / Env-only / 其他。

## 本批次 deferred(不自动执行)

| 时间 | 类型 | 内容 |
|---|---|---|
| 2026-08-21 | Env-only | **RESEND_API_KEY 真值**:用户需自行把真实 key 写入 `server/.env.local`(`RESEND_API_KEY=...`),批次绝不触碰该文件、不打印密钥 |
| 2026-08-21 | Env-only | **真实发信冒烟**:需 key;用户配好后手动验证(邮箱 tab 发码 → 收信 → 登录)。worker 门禁仅单元测试 + 假 fetch |
| 2026-08-21 | 其他 | **发件域核实**:`contact@nvc.ac` 在 Resend 的发件域需已验证(用户声明已验证);真发时以收信为准。垃圾箱预案见 `tech/25-resend-email.md` |
| 2026-08-21 | 其他 | 邮件若落入垃圾箱:按 tech/25 预案处理(检查发件域 SPF/DKIM 配置) |

## 关联既有账目

- `tech/roles/development/deferred-ledger.md` 行 **D-04**("真实 OTP 发送… demo 固定码 000000 + hint 回显仍在…"):本批次使其部分落地——email 真发、demo hint 仅剩 phone;由 worker 更新该行状态,剩余部分(phone SMS 发送)仍待用户拍板
