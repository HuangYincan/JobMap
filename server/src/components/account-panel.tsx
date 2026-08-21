"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  initialsFromName,
  mergePreferences,
  type AccountUser,
  type ApplicationRecord,
  type AuthProvider,
  type CareerStrength,
  type JobSeekingStatus,
  type NotificationRecord,
  type UserPreferences,
} from "@/lib/account";
import { ACTIVE_MODES, INDUSTRY_OPTIONS, getMode } from "@/lib/modes";
import { t, uiLabel, type Language } from "@/lib/i18n";
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
  /** 头像上传成功后通知外壳同步 user 状态(头像即时保存,不等「保存」按钮)。 */
  onAvatarUrlChange?: (avatarUrl: string) => void;
  /** 退出登录(复用 /api/auth/me DELETE 与 handleAuthAction 逻辑)。 */
  onSignOut: () => void;
  /** 已投递/通知行点击 → 打开对应岗位(载荷为跳转所需最小字段;通知行缺字段时行禁用)。 */
  onOpenApplication?: (record: { positionId: string; companyPoiId: string }) => void;
  /** 密码/手机/邮箱变更成功 → 通知外壳刷新 user(换绑/设密后展示值与 hasPassword 同步)。 */
  onUserChanged?: () => void;
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

/** 账户缺失(email/手机/用户名都没有,如纯 OAuth)时的回退展示:登录方式即账户。 */
const PROVIDER_LABELS: Partial<Record<AuthProvider, "authPhone" | "authEmail" | "authGithub" | "authGoogle" | "authWechat" | "authPassword">> = {
  phone: "authPhone",
  email: "authEmail",
  github: "authGithub",
  google: "authGoogle",
  wechat: "authWechat",
  password: "authPassword",
};

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** 联系凭证脱敏:手机整串按「前 3 后 4」;邮箱只遮罩 @ 前的本地部分(保留域名便于辨认)。
 *  长度 < 7 的短值只保留尾 2 位。 */
function maskSegment(s: string): string {
  if (s.length >= 7) return `${s.slice(0, 3)}****${s.slice(-4)}`;
  if (s.length <= 2) return s;
  return `${s.slice(0, -2)}**${s.slice(-2)}`;
}

function maskContact(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at > 0) return `${maskSegment(v.slice(0, at))}${v.slice(at)}`;
  return maskSegment(v);
}

/** 设置/修改密码错误码 → i18n key(未知码回退通用错误)。 */
function passwordErrorKey(code: string | undefined): "wrongPassword" | "codeInvalid" | "codeTargetMismatch" | "passwordTooShort" | "securityFailed" {
  if (code === "WRONG_PASSWORD") return "wrongPassword";
  if (code === "INVALID_CODE") return "codeInvalid";
  if (code === "NOT_BOUND") return "codeTargetMismatch";
  if (code === "PASSWORD_TOO_SHORT") return "passwordTooShort";
  return "securityFailed";
}

/** 更换手机/邮箱错误码 → i18n key(未知码回退通用错误)。 */
function contactErrorKey(code: string | undefined, kind: "phone" | "email"): "takenPhone" | "takenEmail" | "codeInvalid" | "securityFailed" {
  if (code === "PHONE_TAKEN" && kind === "phone") return "takenPhone";
  if (code === "EMAIL_TAKEN" && kind === "email") return "takenEmail";
  if (code === "INVALID_CODE") return "codeInvalid";
  return "securityFailed";
}

