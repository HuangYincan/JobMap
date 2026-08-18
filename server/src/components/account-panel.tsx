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
  /** 退出登录(复用 /api/auth/me DELETE 与 handleAuthAction 逻辑)。 */
  onSignOut: () => void;
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

// ---- 图标:与 map-shell 的 Icon 同一套描边风格(viewBox 24 / stroke 2 / round) ----
type IconName = "pencil" | "lock" | "phone" | "logout" | "chevronRight" | "person";

const ICON_PATHS: Record<IconName, string | string[]> = {
  pencil: "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z",
  lock: "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm3 0V7a4 4 0 0 1 8 0v4",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  logout: "M14 17l5-5-5-5M19 12H9m0-7H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4",
  chevronRight: "m9.5 5 7 7-7 7",
  person: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.4 0-8 2.1-8 4.7V21h16v-2.3c0-2.6-3.6-4.7-8-4.7Z",
};

function Icon({ name }: { name: IconName }) {
  const d = ICON_PATHS[name];
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

export function ProfilePanel({
  user,
  lang,
  onClose,
  onSave,
  onSignOut,
  applications = [],
  notifications = [],
  shifted = false,
  embedded = false,
}: ProfilePanelProps) {
  const [name, setName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [prefs, setPrefs] = useState<UserPreferences>(mergePreferences(user.preferences));
  const [cropOpen, setCropOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  useEffect(() => {
    setName(user.displayName);
    setAvatarUrl(user.avatarUrl ?? "");
    setPrefs(mergePreferences(user.preferences));
  }, [user]);

  useEffect(() => {
    if (!demoNote) return;
    const id = window.setTimeout(() => setDemoNote(null), 2600);
    return () => window.clearTimeout(id);
  }, [demoNote]);

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

  /** 偏好改动即存(后台 PATCH,不阻塞交互)。 */
  const persistPrefs = (next: UserPreferences) => {
    setPrefs(next);
    void onSave({ preferences: next }).catch(() => {});
  };

  const updateCareer = (career: Partial<UserPreferences["career"]>) => {
    persistPrefs(mergePreferences(prefs, { career: { ...prefs.career, ...career } }));
  };

  const updateNotifications = (notifications: Partial<UserPreferences["notifications"]>) => {
    persistPrefs(mergePreferences(prefs, { notifications: { ...prefs.notifications, ...notifications } }));
  };

  /** 编辑资料保存:avatarUrl 传原值(含空串,清空即保存)。 */
  const commitProfile = () => {
    const trimmed = name.trim();
    void save({
      displayName: trimmed || user.displayName,
      avatarUrl,
      preferences: prefs,
    });
  };

  const toggleEdit = () => {
    setEditing((value) => !value);
    setSaved(false);
  };

  const showDemo = () => setDemoNote(t("demoNotice", lang));

  const initials = initialsFromName(name || user.displayName).slice(0, 1);

  const body = (
    <aside className={`${styles.sidebar} ${embedded ? styles.sheet : ""}`} aria-label={t("profile", lang)}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("profile", lang)}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={embedded ? t("backToExplore", lang) : t("closePanel", lang)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* 身份卡:头像(点击裁剪)+ 名字 + 账号 */}
      <section className={`${styles.card} ${styles.identityCard}`} aria-label={t("account", lang)}>
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
            <span className={styles.avatarFallback}>
              {initials || <Icon name="person" />}
            </span>
          )}
        </button>
        <strong className={styles.identityName}>{name || user.displayName}</strong>
        <small className={styles.accountLabel}>
          {[user.accountLabel, t("signedIn", lang)].filter(Boolean).join(" · ")}
        </small>
      </section>

      {/* 账户:编辑资料(展开)/ 密码与安全 / 手机与邮箱 / 退出登录 */}
      <section className={styles.group} aria-label={t("account", lang)}>
        <h3 className={styles.groupLabel}>{t("account", lang)}</h3>
        <div className={styles.card}>
          <button
            type="button"
            className={`${styles.row} ${styles.rowBtn} ${editing ? styles.rowOpen : ""}`}
            onClick={toggleEdit}
            aria-expanded={editing}
          >
            <span className={styles.rowIcon}><Icon name="pencil" /></span>
            <span className={styles.rowLabel}>{t("editProfile", lang)}</span>
            <span className={styles.rowChevron}><Icon name="chevronRight" /></span>
          </button>

          {editing && (
            <div className={styles.editPanel}>
              <label className={styles.nameField}>
                <span>{t("displayName", lang)}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
              </label>
              <div className={styles.editActions}>
                <button type="button" className={styles.editAction} onClick={() => setCropOpen(true)}>
                  <Icon name="pencil" />
                  {t("changeAvatar", lang)}
                </button>
                {avatarUrl ? (
                  <button
                    type="button"
                    className={`${styles.editAction} ${styles.editActionDanger}`}
                    onClick={() => setAvatarUrl("")}
                  >
                    <Icon name="logout" />
                    {t("removeAvatar", lang)}
                  </button>
                ) : null}
              </div>
              <button type="button" className={styles.saveBtn} disabled={busy} onClick={commitProfile}>
                {saved ? t("profileSaved", lang) : t("save", lang)}
              </button>
            </div>
          )}

          <button type="button" className={`${styles.row} ${styles.rowBtn}`} onClick={showDemo}>
            <span className={styles.rowIcon}><Icon name="lock" /></span>
            <span className={styles.rowLabel}>{t("passwordSecurity", lang)}</span>
            <span className={styles.rowChevron}><Icon name="chevronRight" /></span>
          </button>

          <button type="button" className={`${styles.row} ${styles.rowBtn}`} onClick={showDemo}>
            <span className={styles.rowIcon}><Icon name="phone" /></span>
            <span className={styles.rowLabel}>{t("phoneEmail", lang)}</span>
            <span className={styles.rowChevron}><Icon name="chevronRight" /></span>
          </button>

          <button type="button" className={`${styles.row} ${styles.rowBtn} ${styles.rowDanger}`} onClick={onSignOut}>
            <span className={styles.rowIcon}><Icon name="logout" /></span>
            <span className={styles.rowLabel}>{t("signOutLabel", lang)}</span>
          </button>
        </div>
      </section>

      {demoNote && (
        <div className={styles.toast} role="status">{demoNote}</div>
      )}

      {/* 偏好 */}
      <section className={styles.group} aria-label={t("preferencesSection", lang)}>
        <h3 className={styles.groupLabel}>{t("preferencesSection", lang)}</h3>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("prefLanguage", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("prefLanguage", lang)}>
              {(["zh", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`${styles.choice} ${prefs.language === code ? styles.choiceActive : ""}`}
                  onClick={() => persistPrefs(mergePreferences(prefs, { language: code }))}
                >
                  {code === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("prefDefaultMode", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("prefDefaultMode", lang)}>
              {ACTIVE_MODES.map((mode: MapMode) => (
                <button
                  key={mode}
                  type="button"
                  className={`${styles.choice} ${prefs.defaultMode === mode ? styles.choiceActive : ""}`}
                  onClick={() => persistPrefs(mergePreferences(prefs, { defaultMode: mode }))}
                >
                  {getMode(mode).name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 求职偏好 */}
      <section className={styles.group} aria-label={t("careerPrefs", lang)}>
        <h3 className={styles.groupLabel}>{t("careerPrefs", lang)}</h3>
        <div className={styles.card}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("seekingStatus", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("seekingStatus", lang)}>
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
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("careerFamilies", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("careerFamilies", lang)}>
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
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("careerIndustries", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("careerIndustries", lang)}>
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
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t("careerStrengths", lang)}</span>
            <div className={styles.pillRow} role="group" aria-label={t("careerStrengths", lang)}>
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
        </div>
      </section>

      {/* 通知 */}
      <section className={styles.group} aria-label={t("notifications", lang)}>
        <h3 className={styles.groupLabel}>{t("notifications", lang)}</h3>
        <div className={styles.card}>
          {(
            [
              ["emailJobs", "notifyEmailJobs"],
              ["smsJobs", "notifySmsJobs"],
              ["emailSchools", "notifyEmailSchools"],
              ["smsSchools", "notifySmsSchools"],
            ] as const
          ).map(([key, labelKey]) => (
            <label key={key} className={`${styles.row} ${styles.rowBtn} ${styles.toggleRow}`}>
              <span className={styles.rowLabel}>{t(labelKey, lang)}</span>
              <input
                type="checkbox"
                checked={prefs.notifications[key]}
                onChange={(e) => updateNotifications({ [key]: e.target.checked })}
              />
            </label>
          ))}
        </div>
      </section>

      {/* 收件箱 */}
      <section className={styles.group} aria-label={t("inboxSection", lang)}>
        <h3 className={styles.groupLabel}>{t("inboxSection", lang)}</h3>
        <div className={styles.card}>
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
        </div>
      </section>

      {/* 我的投递 */}
      <section className={styles.group} aria-label={t("myApplications", lang)}>
        <h3 className={styles.groupLabel}>{t("myApplications", lang)}</h3>
        <div className={styles.card}>
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
        </div>
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
