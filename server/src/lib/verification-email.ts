// ============================================================
// 验证码邮件模板(Resend 发送用)
//
// 全部内联 CSS + table 布局:主流邮件客户端会剥离 <style>,样式必须逐元素内联。
// 只插值 code 与 expiresAt 两个字段,**无任何用户输入插值**
// (target 等用户数据绝不进模板,防邮件注入)。
// 浅色卡片风格:蓝顶条 + JobMap 字标 + 登录验证码大字 + 高亮验证码块,
// 含 10 分钟有效期 / 请勿泄露 / 非本人操作可忽略 / 自动发送说明。
// ============================================================

export const EMAIL_SUBJECT = 'JobMap登录验证码';
export const EMAIL_FROM = 'contact@nvc.ac';

const FONT_FAMILY =
  "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif";

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
            <td style="height:4px;line-height:4px;font-size:0;background-color:#007aff;border-radius:12px 12px 0 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:24px 28px 24px 28px;">
              <p style="margin:0 0 20px 0;padding-bottom:16px;border-bottom:1px solid #e5e7eb;font-family:${FONT_FAMILY};font-size:16px;font-weight:600;color:#1c1c1e;">JobMap</p>
              <p style="margin:0 0 12px 0;font-family:${FONT_FAMILY};font-size:20px;font-weight:700;color:#1c1c1e;">登录验证码</p>
              <p style="margin:0 0 20px 0;font-family:${FONT_FAMILY};font-size:14px;color:#6e6e73;">请在登录页面输入以下验证码:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="padding:16px 20px;background-color:rgba(0,122,255,0.08);border:1px solid rgba(0,122,255,0.25);border-radius:12px;">
                    <p style="margin:0 0 6px 0;font-family:${FONT_FAMILY};font-size:12px;font-weight:600;color:#007aff;">6 位验证码</p>
                    <p style="margin:0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#007aff;">${code}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-family:${FONT_FAMILY};font-size:13px;color:#6e6e73;">验证码 <span style="font-weight:600;">${expiresText}</span> 前有效(10 分钟)</p>
              <p style="margin:0;font-family:${FONT_FAMILY};font-size:13px;color:#8e8e93;">请勿泄露给他人。若非本人操作,请忽略本邮件。</p>
              <p style="margin:20px 0 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-family:${FONT_FAMILY};font-size:12px;color:#8e8e93;">本邮件由系统自动发送,请勿直接回复。</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** 纯文本 fallback:同一事实(验证码 + 10 分钟提示),行结构同 html。 */
export function buildVerificationEmailText(code: string, expiresAt: number): string {
  const expiresText = new Date(expiresAt).toLocaleString('zh-CN');
  return `【JobMap登录验证码】

请在登录页面输入以下验证码:

${code}

验证码 ${expiresText} 前有效(10 分钟)
请勿泄露给他人。若非本人操作,请忽略本邮件。

本邮件由系统自动发送,请勿直接回复。`;
}