/** 下拉字段:求职偏好(单选 status + 三个多选)+ 偏好(单选 language / defaultMode)。 */
type PrefField = "status" | "families" | "industries" | "strengths" | "language" | "defaultMode";

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
  onAvatarUrlChange,
  onSignOut,
  onOpenApplication,
  onUserChanged,
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
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);

  // ---- 密码与安全 / 手机与邮箱 子面板 ----
  type SecurityView = "main" | "password" | "contacts";
  const [view, setView] = useState<SecurityView>("main");
  // 设置/修改密码表单
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwCode, setPwCode] = useState("");
  const [pwSent, setPwSent] = useState(false);
  const [pwResendIn, setPwResendIn] = useState(0);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  // 手机 / 邮箱更换表单(各自独立展开)
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneResendIn, setPhoneResendIn] = useState(0);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailResendIn, setEmailResendIn] = useState(0);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  /** 后端契约:user JSON 增 hasPassword(ws-backend 实现);类型未合并前按可选读,缺省视为无密码。 */
  const hasPassword = Boolean((user as AccountUser & { hasPassword?: boolean }).hasPassword);
  /** 设置密码的身份验证 OTP:优先发到已绑定邮箱,否则手机;两者皆无 → 不可设密码。 */
  const otpProvider = user.email ? "email" : "phone";
  const otpTarget = user.email || user.phone || "";

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

  // 发送验证码倒计时(60s 冷却,与 auth-modal 同模式):任一计数 >0 每秒递减
  useEffect(() => {
    if (pwResendIn <= 0 && phoneResendIn <= 0 && emailResendIn <= 0) return;
    const timer = setInterval(() => {
      setPwResendIn((v) => (v > 1 ? v - 1 : 0));
      setPhoneResendIn((v) => (v > 1 ? v - 1 : 0));
      setEmailResendIn((v) => (v > 1 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [pwResendIn > 0 || phoneResendIn > 0 || emailResendIn > 0]);

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

  /** 裁剪完成 → 即时上传二进制到 POST /api/me/avatar(不等「保存」按钮),
   *  成功即更新本地头像与服务端 user 状态;失败弹 toast。 */
  const uploadAvatar = async (dataUrl: string) => {
    setUploading(true);
    try {
      const blobRes = await fetch(dataUrl);
      const blob = await blobRes.blob();
      const form = new FormData();
      form.append("file", blob, "avatar.jpg");
      const res = await fetch("/api/me/avatar", { method: "POST", body: form });
      const body = (await res.json()) as { user?: AccountUser; message?: string };
      const nextUrl = body.user?.avatarUrl;
      if (!res.ok || !nextUrl) throw new Error(body?.message ?? "upload failed");
      setAvatarUrl(nextUrl);
      onAvatarUrlChange?.(nextUrl);
    } catch {
      setDemoNote(t("avatarUploadFailed", lang));
    } finally {
      setUploading(false);
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

  /** OTP 发送(设置密码的身份验证 / 更换手机 / 更换邮箱):复用 POST /api/auth/otp/send,
   *  成功置 60s 冷却倒计时并 toast;失败行内错误。 */
  const sendOtp = async (provider: "email" | "phone", target: string, setSent: (v: boolean) => void, setResendIn: (v: number) => void, setError: (v: string | null) => void) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, target }),
      });
      const body = (await res.json()) as { message?: string; retryAfterMs?: number };
      if (!res.ok) throw new Error(body?.message || "send failed");
      setSent(true);
      // 60s 冷却与后端 otpRateConfig.cooldownMs 对齐;响应带 retryAfterMs 则按其取整
      const cooldown = typeof body?.retryAfterMs === "number" ? Math.max(60, Math.ceil(body.retryAfterMs / 1000)) : 60;
      setResendIn(cooldown);
      setDemoNote(t("sendCodeSuccess", lang));
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  /** 设置/修改密码:有密码 → 旧密码验证;无密码 → 已绑定凭证 OTP 验证。成功 toast + 回主视图 + 刷新 user。 */
  const savePassword = async () => {
    if (pwNew.length < 8) {
      setPwError(t("passwordTooShort", lang));
      return;
    }
    if (pwConfirm !== pwNew) {
      setPwError(t("passwordMismatch", lang));
      return;
    }
    if (!hasPassword && !otpTarget) {
      setPwError(t("noBoundContact", lang));
      return;
    }
    setPwBusy(true);
    setPwError(null);
    try {
      const body = hasPassword
        ? { oldPassword: pwOld, newPassword: pwNew }
        : { otp: { provider: otpProvider, target: otpTarget, code: pwCode }, newPassword: pwNew };
      const res = await fetch("/api/auth/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; code?: string };
      if (!res.ok) throw new Error(t(passwordErrorKey(json?.code), lang));
      setDemoNote(t("passwordSaved", lang));
      setView("main");
      onUserChanged?.();
    } catch (err) {
      setPwError(err instanceof Error ? err.message : t("securityFailed", lang));
    } finally {
      setPwBusy(false);
    }
  };

  /** 更换手机:OTP 验证新手机 → POST /api/auth/me/phone。成功 toast + 折叠 + 刷新 user。 */
  const submitPhone = async () => {
    setPhoneBusy(true);
    setPhoneError(null);
    try {
      const res = await fetch("/api/auth/me/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput.trim(), code: phoneCode.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; code?: string };
      if (!res.ok) throw new Error(t(contactErrorKey(json?.code, "phone"), lang));
      setDemoNote(t("phoneEmailSaved", lang));
      setPhoneOpen(false);
      setPhoneInput("");
      setPhoneCode("");
      setPhoneSent(false);
      onUserChanged?.();
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : t("securityFailed", lang));
    } finally {
      setPhoneBusy(false);
    }
  };

  /** 更换邮箱:OTP 验证新邮箱 → POST /api/auth/me/email。成功 toast + 折叠 + 刷新 user。 */
  const submitEmail = async () => {
    setEmailBusy(true);
    setEmailError(null);
    try {
      const res = await fetch("/api/auth/me/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim(), code: emailCode.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; code?: string };
      if (!res.ok) throw new Error(t(contactErrorKey(json?.code, "email"), lang));
      setDemoNote(t("phoneEmailSaved", lang));
      setEmailOpen(false);
      setEmailInput("");
      setEmailCode("");
      setEmailSent(false);
      onUserChanged?.();
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : t("securityFailed", lang));
    } finally {
      setEmailBusy(false);
    }
  };

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
      return item ? uiLabel(item, lang) : prefs.career.industries[0];
    }
    return countText(n);
  })();
  const strengthsText = (() => {
    const n = prefs.career.strengths.length;
    return n === 0 ? emptyText : countText(n);
  })();
  // F3 偏好:language / defaultMode 走 PrefField 下拉,触发钮显示当前值
  const languageText = prefs.language === "zh" ? "中文" : "English";
  const defaultModeText = lang === "en" ? getMode(prefs.defaultMode).nameEn : getMode(prefs.defaultMode).name;

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
      options = INDUSTRY_OPTIONS.map((i) => ({ id: i.value, label: uiLabel(i, lang) }));
      selected = prefs.career.industries;
    } else if (openField === "language") {
      // F3 偏好:language 单选下拉(与求职偏好同交互,勾选即存并关浮层)
      label = t("prefLanguage", lang);
      multi = false;
      options = [
        { id: "zh", label: "中文" },
        { id: "en", label: "English" },
      ];
      selected = prefs.language;
    } else if (openField === "defaultMode") {
      // F3 偏好:defaultMode 单选下拉(选项 = ACTIVE_MODES 的显示名)
      label = t("prefDefaultMode", lang);
      multi = false;
      options = ACTIVE_MODES.map((m) => ({ id: m, label: lang === "en" ? getMode(m).nameEn : getMode(m).name }));
      selected = prefs.defaultMode;
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
                if (openField === "status") {
                  updateCareer({ status: id as JobSeekingStatus });
                } else if (openField === "language") {
                  persistPrefs(mergePreferences(prefs, { language: id as Language }));
                } else if (openField === "defaultMode") {
                  persistPrefs(mergePreferences(prefs, { defaultMode: id as MapMode }));
                }
                closeMenu();
              }
        }
      />
    );
  };

  const initials = initialsFromName(name || user.displayName).slice(0, 1);

  // 账户:登录凭证(email/手机号/注册用户名),永不修改;纯 OAuth 无凭证时回退展示登录方式。
  const providerLabelKey = PROVIDER_LABELS[user.provider];
  const accountText = user.accountLabel || (providerLabelKey ? t(providerLabelKey, lang) : t("account", lang));

  const toastEl = demoNote ? (
    <div className={styles.toast} role="status">{demoNote}</div>
  ) : null;

  /** 子面板头:返回钮(chevronLeft)+ 标题 + 关闭(与主头同语义,保持面板可随时关闭)。 */
  const renderSubHeader = (title: string) => (
    <header className={styles.subHeader}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => setView("main")}
        aria-label={t("securityBack", lang)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14.5 5 8 12l6.5 7" />
        </svg>
      </button>
      <h2 className={styles.subTitle}>{title}</h2>
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
  );

  /** A.「密码与安全」子面板:状态行 + 身份验证(旧密码 / 已绑定凭证 OTP)+ 新密码 + 保存。 */
  const renderPasswordSecurity = () => (
    <section className={styles.group} aria-label={t("passwordSecurity", lang)}>
      <h3 className={styles.groupLabel}>{t("loginPassword", lang)}</h3>
      <div className={styles.card}>
        <div className={styles.secPanel}>
          <div className={styles.secStatusRow}>
            <span className={styles.secStatusDot} aria-hidden="true" />
            <span className={styles.secStatusText}>
              {hasPassword ? t("passwordSet", lang) : t("passwordNotSet", lang)}
            </span>
          </div>
          {!hasPassword && (
            <p className={styles.secHint}>
              {otpTarget ? t("setPasswordHint", lang) : t("noBoundContact", lang)}
            </p>
          )}
          {hasPassword ? (
            <label className={styles.secField}>
              <span>{t("oldPassword", lang)}</span>
              <input
                type="password"
                value={pwOld}
                onChange={(e) => setPwOld(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          ) : (
            <label className={styles.secField}>
              <span>{t("verifyCode", lang)}</span>
              <div className={styles.secInputShell}>
                <input
                  value={pwCode}
                  onChange={(e) => setPwCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className={styles.secSend}
                  disabled={busy || pwResendIn > 0 || !otpTarget}
                  onClick={() => void sendOtp(otpProvider, otpTarget, setPwSent, setPwResendIn, setPwError)}
                >
                  {pwResendIn > 0
                    ? t("resendInSeconds", lang).replace("{s}", String(pwResendIn))
                    : pwSent
                      ? t("resendCode", lang)
                      : t("sendCode", lang)}
                </button>
              </div>
            </label>
          )}
          <label className={styles.secField}>
            <span>{t("newPassword", lang)}</span>
            <input
              type="password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              autoComplete="new-password"
            />
            <small className={styles.secFieldHint}>{t("passwordTooShort", lang)}</small>
          </label>
          <label className={styles.secField}>
            <span>{t("confirmNewPassword", lang)}</span>
            <input
              type="password"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {pwError && <p className={styles.secError} role="alert">{pwError}</p>}
          <button type="button" className={styles.saveBtn} disabled={pwBusy} onClick={() => void savePassword()}>
            {t("savePassword", lang)}
          </button>
        </div>
      </div>
    </section>
  );

  /** B.「手机与邮箱」子面板:手机/邮箱各一块(凭证展示 + 更换表单,独立展开)。 */
  const renderContactBlock = (
    kind: "phone" | "email",
    value: string | undefined,
    open: boolean,
    input: string,
    code: string,
    sent: boolean,
    resendIn: number,
    fieldBusy: boolean,
    error: string | null,
    onToggle: () => void,
    onInput: (v: string) => void,
    onCode: (v: string) => void,
    onSend: () => void,
    onSubmit: () => void,
  ) => {
    const isPhone = kind === "phone";
    return (
      <div className={styles.secBlock}>
        <h4 className={styles.groupLabel}>{isPhone ? t("phoneNumber", lang) : t("emailAddress", lang)}</h4>
        <div className={styles.contactRow}>
          <span className={styles.rowLabel}>{value ? maskContact(value) : t("unbound", lang)}</span>
          <button
            type="button"
            className={styles.contactAction}
            aria-expanded={open}
            onClick={onToggle}
          >
            {isPhone ? t("changePhone", lang) : t("changeEmail", lang)}
          </button>
        </div>
        {open && (
          <div className={styles.secPanel}>
            <label className={styles.secField}>
              <span>{isPhone ? t("newPhone", lang) : t("newEmail", lang)}</span>
              <input
                value={input}
                onChange={(e) => onInput(e.target.value)}
                inputMode={isPhone ? "tel" : "email"}
                autoComplete={isPhone ? "tel" : "email"}
              />
            </label>
            <label className={styles.secField}>
              <span>{t("verifyCode", lang)}</span>
              <div className={styles.secInputShell}>
                <input
                  value={code}
                  onChange={(e) => onCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  className={styles.secSend}
                  disabled={busy || resendIn > 0 || !input.trim()}
                  onClick={onSend}
                >
                  {resendIn > 0
                    ? t("resendInSeconds", lang).replace("{s}", String(resendIn))
                    : sent
                      ? t("resendCode", lang)
                      : t("sendCode", lang)}
                </button>
              </div>
            </label>
            {error && <p className={styles.secError} role="alert">{error}</p>}
            <button type="button" className={styles.saveBtn} disabled={fieldBusy} onClick={onSubmit}>
              {t("confirmChange", lang)}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderPhoneEmail = () => (
    <section className={styles.group} aria-label={t("phoneEmail", lang)}>
      <div className={styles.card}>
        {renderContactBlock(
          "phone",
          user.phone,
          phoneOpen,
          phoneInput,
          phoneCode,
          phoneSent,
          phoneResendIn,
          phoneBusy,
          phoneError,
          () => setPhoneOpen((v) => !v),
          setPhoneInput,
          setPhoneCode,
          () => void sendOtp("phone", phoneInput.trim(), setPhoneSent, setPhoneResendIn, setPhoneError),
          () => void submitPhone(),
        )}
        <div className={styles.secDivider} aria-hidden="true" />
        {renderContactBlock(
          "email",
          user.email,
          emailOpen,
          emailInput,
          emailCode,
          emailSent,
          emailResendIn,
          emailBusy,
          emailError,
          () => setEmailOpen((v) => !v),
          setEmailInput,
          setEmailCode,
          () => void sendOtp("email", emailInput.trim(), setEmailSent, setEmailResendIn, setEmailError),
          () => void submitEmail(),
        )}
      </div>
    </section>
  );

  const body = (
    <aside className={`${styles.sidebar} ${embedded ? styles.sheet : ""}`} aria-label={t("profile", lang)}>
      {view === "main" ? (
        <>
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

      {/* 身份卡:头像(点击裁剪)+ 用户名 + 账户(登录凭证,永不修改) */}
      <section className={`${styles.card} ${styles.identityCard}`} aria-label={t("account", lang)}>
        <button
          type="button"
          className={styles.avatarBtn}
          onClick={() => setCropOpen(true)}
          disabled={uploading}
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
          <Icon name="lock" />
          <span>
            {t("account", lang)}: {accountText} · {t("accountImmutable", lang)}
          </span>
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
                <button type="button" className={styles.editAction} onClick={() => setCropOpen(true)} disabled={uploading}>
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

          <button type="button" className={`${styles.row} ${styles.rowBtn}`} onClick={() => setView("password")}>
            <span className={styles.rowIcon}><Icon name="lock" /></span>
            <span className={styles.rowLabel}>{t("passwordSecurity", lang)}</span>
            <span className={styles.rowChevron}><Icon name="chevronRight" /></span>
          </button>

          <button type="button" className={`${styles.row} ${styles.rowBtn}`} onClick={() => setView("contacts")}>
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

      {/* 偏好(F3):language / defaultMode 从 pill 改 PrefField 下拉,与求职偏好交互一致 */}
      <section className={styles.group} aria-label={t("preferencesSection", lang)}>
        <h3 className={styles.groupLabel}>{t("preferencesSection", lang)}</h3>
        <div className={styles.card}>
          {renderPrefTrigger("language", t("prefLanguage", lang), languageText)}
          {renderPrefTrigger("defaultMode", t("prefDefaultMode", lang), defaultModeText)}
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
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.appRow}
                    disabled={!item.positionId || !item.companyPoiId}
                    onClick={() => {
                      if (item.positionId && item.companyPoiId) {
                        onOpenApplication?.({ positionId: item.positionId, companyPoiId: item.companyPoiId });
                      }
                    }}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {[item.companyName, item.channels.filter((ch) => ch !== "inbox").join(" / ") || t("inboxOnly", lang)]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </button>
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
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.appRow}
                    onClick={() => onOpenApplication?.({ positionId: item.positionId, companyPoiId: item.companyPoiId })}
                  >
                    <strong>{item.title}</strong>
                    <small>{item.companyName}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
        </>
      ) : view === "password" ? (
        <>
          {renderSubHeader(t("passwordSecurity", lang))}
          {renderPasswordSecurity()}
          {toastEl}
        </>
      ) : (
        <>
          {renderSubHeader(t("phoneEmail", lang))}
          {renderPhoneEmail()}
          {toastEl}
        </>
      )}
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
        onSave={(dataUrl) => void uploadAvatar(dataUrl)}
      />
    </div>
  );
}
