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

type AuthTab = "phone" | "email" | "other";
type SocialProvider = Extract<AuthProvider, "github" | "google" | "wechat">;

// 灰度期禁用 google/wechat(用户授权 2026-08-24,deferred-notes #UI-001):
// 按钮置灰不可点(图标保留),API 层 /api/auth/oauth* 不动,仅前端入口关闭
const SOCIAL: {
  id: SocialProvider;
  labelKey: "authGithub" | "authGoogle" | "authWechat";
  disabled?: boolean;
}[] = [
  { id: "github", labelKey: "authGithub" },
  { id: "google", labelKey: "authGoogle", disabled: true },
  { id: "wechat", labelKey: "authWechat", disabled: true },
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

function DomainMapArtwork() {
  return (
    <svg
      className={styles.brandArt}
      viewBox="0 0 360 360"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="brandSurface" x1="42" y1="28" x2="318" y2="338" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1E5B7D" />
          <stop offset="0.52" stopColor="#123F5C" />
          <stop offset="1" stopColor="#0A293E" />
        </linearGradient>
        <linearGradient id="brandRoute" x1="54" y1="264" x2="286" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A6F1D2" />
          <stop offset="0.5" stopColor="#62D9F4" />
          <stop offset="1" stopColor="#D8FBFF" />
        </linearGradient>
        <linearGradient id="brandPin" x1="-22" y1="-26" x2="24" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D9FCFF" />
          <stop offset="1" stopColor="#5EDAF1" />
        </linearGradient>
        <filter id="brandShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#061B2A" floodOpacity="0.34" />
        </filter>
        <clipPath id="brandClip">
          <rect x="22" y="22" width="316" height="316" rx="54" />
        </clipPath>
      </defs>

      <rect
        className={styles.brandSurface}
        x="22"
        y="22"
        width="316"
        height="316"
        rx="54"
        fill="url(#brandSurface)"
        stroke="#DDF8FF"
        strokeOpacity="0.28"
        filter="url(#brandShadow)"
      />

      <g clipPath="url(#brandClip)" opacity="0.9">
        <path
          className={styles.mapContour}
          d="M-20 104C38 78 82 86 124 64c42-22 86-42 144-18 42 17 73 10 112-12"
        />
        <path
          className={styles.mapContour}
          d="M-32 158c58-27 111-4 155-22 51-21 79-62 139-47 38 10 67 5 102-19"
        />
        <path
          className={styles.mapContour}
          d="M-28 238c46-22 85-18 128 2 37 17 83 7 113-17 31-25 62-32 118-6"
        />
        <path
          className={styles.mapContour}
          d="M-16 300c62-18 91-6 129-13 57-11 80-42 128-48 32-4 62 7 97 30"
        />
        <path className={styles.mapRoad} d="M42 12 168 350M146 4 266 354M286 12 124 350" />
        <path className={styles.mapRoad} d="m-12 198 348-96M-12 278l348-92" />
        <path className={styles.mapBoundary} d="M68 22c20 55 16 102 48 142 28 34 24 75 4 174" />
        <path className={styles.mapBoundary} d="M276 22c-28 34-37 68-25 102 16 46 0 92-35 118-24 18-33 52-27 96" />
        <circle className={styles.mapPoint} cx="76" cy="102" r="3" />
        <circle className={styles.mapPoint} cx="286" cy="236" r="3" />
        <circle className={styles.mapPoint} cx="118" cy="302" r="3" />
      </g>

      <path
        className={styles.routeHalo}
        d="M58 270c20-28 44-45 74-55 39-13 45-43 68-67 24-25 48-20 61-47 9-18 20-31 42-44"
        stroke="#6DE1F4"
        strokeOpacity="0.22"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <path
        className={styles.route}
        d="M58 270c20-28 44-45 74-55 39-13 45-43 68-67 24-25 48-20 61-47 9-18 20-31 42-44"
        stroke="url(#brandRoute)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="18 11"
      />

      <g className={styles.routeNodeOne}>
        <circle cx="58" cy="270" r="10" fill="#A6F1D2" fillOpacity="0.2" />
        <circle cx="58" cy="270" r="4.5" fill="#F3FFFB" />
      </g>
      <g className={styles.routeNodeTwo}>
        <circle cx="132" cy="215" r="8" fill="#66DDF3" fillOpacity="0.2" />
        <circle cx="132" cy="215" r="3.5" fill="#D8FBFF" />
      </g>
      <g className={styles.routeNodeThree}>
        <circle cx="200" cy="148" r="8" fill="#66DDF3" fillOpacity="0.2" />
        <circle cx="200" cy="148" r="3.5" fill="#D8FBFF" />
      </g>

      <g transform="translate(303 57)">
        <circle className={styles.signalDot} r="4" fill="#A6F1D2" />
        <circle className={styles.signalRing} r="12" stroke="#A6F1D2" strokeOpacity="0.32" />
      </g>

      <g transform="translate(245 103)">
        <circle className={styles.focusRing} r="43" stroke="#D8FBFF" strokeOpacity="0.22" />
        <g className={styles.focusMarker}>
          <path
            d="M0-31c-18 0-32 14-32 31 0 24 32 51 32 51S32 24 32 0c0-17-14-31-32-31Z"
            fill="url(#brandPin)"
            stroke="#F3FFFF"
            strokeOpacity="0.8"
          />
          <circle r="10" fill="#123F5C" />
          <circle r="4" fill="#E8FFFF" />
        </g>
      </g>

      <path className={styles.crosshair} d="M245 45v18M245 143v18M187 103h18M285 103h18" />
      <circle className={styles.crosshairCore} cx="245" cy="103" r="3" fill="#F3FFFF" />
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
  /** OAuth provider 配置探测结果(null = 未加载/失败) */
  const [providers, setProviders] = useState<{ id: string; configured: boolean }[] | null>(null);

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
    }
  }, [open]);

  // 发送倒计时:resendIn > 0 时每秒递减,归零自动停表
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((v) => (v > 1 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0]);

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
    if (tab !== "phone" && tab !== "email") return;
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
    if (tab !== "phone" && tab !== "email") return;
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

  return (
    <>
      {notice && (
        <div className={styles.topToast} role="status">
          {notice}
        </div>
      )}
      <div className={styles.overlay} onClick={onClose} role="presentation">
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
          <DomainMapArtwork />
        </aside>

        <div className={styles.form}>
          <nav className={styles.methods} aria-label={t("authMethods", lang)}>
            {(["phone", "email", "other"] as const).map((id) => (
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
                }}
              >
                {id === "phone"
                  ? t("authPhone", lang)
                  : id === "email"
                    ? t("authEmail", lang)
                    : t("authOther", lang)}
              </button>
            ))}
          </nav>
          <h2 id={titleId} className={styles.srOnly}>{t("signIn", lang)}</h2>

          {tab === "other" ? (
            <div className={styles.socialGrid}>
              {SOCIAL.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.social}
                  disabled={busy || item.disabled}
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
        </div>
      </div>
    </div>
    </>
  );
}
