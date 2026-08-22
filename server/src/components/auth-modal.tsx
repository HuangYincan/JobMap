"use client";

import { useEffect, useId, useState } from "react";
import type { AuthProvider } from "@/lib/account";
import { t, type Language } from "@/lib/i18n";
import styles from "./auth-modal.module.css";

export interface AuthModalProps {
  open: boolean;
  lang: Language;
  onClose: () => void;
  onSignedIn: () => void;
  /** OAuth 回调错误码(oauth_state_invalid / oauth_provider_error):打开时显示在现有 error 行 */
  initialError?: string | null;
}

type AuthTab = "phone" | "email" | "password" | "other";
type PasswordMode = "login" | "register";
type SocialProvider = Extract<AuthProvider, "github" | "google" | "wechat">;

const SOCIAL: { id: SocialProvider; labelKey: "authGithub" | "authGoogle" | "authWechat" }[] = [
  { id: "github", labelKey: "authGithub" },
  { id: "google", labelKey: "authGoogle" },
  { id: "wechat", labelKey: "authWechat" },
];

// 发送冷却(秒):与后端 otpRateConfig.cooldownMs = 60s 对齐,客户端禁用防连点
const RESEND_COOLDOWN_SECONDS = 60;

// OAuth 回调错误码 → i18n key(未知码回退通用文案)
function oauthErrorKey(
  code: string,
): "authOauthError" | "authOauthStateInvalid" | "authOauthProviderError" {
  if (code === "oauth_state_invalid") return "authOauthStateInvalid";
  if (code === "oauth_provider_error") return "authOauthProviderError";
  return "authOauthError";
}

function SocialIcon({ id }: { id: SocialProvider }) {
  if (id === "github") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.04 1.53 1.04.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.86v2.76c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"
        />
      </svg>
    );
  }
  if (id === "google") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.74-.07-1.45-.19-2.13H12v4.04h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.43Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.34l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.99A6 6 0 0 1 6.1 12c0-.69.12-1.36.31-1.99V7.43H3.07A10 10 0 0 0 2 12c0 1.62.39 3.15 1.07 4.57l3.34-2.58Z" />
        <path fill="#EA4335" d="M12 5.88c1.47 0 2.79.5 3.82 1.5l2.87-2.87C16.95 2.9 14.7 2 12 2A10 10 0 0 0 3.07 7.43l3.34 2.58C7.2 7.64 9.4 5.88 12 5.88Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#07C160"
        d="M9.5 4.2c-4.4 0-8 2.9-8 6.5 0 2.1 1.2 4 3.1 5.2l-.8 2.4 2.7-1.4c.8.2 1.6.4 2.5.4.3 0 .6 0 .9-.1-.2-.6-.3-1.2-.3-1.8 0-3.5 3.3-6.4 7.4-6.4.3 0 .7 0 1 .1C16.9 6.3 13.5 4.2 9.5 4.2Zm-2 4.1a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm4.2 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm10.3 5.1c0-2.9-3-5.3-6.6-5.3s-6.6 2.4-6.6 5.3 3 5.3 6.6 5.3c.7 0 1.3-.1 1.9-.2l2.2 1.1-.6-1.9c1.9-1 3.1-2.6 3.1-4.3Zm-8.6-.8a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"
      />
    </svg>
  );
}

