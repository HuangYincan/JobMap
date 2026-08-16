"use client";

import { useEffect, useState } from "react";
import {
  initialsFromName,
  mergePreferences,
  type AccountUser,
  type ApplicationRecord,
  type CareerStrength,
  type JobSeekingStatus,
  type NotificationRecord,
  type UserPreferences,
} from "@/lib/account";
import { ACTIVE_MODES, INDUSTRY_OPTIONS, getMode } from "@/lib/modes";
import { t, type Language } from "@/lib/i18n";
import type { MapMode } from "@/lib/types";
import { AvatarCropper } from "./avatar-cropper";
import styles from "./account-panel.module.css";

export type RailPanel = "explore" | "recent" | "profile" | null;

export interface ProfilePanelProps {
  user: AccountUser;
  lang: Language;
  onClose: () => void;
  onSave: (patch: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: Partial<UserPreferences>;
  }) => Promise<void>;
  applications?: ApplicationRecord[];
  notifications?: NotificationRecord[];
  shifted?: boolean;
  /** Drawer / sheet: no desktop cluster chrome. */
  embedded?: boolean;
}

const STRENGTHS: { id: CareerStrength; labelKey: "strengthAlgorithm" | "strengthFrontend" | "strengthBackend" | "strengthProduct" | "strengthDesign" | "strengthData" }[] = [
  { id: "algorithm", labelKey: "strengthAlgorithm" },
  { id: "frontend", labelKey: "strengthFrontend" },
  { id: "backend", labelKey: "strengthBackend" },
  { id: "product", labelKey: "strengthProduct" },
  { id: "design", labelKey: "strengthDesign" },
  { id: "data", labelKey: "strengthData" },
];

const STATUSES: { id: JobSeekingStatus; labelKey: "statusOpen" | "statusCasually" | "statusNotLooking" }[] = [
  { id: "open", labelKey: "statusOpen" },
  { id: "casually", labelKey: "statusCasually" },
  { id: "not-looking", labelKey: "statusNotLooking" },
];

