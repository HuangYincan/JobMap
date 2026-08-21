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

export function AuthModal({ open, lang, onClose, onSignedIn }: AuthModalProps) {
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
    }
  }, [open]);

  // 发送倒计时:resendIn > 0 时每秒递减,归零自动停表
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0]);

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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "register failed");
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
                <span>{t("usernameLabel", lang)}</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={t("usernamePlaceholder", lang)}
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
                    placeholder={tab === "phone" ? "+86 13800000000" : "you@example.com"}
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
                  placeholder="000000"
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
        </div>
      </div>
    </div>
    </>
  );
}
