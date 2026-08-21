// ============================================================
// 验证码邮件模板(Resend 发送用)
//
// 全部内联 CSS:主流邮件客户端会剥离 <style>,样式必须逐元素内联。
// 只插值 code 与 expiresAt 两个字段,**无任何用户输入插值**
// (target 等用户数据绝不进模板,防邮件注入)。
// 文案简洁中文:登录验证码 / 10 分钟有效期 / 请勿泄露 / 非本人操作可忽略。
// ============================================================

export const EMAIL_SUBJECT = '登录验证码';
export const EMAIL_FROM = 'contact@nvc.ac';

/** 浅色卡片风格 HTML:验证码大字(等宽 + 字距)独立卡片突出显示。 */
export function buildVerificationEmailHtml(code: string, expiresAt: number): string {
  const expiresText = new Date(expiresAt).toLocaleString('zh-CN');
  return `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background-color:#f2f3f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f3f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background-color:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:32px 28px 24px 28px;">
              <p style="margin:0 0 16px 0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:18px;font-weight:600;color:#1c1c1e;">登录验证码</p>
              <p style="margin:0 0 20px 0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;color:#6e6e73;">请在登录页面输入以下验证码:</p>
              <p style="margin:0 0 20px 0;text-align:center;padding:16px 0;background-color:#f5f7fa;border:1px solid #e5e7eb;border-radius:10px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#007aff;">${code}</p>
              <p style="margin:0 0 8px 0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;color:#6e6e73;">验证码 ${expiresText} 前有效(10 分钟),请勿泄露给他人。</p>
              <p style="margin:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;color:#8e8e93;">若非本人操作,请忽略本邮件。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** 纯文本 fallback:同一事实(验证码 + 10 分钟提示)。 */
export function buildVerificationEmailText(code: string, expiresAt: number): string {
  const expiresText = new Date(expiresAt).toLocaleString('zh-CN');
  return `【登录验证码】\n\n您的登录验证码是:${code}\n\n验证码 ${expiresText} 前有效(10 分钟),请勿泄露给他人。\n若非本人操作,请忽略本邮件。`;
}
