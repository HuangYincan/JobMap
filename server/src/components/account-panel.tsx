"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
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

/** 求职偏好下拉字段(单选 status + 三个多选)。 */
type PrefField = "status" | "families" | "industries" | "strengths";

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

// ---- 求职偏好下拉浮层(liquid-glass;portal 到 body,逃逸 .sidebar overflow:auto 裁剪) ----

interface PrefMenuProps {
  /** 触发钮 getBoundingClientRect() 快照,用于浮层定位。 */
  anchorRect: DOMRect;
  /** 浮层根节点 ref(供外部点外关闭判断 + 内部测量高度)。 */
  menuRef: RefObject<HTMLDivElement | null>;
  /** listbox 可访问名。 */
  label: string;
  multi: boolean;
  options: { id: string; label: string }[];
  /** 单选为当前 id 字符串;多选为已选 id 数组。 */
  selected: string | string[];
  onToggle?: (id: string) => void;
  onSelect?: (id: string) => void;
}

function PrefMenu({
  anchorRect,
  menuRef,
  label,
  multi,
  options,
  selected,
  onToggle,
  onSelect,
}: PrefMenuProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const selectedSet = multi ? new Set(selected as string[]) : null;

  // 测量后定位:优先向下;底部放不下且上方够高则向上翻转(贴边 gap 6px)。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const height = el.offsetHeight;
    const gap = 6;
    const flipUp = anchorRect.bottom + height + gap > window.innerHeight && anchorRect.top - height - gap > 0;
    setPos({
      top: flipUp ? anchorRect.top - height - gap : anchorRect.bottom + gap,
      right: Math.max(8, window.innerWidth - anchorRect.right),
    });
  }, [anchorRect, menuRef]);

  // 浮层内 ↑/↓ 移动焦点(可选键盘导航,suggest-nav 模式同款)。
  useEffect(() => {
    if (!pos) return;
    const menu = menuRef.current;
    if (!menu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button[role="option"]'));
      if (!buttons.length) return;
      const activeIndex = buttons.findIndex((b) => b === document.activeElement);
      const nextIndex =
        event.key === "ArrowDown"
          ? (activeIndex + 1) % buttons.length
          : (activeIndex - 1 + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pos, menuRef]);

  return createPortal(
    <div
      ref={menuRef}
      className={styles.prefMenuLayer}
      style={pos ? { top: pos.top, right: pos.right } : { visibility: "hidden" }}
    >
      <div
        className={styles.prefMenu}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multi || undefined}
      >
        {options.map((option) => {
          const active = multi ? selectedSet!.has(option.id) : selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`${styles.prefOption} ${active ? styles.prefOptionActive : ""}`}
              onClick={() => {
                if (multi) onToggle?.(option.id);
                else onSelect?.(option.id);
              }}
            >
              <span className={styles.prefOptionLabel}>{option.label}</span>
              {active && (
                <span className={styles.prefCheck} aria-hidden="true">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
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

  // 求职偏好下拉:openField + 触发钮锚点矩形 + 触发钮/浮层 refs。
  const [openField, setOpenField] = useState<PrefField | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRefs = useRef<Partial<Record<PrefField, HTMLButtonElement | null>>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback((field: PrefField, anchor: HTMLElement) => {
    setAnchorRect(anchor.getBoundingClientRect());
    setOpenField(field);
  }, []);

  const closeMenu = useCallback(() => {
    setOpenField(null);
    setAnchorRect(null);
  }, []);

  // 点外关闭 / Escape 关闭(参照 sort-selector 31-52):点击浮层或任意触发钮不关。
  useEffect(() => {
    if (!openField) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuRef.current && menuRef.current.contains(target)) return;
      const fields = Object.keys(triggerRefs.current) as PrefField[];
      if (fields.some((field) => triggerRefs.current[field]?.contains(target))) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openField, closeMenu]);

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

  // ---- 求职偏好触发钮显示文本 ----
  const emptyText = lang === "zh" ? "未选择" : "Not selected";
  const countText = (n: number) => (lang === "zh" ? `${n} 项已选` : `${n} selected`);
  const statusOption = STATUSES.find((s) => s.id === prefs.career.status);
  const statusText = statusOption ? t(statusOption.labelKey, lang) : emptyText;
  const familiesText = (() => {
    const labels: string[] = [];
    for (const id of prefs.career.families) {
      const item = FAMILIES.find((f) => f.id === id);
      if (item) labels.push(t(item.labelKey, lang));
    }
    return labels.length ? labels.join(" + ") : emptyText;
  })();
  const industriesText = (() => {
    const n = prefs.career.industries.length;
    if (n === 0) return emptyText;
    if (n === 1) {
      const item = INDUSTRY_OPTIONS.find((i) => i.value === prefs.career.industries[0]);
      return item ? item.label : prefs.career.industries[0];
    }
    return countText(n);
  })();
  const strengthsText = (() => {
    const n = prefs.career.strengths.length;
    return n === 0 ? emptyText : countText(n);
  })();

  const renderPrefTrigger = (field: PrefField, label: string, valueText: string) => (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <button
        ref={(el) => {
          triggerRefs.current[field] = el;
        }}
        type="button"
        className={styles.prefTrigger}
        aria-haspopup="listbox"
        aria-expanded={openField === field}
        onClick={(event) => {
          if (openField === field) {
            closeMenu();
          } else {
            openMenu(field, event.currentTarget);
          }
        }}
      >
        <span className={styles.prefValue}>{valueText}</span>
        <svg
          className={`${styles.prefChevron} ${openField === field ? styles.prefChevronOpen : ""}`}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );

  const togglePref = (field: PrefField, id: string) => {
    if (field === "families") {
      updateCareer({ families: toggleValue(prefs.career.families, id as "intern" | "campus" | "social") });
    } else if (field === "industries") {
      updateCareer({ industries: toggleValue(prefs.career.industries, id) });
    } else if (field === "strengths") {
      updateCareer({ strengths: toggleValue(prefs.career.strengths, id as CareerStrength) });
    }
  };

  const renderPrefMenu = () => {
    if (!openField || !anchorRect) return null;
    let label = "";
    let multi = false;
    let options: { id: string; label: string }[] = [];
    let selected: string | string[] = [];
    if (openField === "status") {
      label = t("seekingStatus", lang);
      multi = false;
      options = STATUSES.map((s) => ({ id: s.id, label: t(s.labelKey, lang) }));
      selected = prefs.career.status;
    } else if (openField === "families") {
      label = t("careerFamilies", lang);
      multi = true;
      options = FAMILIES.map((f) => ({ id: f.id, label: t(f.labelKey, lang) }));
      selected = prefs.career.families;
    } else if (openField === "industries") {
      label = t("careerIndustries", lang);
      multi = true;
      options = INDUSTRY_OPTIONS.map((i) => ({ id: i.value, label: i.label }));
      selected = prefs.career.industries;
    } else {
      label = t("careerStrengths", lang);
      multi = true;
      options = STRENGTHS.map((s) => ({ id: s.id, label: t(s.labelKey, lang) }));
      selected = prefs.career.strengths;
    }
    return (
      <PrefMenu
        anchorRect={anchorRect}
        menuRef={menuRef}
        label={label}
        multi={multi}
        options={options}
        selected={selected}
        onToggle={multi ? (id) => togglePref(openField, id) : undefined}
        onSelect={
          multi
            ? undefined
            : (id) => {
                updateCareer({ status: id as JobSeekingStatus });
                closeMenu();
              }
        }
      />
    );
  };

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

      {/* 求职偏好(每行一个下拉触发钮 + glass 浮层,勾选即存) */}
      <section className={styles.group} aria-label={t("careerPrefs", lang)}>
        <h3 className={styles.groupLabel}>{t("careerPrefs", lang)}</h3>
        <div className={styles.card}>
          {renderPrefTrigger("status", t("seekingStatus", lang), statusText)}
          {renderPrefTrigger("families", t("careerFamilies", lang), familiesText)}
          {renderPrefTrigger("industries", t("careerIndustries", lang), industriesText)}
          {renderPrefTrigger("strengths", t("careerStrengths", lang), strengthsText)}
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
      {renderPrefMenu()}
      <AvatarCropper
        open={cropOpen}
        lang={lang}
        onClose={() => setCropOpen(false)}
        onSave={(dataUrl) => setAvatarUrl(dataUrl)}
      />
    </div>
  );
}