const FAMILIES: { id: "intern" | "campus" | "social"; labelKey: "jobFamilyIntern" | "jobFamilyCampus" | "jobFamilySocial" }[] = [
  { id: "intern", labelKey: "jobFamilyIntern" },
  { id: "campus", labelKey: "jobFamilyCampus" },
  { id: "social", labelKey: "jobFamilySocial" },
];

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function ProfilePanel({
  user,
  lang,
  onClose,
  onSave,
  applications = [],
  notifications = [],
  shifted = false,
  embedded = false,
}: ProfilePanelProps) {
  const [name, setName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [prefs, setPrefs] = useState<UserPreferences>(mergePreferences(user.preferences));
  const [cropOpen, setCropOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(user.displayName);
    setAvatarUrl(user.avatarUrl ?? "");
    setPrefs(mergePreferences(user.preferences));
  }, [user]);

  const save = async (patch: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: Partial<UserPreferences>;
  }) => {
    setBusy(true);
    setSaved(false);
    try {
      await onSave(patch);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const updateCareer = (career: Partial<UserPreferences["career"]>) => {
    const next = mergePreferences(prefs, { career: { ...prefs.career, ...career } });
    setPrefs(next);
  };

  const updateNotifications = (notifications: Partial<UserPreferences["notifications"]>) => {
    const next = mergePreferences(prefs, { notifications: { ...prefs.notifications, ...notifications } });
    setPrefs(next);
  };

  const commitProfile = () => {
    const trimmed = name.trim();
    void save({
      displayName: trimmed || user.displayName,
      avatarUrl: avatarUrl || undefined,
      preferences: prefs,
    });
  };

  const body = (
      <aside className={`${styles.sidebar} ${embedded ? styles.sheet : ""}`} aria-label={t("profile", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("profile", lang)}</h2>
          {!embedded && (
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", lang)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          )}
        </header>

        <section className={styles.identity}>
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => setCropOpen(true)}
            aria-label={t("changeAvatar", lang)}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.avatar} src={avatarUrl} alt="" />
            ) : (
              <div className={styles.avatarFallback}>{initialsFromName(name || user.displayName).slice(0, 1)}</div>
            )}
          </button>
          <label className={styles.nameField}>
            <span>{t("displayName", lang)}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <p className={styles.accountLabel}>{user.accountLabel}</p>
          <button type="button" className={styles.update} disabled={busy} onClick={commitProfile}>
            {saved ? t("profileSaved", lang) : t("updateProfile", lang)}
          </button>
        </section>

        <hr className={styles.divider} />

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("preferences", lang)}</h3>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("prefLanguage", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("prefLanguage", lang)}>
              {(["zh", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`${styles.choice} ${prefs.language === code ? styles.choiceActive : ""}`}
                  onClick={() => setPrefs(mergePreferences(prefs, { language: code }))}
                >
                  {code === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("prefDefaultMode", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("prefDefaultMode", lang)}>
              {ACTIVE_MODES.map((mode: MapMode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.choice} ${prefs.defaultMode === mode ? styles.choiceActive : ""}`}
                  onClick={() => setPrefs(mergePreferences(prefs, { defaultMode: mode }))}
                >
                  {getMode(mode).name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("careerPrefs", lang)}</h3>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("seekingStatus", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("seekingStatus", lang)}>
              {STATUSES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.choice} ${prefs.career.status === item.id ? styles.choiceActive : ""}`}
                  onClick={() => updateCareer({ status: item.id })}
                >
                  {t(item.labelKey, lang)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("careerFamilies", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("careerFamilies", lang)}>
              {FAMILIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.choice} ${prefs.career.families.includes(item.id) ? styles.choiceActive : ""}`}
                  onClick={() => updateCareer({ families: toggleValue(prefs.career.families, item.id) })}
                >
                  {t(item.labelKey, lang)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("careerIndustries", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("careerIndustries", lang)}>
              {INDUSTRY_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`${styles.choice} ${prefs.career.industries.includes(item.value) ? styles.choiceActive : ""}`}
                  onClick={() => updateCareer({ industries: toggleValue(prefs.career.industries, item.value) })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.box}>
            <span className={styles.boxLabel}>{t("careerStrengths", lang)}</span>
            <div className={styles.prefBody} role="group" aria-label={t("careerStrengths", lang)}>
              {STRENGTHS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.choice} ${prefs.career.strengths.includes(item.id) ? styles.choiceActive : ""}`}
                  onClick={() => updateCareer({ strengths: toggleValue(prefs.career.strengths, item.id) })}
                >
                  {t(item.labelKey, lang)}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("notifications", lang)}</h3>
          <div className={styles.box}>
            {(
              [
                ["emailJobs", "notifyEmailJobs"],
                ["smsJobs", "notifySmsJobs"],
                ["emailSchools", "notifyEmailSchools"],
                ["smsSchools", "notifySmsSchools"],
              ] as const
            ).map(([key, labelKey]) => (
              <label key={key} className={styles.toggleRow}>
                <span>{t(labelKey, lang)}</span>
                <input
                  type="checkbox"
                  checked={prefs.notifications[key]}
                  onChange={(e) => updateNotifications({ [key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        </section>

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("inbox", lang)}</h3>
          {notifications.length === 0 ? (
            <p className={styles.emptyApps}>{t("inboxEmpty", lang)}</p>
          ) : (
            <ul className={styles.appList}>
              {notifications.map((item) => (
                <li key={item.id} className={styles.appRow}>
                  <strong>{item.title}</strong>
                  <small>
                    {[item.companyName, item.channels.filter((ch) => ch !== "inbox").join(" / ") || t("inboxOnly", lang)]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.prefs}>
          <h3 className={styles.sectionLabel}>{t("applications", lang)}</h3>
          {applications.length === 0 ? (
            <p className={styles.emptyApps}>{t("applicationsEmpty", lang)}</p>
          ) : (
            <ul className={styles.appList}>
              {applications.map((item) => (
                <li key={item.id} className={styles.appRow}>
                  <strong>{item.title}</strong>
                  <small>{item.companyName}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
  );

  return (
    <div className={embedded ? styles.embed : `${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      {body}
      <AvatarCropper
        open={cropOpen}
        lang={lang}
        onClose={() => setCropOpen(false)}
        onSave={(dataUrl) => setAvatarUrl(dataUrl)}
      />
    </div>
  );
}
