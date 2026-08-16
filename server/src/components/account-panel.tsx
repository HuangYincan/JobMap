"use client";

import { useState } from "react";
import type { AccountUser, UserPreferences } from "@/lib/account";
import { ACTIVE_MODES, getMode } from "@/lib/modes";
import { t, type Language } from "@/lib/i18n";
import type { MapMode } from "@/lib/types";
import styles from "./account-panel.module.css";

export type RailPanel = "explore" | "recent" | "profile" | null;

export interface ProfilePanelProps {
  user: AccountUser;
  lang: Language;
  onClose: () => void;
  onSave: (patch: {
    displayName?: string;
    preferences?: Partial<UserPreferences>;
  }) => Promise<void>;
  shifted?: boolean;
}

export function ProfilePanel({ user, lang, onClose, onSave, shifted = false }: ProfilePanelProps) {
  const [name, setName] = useState(user.displayName);
  const [prefs, setPrefs] = useState<UserPreferences>(user.preferences);
  const [openPref, setOpenPref] = useState<"language" | "defaultMode" | null>(null);
  const [busy, setBusy] = useState(false);

  const saveName = async () => {
    if (!name.trim() || name.trim() === user.displayName) return;
    setBusy(true);
    try {
      await onSave({ displayName: name.trim() });
    } finally {
      setBusy(false);
    }
  };

  const savePref = async (next: Partial<UserPreferences>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setBusy(true);
    try {
      await onSave({ preferences: next });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={styles.sidebar} aria-label={t("profile", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("profile", lang)}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", lang)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <section className={styles.identity}>
          {user.avatarUrl ? (
            <img className={styles.avatar} src={user.avatarUrl} alt="" />
          ) : (
            <div className={styles.avatarFallback}>{user.displayName.slice(0, 1)}</div>
          )}
          <label className={styles.nameField}>
            <span>{t("displayName", lang)}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              disabled={busy}
            />
          </label>
          <p className={styles.accountLabel}>{user.accountLabel}</p>
        </section>

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("preferences", lang)}</h3>

          <button
            type="button"
            className={styles.prefCard}
            aria-expanded={openPref === "language"}
            onClick={() => setOpenPref((v) => (v === "language" ? null : "language"))}
          >
            <span>{t("prefLanguage", lang)}</span>
            <strong>{prefs.language === "zh" ? "中文" : "English"}</strong>
          </button>
          {openPref === "language" && (
            <div className={styles.prefBody} role="group" aria-label={t("prefLanguage", lang)}>
              {(["zh", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`${styles.choice} ${prefs.language === code ? styles.choiceActive : ""}`}
                  onClick={() => savePref({ language: code })}
                >
                  {code === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className={styles.prefCard}
            aria-expanded={openPref === "defaultMode"}
            onClick={() => setOpenPref((v) => (v === "defaultMode" ? null : "defaultMode"))}
          >
            <span>{t("prefDefaultMode", lang)}</span>
            <strong>{getMode(prefs.defaultMode).name}</strong>
          </button>
          {openPref === "defaultMode" && (
            <div className={styles.prefBody} role="group" aria-label={t("prefDefaultMode", lang)}>
              {ACTIVE_MODES.map((mode: MapMode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.choice} ${prefs.defaultMode === mode ? styles.choiceActive : ""}`}
                  onClick={() => savePref({ defaultMode: mode })}
                >
                  {getMode(mode).name}
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
