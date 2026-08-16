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

type AuthTab = "phone" | "email" | "other";
type SocialProvider = Extract<AuthProvider, "github" | "google" | "x" | "wechat">;

const SOCIAL: { id: SocialProvider; labelKey: "authGithub" | "authGoogle" | "authX" | "authWechat" }[] = [
  { id: "github", labelKey: "authGithub" },
  { id: "google", labelKey: "authGoogle" },
  { id: "x", labelKey: "authX" },
  { id: "wechat", labelKey: "authWechat" },
];

export function AuthModal({ open, lang, onClose, onSignedIn }: AuthModalProps) {
  const titleId = useId();
  const [tab, setTab] = useState<AuthTab>("phone");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setBusy(false);
      setError(null);
    }
  }, [open]);

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

  return (
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
            {(["phone", "email", "other"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`${styles.method} ${tab === id ? styles.methodActive : ""}`}
                onClick={() => {
                  setTab(id);
                  setError(null);
                  setSent(false);
                  setCode("");
                }}
              >
                {id === "phone" ? t("authPhone", lang) : id === "email" ? t("authEmail", lang) : t("authOther", lang)}
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
                  disabled={busy}
                  onClick={() => social(item.id)}
                >
                  {t(item.labelKey, lang)}
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
                    disabled={busy || !target.trim()}
                    onClick={sendCode}
                  >
                    {sent ? t("resendCode", lang) : t("sendCode", lang)}
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
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
