# Deferred Notes — 20260822-aliyun-sms-otp

| 类型 | 内容 |
|---|---|
| Env-only | 用户需在阿里云控制台**开通「短信认证服务」(dypnsapi)** → 获取**系统赠送签名 + 赠送模板 CODE**(仅限系统赠送,不支持自定义签名)→ RAM 创建 AccessKey(授权 `dypns:SendSmsVerifyCode`)→ 写入 `server/.env.local`:`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE`。未配置时发送接口 503 `SMS_NOT_CONFIGURED` 优雅降级,不影响其他功能 |
| Env-only | **真实短信冒烟 ✅ 完成(2026-08-24)**:用户配好真 key 后实测「发码 → 收短信 → 输入验证码 → 登录」全流程通过;过程中实测确认赠送模板为 {code, min} 双变量(原实现只传 code → `isv.INVALID_PARAMETERS`),客户端已补 `min`(commit 07dc34b);TTL 口径拍板 `ALIYUN_SMS_TEMPLATE_MINUTES=10` 对齐本地 10 分钟 |
| 口径 | 短信「N 分钟内有效」的 N 由 `ALIYUN_SMS_TEMPLATE_MINUTES` 控制(缺省 5),本地 `auth_otp_challenges` TTL 为 **10 分钟**;**2026-08-24 用户拍板:设 `ALIYUN_SMS_TEMPLATE_MINUTES=10` 对齐本地,零代码改动,已生效** |
| 说明 | 前端零改动:phone tab 已是默认 tab,只读 `res.ok` / `body.message`;后端删除 `demo` / `hint` 字段不破坏客户端。`db/migrations/005` 注释「Production send goes through Aliyun SMS (PNvs)」本批实现后成为事实(迁移文件不可变,不改) |
