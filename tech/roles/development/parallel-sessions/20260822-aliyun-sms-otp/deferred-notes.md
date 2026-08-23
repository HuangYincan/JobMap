# Deferred Notes — 20260822-aliyun-sms-otp

| 类型 | 内容 |
|---|---|
| Env-only | 用户需在阿里云控制台**开通「短信认证服务」(dypnsapi)** → 获取**系统赠送签名 + 赠送模板 CODE**(仅限系统赠送,不支持自定义签名)→ RAM 创建 AccessKey(授权 `dypns:SendSmsVerifyCode`)→ 写入 `server/.env.local`:`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE`。未配置时发送接口 503 `SMS_NOT_CONFIGURED` 优雅降级,不影响其他功能 |
| Env-only | **真实短信冒烟**:配好真 key 后用测试手机号走「发码 → 收短信 → 输入验证码 → 登录」全流程;确认赠送模板文案与参数名 `code` 匹配(模板参数名若不同,`TemplateParam` 键名需对应用户模板,由用户告知) |
| 口径 | 赠送模板文案若为「5 分钟内有效」,而本地 `auth_otp_challenges` TTL 为 **10 分钟**:是否把本地 TTL 对齐到 300s 由用户拍板(改动 `session-store.ts` / `account-store.ts` 常量,不在本批) |
| 说明 | 前端零改动:phone tab 已是默认 tab,只读 `res.ok` / `body.message`;后端删除 `demo` / `hint` 字段不破坏客户端。`db/migrations/005` 注释「Production send goes through Aliyun SMS (PNvs)」本批实现后成为事实(迁移文件不可变,不改) |
