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

type AuthTab = "phone" | "email" | "github";

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

  const provider: AuthProvider = tab === "github" ? "github" : tab;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, target }),
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

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, target, code }),
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

  const github = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/github", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "github failed");
      onSignedIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "github failed");
    } finally {
      setBusy(false);
    }
  };

  return (
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
        <h2 id={titleId} className={styles.title}>{t("signInTitle", lang)}</h2>
        <p className={styles.lead}>{t("signInLead", lang)}</p>

        <div className={styles.tabs} role="tablist">
          {(["phone", "email", "github"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
              onClick={() => {
                setTab(id);
                setError(null);
                setSent(false);
                setCode("");
              }}
            >
              {id === "phone" ? t("authPhone", lang) : id === "email" ? t("authEmail", lang) : t("authGithub", lang)}
            </button>
          ))}
        </div>

        {tab === "github" ? (
          <button type="button" className={styles.primary} disabled={busy} onClick={github}>
            {t("continueGithub", lang)}
          </button>
        ) : (
          <>
            <label className={styles.field}>
              <span>{tab === "phone" ? t("phoneNumber", lang) : t("emailAddress", lang)}</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode={tab === "phone" ? "tel" : "email"}
                autoComplete={tab === "phone" ? "tel" : "email"}
                placeholder={tab === "phone" ? "+86 13800000000" : "you@example.com"}
              />
            </label>
            {sent && (
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
            )}
            {!sent ? (
              <button type="button" className={styles.primary} disabled={busy || !target.trim()} onClick={sendCode}>
                {t("sendCode", lang)}
              </button>
            ) : (
              <button type="button" className={styles.primary} disabled={busy || !code.trim()} onClick={verify}>
                {t("verifyCode", lang)}
              </button>
            )}
            <p className={styles.hint}>{t("otpDemoHint", lang)}</p>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
