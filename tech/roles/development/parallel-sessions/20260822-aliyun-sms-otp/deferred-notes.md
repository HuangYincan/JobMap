# Deferred Notes — 20260822-aliyun-sms-otp

| 类型 | 内容 |
|---|---|
| Env-only | 用户需在阿里云控制台**开通「短信认证服务」(dypnsapi)** → 获取**系统赠送签名 + 赠送模板 CODE**(仅限系统赠送,不支持自定义签名)→ RAM 创建 AccessKey(授权 `dypns:SendSmsVerifyCode`)→ 写入 `server/.env.local`:`ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE`。未配置时发送接口 503 `SMS_NOT_CONFIGURED` 优雅降级,不影响其他功能 |
| Env-only | **真实短信冒烟**:配好真 key 后用测试手机号走「发码 → 收短信 → 输入验证码 → 登录」全流程;**2026-08-24 实测完成参数修正** —— 赠送模板为 {code, min} 双变量,原实现只传 code 导致 `isv.INVALID_PARAMETERS`(模版变量min内容非法),客户端已补 `min`(新可选 env `ALIYUN_SMS_TEMPLATE_MINUTES`,缺省 5);冒烟确认待用户在真机收码后关闭 |
| 口径 | 短信「N 分钟内有效」的 N 现由 `ALIYUN_SMS_TEMPLATE_MINUTES` 控制(缺省 5),而本地 `auth_otp_challenges` TTL 为 **10 分钟**:对齐方案由用户拍板 —— 设 `ALIYUN_SMS_TEMPLATE_MINUTES=10`(短信与本地一致,零代码)或改本地 TTL 常量(`session-store.ts` / `account-store.ts`,不在本批) |
| 说明 | 前端零改动:phone tab 已是默认 tab,只读 `res.ok` / `body.message`;后端删除 `demo` / `hint` 字段不破坏客户端。`db/migrations/005` 注释「Production send goes through Aliyun SMS (PNvs)」本批实现后成为事实(迁移文件不可变,不改) |