export function AuthModal({ open, lang, onClose, onSignedIn, initialError }: AuthModalProps) {
  const titleId = useId();
  const [tab, setTab] = useState<AuthTab>("phone");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdMode, setPwdMode] = useState<PasswordMode>("login");
  /** 注册后绑定引导:password 注册成功 → 弹窗内引导绑定手机/邮箱(OTP 验证,可跳过) */
  const [bindGuide, setBindGuide] = useState(false);
  const [bindTarget, setBindTarget] = useState<"phone" | "email" | null>(null);
  const [bindValue, setBindValue] = useState("");
  const [bindCode, setBindCode] = useState("");
  const [bindSent, setBindSent] = useState(false);
  const [bindResendIn, setBindResendIn] = useState(0);
  /** OAuth provider 配置探测结果(null = 未加载/失败) */
  const [providers, setProviders] = useState<{ id: string; configured: boolean }[] | null>(null);

  const resetPasswordForm = () => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setPwdMode("login");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setTab("phone");
      setTarget("");
      setCode("");
      setSent(false);
      setResendIn(0);
      setNotice(null);
      setBusy(false);
      setError(null);
      resetPasswordForm();
      setBindGuide(false);
      setBindTarget(null);
      setBindValue("");
      setBindCode("");
      setBindSent(false);
      setBindResendIn(0);
    }
  }, [open]);

  // 发送倒计时:resendIn > 0 时每秒递减,归零自动停表
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0]);

  // 绑定引导发送倒计时:与 resendIn 同模式(绑定表单独立 state,避免与 OTP tab 串扰)
  useEffect(() => {
    if (bindResendIn <= 0) return;
    const timer = setInterval(() => setBindResendIn((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [bindResendIn > 0]);

  // OAuth provider 配置探测:modal 打开时拉一次(不重试),失败静默置 null,不影响 UI
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/auth/oauth/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setProviders(
          Array.isArray(body?.providers)
            ? (body.providers as { id: string; configured: boolean }[])
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setProviders(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // OAuth 回调错误:打开时若带 initialError,映射 i18n 后复用现有 error 行展示
  useEffect(() => {
    if (!open) return;
    setError(initialError ? t(oauthErrorKey(initialError), lang) : null);
  }, [open, initialError, lang]);

  // 顶部气泡:2.6s 后自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!open) return null;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: tab, target }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "send failed");
      setSent(true);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice(t(tab === "email" ? "sendCodeSuccessEmail" : "sendCodeSuccess", lang));
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: tab, target, code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "verify failed");
      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "verify failed");
    } finally {
      setBusy(false);
    }
  };

  const social = async (provider: SocialProvider) => {
    // 已配置(或探测尚未完成/失败——宁可走真实流程也不误登 demo 账号)→ 全页跳转真实 OAuth
    const configured = providers?.find((p) => p.id === provider)?.configured;
    if (configured !== false) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/api/auth/oauth/start?provider=${provider}&next=${next}`;
      return;
    }
    // 未配置 → 保持原 demo POST /api/auth/oauth(零改动路径)
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "oauth failed");
      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "oauth failed");
    } finally {
      setBusy(false);
    }
  };

  const describeError = (code: string | undefined, fallback: string): string => {
    switch (code) {
      case "USERNAME_TAKEN":
        return t("usernameTaken", lang);
      case "INVALID_CREDENTIALS":
        return t("invalidCredentials", lang);
      case "PASSWORD_TOO_SHORT":
        return t("passwordTooShort", lang);
      case "PASSWORD_MISMATCH":
        return t("passwordMismatch", lang);
      case "INVALID_USERNAME":
        return t("usernameInvalid", lang);
      default:
        return fallback;
    }
  };

  /** 绑定引导错误码 → i18n key(与 account-panel contactErrorKey 同一映射表) */
  const bindErrorKey = (
    code: string | undefined,
    kind: "phone" | "email",
  ): "takenPhone" | "takenEmail" | "codeInvalid" | "securityFailed" => {
    if (code === "PHONE_TAKEN" && kind === "phone") return "takenPhone";
    if (code === "EMAIL_TAKEN" && kind === "email") return "takenEmail";
    if (code === "INVALID_CODE") return "codeInvalid";
    return "securityFailed";
  };

  const passwordSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(describeError(body?.code, body?.message || "login failed"));
      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setBusy(false);
    }
  };

  const passwordRegister = async () => {
    if (password.length < 8) {
      setError(t("passwordTooShort", lang));
      return;
    }
    if (confirmPassword !== password) {
      setError(t("passwordMismatch", lang));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, confirmPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(describeError(body?.code, body?.message || "register failed"));
      onSignedIn();
      // 注册成功不立即关弹窗 → 进入绑定引导 step(可跳过;登录态已建立)
      setBindGuide(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "register failed");
    } finally {
      setBusy(false);
    }
  };

  /** 绑定引导:发送验证码到所选凭证(复用 POST /api/auth/otp/send,60s 冷却与 OTP tab 同模式) */
  const bindSendCode = async () => {
    if (!bindTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: bindTarget, target: bindValue.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "send failed");
      setBindSent(true);
      setBindResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice(t(bindTarget === "email" ? "sendCodeSuccessEmail" : "sendCodeSuccess", lang));
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  /** 绑定引导:完成绑定 → POST /api/auth/me/phone|email。成功:短 toast「绑定成功」→ 关闭弹窗 */
  const bindNow = async () => {
    if (!bindTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(bindTarget === "phone" ? "/api/auth/me/phone" : "/api/auth/me/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bindTarget === "phone"
            ? { phone: bindValue.trim(), code: bindCode.trim() }
            : { email: bindValue.trim(), code: bindCode.trim() },
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(t(bindErrorKey(body?.code, bindTarget), lang));
      setNotice(t("bindSuccess", lang));
      setTimeout(onClose, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : "bind failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {notice && (
        <div className={styles.topToast} role="status">
          {notice}
        </div>
      )}
      <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.orbA} aria-hidden="true" />
      <div className={styles.orbB} aria-hidden="true" />
      <div className={styles.orbC} aria-hidden="true" />
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("closeAuth", lang)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <aside className={styles.promo} aria-hidden="true">
          <div className={styles.promoGlass}>
            <div className={styles.mark}>DM</div>
            <p className={styles.promoName}>Domain Map</p>
          </div>
        </aside>

        <div className={styles.form}>
          {bindGuide ? (
            <div className={styles.bindGuide}>
              <h2 id={titleId} className={styles.bindTitle}>
                {t("welcomeBindTitle", lang)}
              </h2>
              <p className={styles.bindHint}>{t("bindGuideHint", lang)}</p>
              <div className={styles.bindCards} role="group" aria-label={t("targetLabel", lang)}>
                <button
                  type="button"
                  className={`${styles.bindCard} ${bindTarget === "phone" ? styles.bindCardActive : ""}`}
                  onClick={() => setBindTarget("phone")}
                >
                  <span aria-hidden="true">📱</span> {t("bindPhone", lang)}
                </button>
                <button
                  type="button"
                  className={`${styles.bindCard} ${bindTarget === "email" ? styles.bindCardActive : ""}`}
                  onClick={() => setBindTarget("email")}
                >
                  <span aria-hidden="true">✉️</span> {t("bindEmail", lang)}
                </button>
              </div>
              {bindTarget && (
                <>
                  <label className={styles.field}>
                    <span>{t(bindTarget === "phone" ? "phoneNumber" : "emailAddress", lang)}</span>
                    <div className={styles.inputShell}>
                      <input
                        value={bindValue}
                        onChange={(e) => setBindValue(e.target.value)}
                        inputMode={bindTarget === "phone" ? "tel" : "email"}
                        autoComplete={bindTarget === "phone" ? "tel" : "email"}
                        placeholder={
                          bindTarget === "phone"
                            ? t("phonePlaceholder", lang)
                            : t("emailPlaceholder", lang)
                        }
                      />
                      <button
                        type="button"
                        className={styles.inlineSend}
                        disabled={busy || !bindValue.trim() || bindResendIn > 0}
                        onClick={bindSendCode}
                      >
                        {bindResendIn > 0
                          ? t("resendInSeconds", lang).replace("{s}", String(bindResendIn))
                          : bindSent
                            ? t("resendCode", lang)
                            : t("sendCode", lang)}
                      </button>
                    </div>
                  </label>
                  <label className={styles.field}>
                    <span>{t("verifyCode", lang)}</span>
                    <input
                      value={bindCode}
                      onChange={(e) => setBindCode(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder={t("otpCodePlaceholder", lang)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.bindDone}
                    disabled={busy || !bindValue.trim() || !bindCode.trim()}
                    onClick={bindNow}
                  >
                    {t("bindDone", lang)}
                  </button>
                </>
              )}
              <button type="button" className={styles.skipBind} onClick={onClose}>
                {t("skipBind", lang)}
              </button>
              {error && <p className={styles.error}>{error}</p>}
            </div>
          ) : (
            <>
          <nav className={styles.methods} aria-label={t("authMethods", lang)}>
            {(["phone", "email", "password", "other"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`${styles.method} ${tab === id ? styles.methodActive : ""}`}
                onClick={() => {
                  setTab(id);
                  setError(null);
                  setSent(false);
                  setResendIn(0);
                  setNotice(null);
                  setCode("");
                  resetPasswordForm();
                }}
              >
                {id === "phone"
                  ? t("authPhone", lang)
                  : id === "email"
                    ? t("authEmail", lang)
                    : id === "password"
                      ? t("authPassword", lang)
                      : t("authOther", lang)}
              </button>
            ))}
          </nav>
          <h2 id={titleId} className={styles.srOnly}>{t("signIn", lang)}</h2>

          {tab === "password" ? (
            <>
              <label className={styles.field}>
                <span>{pwdMode === "login" ? t("loginIdOrEmail", lang) : t("usernameLabel", lang)}</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={pwdMode === "login" ? t("loginIdOrEmail", lang) : t("usernamePlaceholder", lang)}
                />
              </label>
              <label className={styles.field}>
                <span>{t("passwordLabel", lang)}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={pwdMode === "login" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                />
              </label>
              {pwdMode === "register" && (
                <label className={styles.field}>
                  <span>{t("confirmPassword", lang)}</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
              )}
              <button
                type="button"
                className={styles.login}
                disabled={
                  busy ||
                  !username.trim() ||
                  !password ||
                  (pwdMode === "register" && !confirmPassword)
                }
                onClick={pwdMode === "login" ? passwordSignIn : passwordRegister}
              >
                {pwdMode === "login" ? t("signIn", lang) : t("register", lang)}
              </button>
              <div className={styles.authSwitchRow}>
                <span>
                  {pwdMode === "login" ? t("noAccountRegister", lang) : t("hasAccountLogin", lang)}
                </span>
                <button
                  type="button"
                  className={styles.authSwitchLink}
                  onClick={() => {
                    setPwdMode(pwdMode === "login" ? "register" : "login");
                    setError(null);
                  }}
                >
                  {pwdMode === "login" ? t("registerLink", lang) : t("loginLink", lang)}
                </button>
              </div>
              {pwdMode === "login" && (
                <p className={styles.pwdLoginHint}>{t("pwdLoginHint", lang)}</p>
              )}
            </>
          ) : tab === "other" ? (
            <div className={styles.socialGrid}>
              {SOCIAL.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.social}
                  disabled={busy}
                  onClick={() => social(item.id)}
                >
                  <SocialIcon id={item.id} />
                  <span>{t(item.labelKey, lang)}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <label className={styles.field}>
                <span>{tab === "phone" ? t("phoneNumber", lang) : t("emailAddress", lang)}</span>
                <div className={styles.inputShell}>
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    inputMode={tab === "phone" ? "tel" : "email"}
                    autoComplete={tab === "phone" ? "tel" : "email"}
                    placeholder={
                      tab === "phone" ? t("phonePlaceholder", lang) : t("emailPlaceholder", lang)
                    }
                  />
                  <button
                    type="button"
                    className={styles.inlineSend}
                    disabled={busy || !target.trim() || resendIn > 0}
                    onClick={sendCode}
                  >
                    {resendIn > 0
                      ? t("resendInSeconds", lang).replace("{s}", String(resendIn))
                      : sent
                        ? t("resendCode", lang)
                        : t("sendCode", lang)}
                  </button>
                </div>
              </label>
              <label className={styles.field}>
                <span>{t("otpCode", lang)}</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("otpCodePlaceholder", lang)}
                />
              </label>
              <button
                type="button"
                className={styles.login}
                disabled={busy || !target.trim() || !code.trim()}
                onClick={signIn}
              >
                {t("signIn", lang)}
              </button>
              <p className={styles.autoRegisterHint}>{t("autoRegisterHint", lang)}</p>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
