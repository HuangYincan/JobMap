"use client";

import { useMemo, useRef, useState } from "react";
import type { ApplicationRecord } from "@/lib/account";
import {
  fallbackStatusId,
  formatRelativeTime,
  lookupStatusDef,
  matchesWatchFilter,
  pillTone,
  resolveStatusLabel,
  type ApplicationStatusDef,
  type ApplicationWatchFilter,
} from "@/lib/application-pipeline";
import {
  isHttpApplyUrl,
  isManualApplicationId,
  parseApplicationCsv,
  serializeApplicationCsv,
  serializeApplicationCsvTemplate,
  type ApplicationCsvParseResult,
  type ApplicationCsvRow,
} from "@/lib/application-csv";
import { t, type Language } from "@/lib/i18n";
import styles from "./recent-panel.module.css";

export interface RecentPanelProps {
  items: ApplicationRecord[];
  statuses: ApplicationStatusDef[];
  signedIn: boolean;
  lang: Language;
  onClose: () => void;
  onPick: (item: ApplicationRecord) => void;
  onSignIn?: () => void;
  onStatusChange?: (item: ApplicationRecord, statusId: string) => void;
  onRemove?: (item: ApplicationRecord) => void;
  onAdd?: (input: { title: string; companyName: string; applyUrl?: string; status: string }) => void | boolean | Promise<void | boolean>;
  onImport?: (rows: ApplicationCsvRow[]) => void | boolean | Promise<void | boolean>;
  shifted?: boolean;
  embedded?: boolean;
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function RecentPanel({
  items,
  statuses,
  signedIn,
  lang,
  onClose,
  onPick,
  onSignIn,
  onStatusChange,
  onRemove,
  onAdd,
  onImport,
  shifted = false,
  embedded = false,
}: RecentPanelProps) {
  const [filter, setFilter] = useState<ApplicationWatchFilter>({ kind: "all" });
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [composer, setComposer] = useState<"add" | "import" | null>(null);
  const [addCompany, setAddCompany] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addStatusId, setAddStatusId] = useState(fallbackStatusId(statuses));
  const [addError, setAddError] = useState("");
  const [csvName, setCsvName] = useState("");
  const [csvParse, setCsvParse] = useState<ApplicationCsvParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () => items.filter((item) => matchesWatchFilter(item.status, filter, statuses)),
    [items, filter, statuses],
  );
  const activeStatuses = statuses.filter((item) => item.group === "active");
  const closedStatuses = statuses.filter((item) => item.group === "closed");
  const defaultStatus = fallbackStatusId(statuses);

  const openComposer = (next: "add" | "import") => {
    setPickerId(null);
    setComposer((current) => (current === next ? null : next));
    setAddError("");
    if (next === "add") {
      setAddCompany("");
      setAddTitle("");
      setAddUrl("");
      setAddStatusId(defaultStatus);
    }
  };

  const submitAdd = async () => {
    const companyName = addCompany.trim();
    const title = addTitle.trim();
    const applyUrl = addUrl.trim();
    if (!companyName || !title || !onAdd) return;
    if (applyUrl && !isHttpApplyUrl(applyUrl)) {
      setAddError(t("invalidApplyUrl", lang));
      return;
    }
    setAddError("");
    setBusy(true);
    try {
      const ok = await onAdd({
        companyName,
        title,
        applyUrl: applyUrl || undefined,
        status: addStatusId || defaultStatus,
      });
      if (ok === false) {
        setAddError(t("addApplicationFailed", lang));
        return;
      }
      setAddCompany("");
      setAddTitle("");
      setAddUrl("");
      setComposer(null);
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setCsvName(file.name);
    const text = await file.text();
    setCsvParse(parseApplicationCsv(text));
  };

  const confirmImport = async () => {
    if (!csvParse || !onImport || csvParse.rows.length === 0) return;
    setAddError("");
    setBusy(true);
    try {
      const ok = await onImport(csvParse.rows);
      if (ok === false) {
        setAddError(t("importApplicationsFailed", lang));
        return;
      }
      setCsvParse(null);
      setCsvName("");
      setComposer(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? styles.embed : `${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={`${styles.sidebar} ${embedded ? styles.sheet : ""}`} aria-label={t("recent", lang)}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h2 className={styles.title}>{t("recent", lang)}</h2>
            <p className={styles.subtitle}>
              {t("recentWatch", lang)}
              {signedIn ? ` · ${items.length}` : ""}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.close} onClick={onClose} aria-label={t("back", lang)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        {!signedIn ? (
          <div className={styles.emptyBlock}>
            <p className={styles.empty}>{t("recentNeedSignIn", lang)}</p>
            {onSignIn && (
              <button type="button" className={styles.signInBtn} onClick={onSignIn}>
                {t("signIn", lang)}
              </button>
            )}
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.filters} role="tablist" aria-label={t("recentWatch", lang)}>
              <FilterChip
                label={t("watchAll", lang)}
                pressed={filter.kind === "all"}
                onClick={() => setFilter({ kind: "all" })}
              />
              <FilterChip
                label={t("watchActive", lang)}
                pressed={filter.kind === "group" && filter.group === "active"}
                onClick={() => setFilter({ kind: "group", group: "active" })}
              />
              <FilterChip
                label={t("watchClosed", lang)}
                pressed={filter.kind === "group" && filter.group === "closed"}
                onClick={() => setFilter({ kind: "group", group: "closed" })}
              />
            </div>

            <div className={styles.tools}>
              <button
                type="button"
                className={styles.textBtn}
                aria-pressed={composer === "add"}
                onClick={() => openComposer("add")}
              >
                {t("addApplication", lang)}
              </button>
              <button
                type="button"
                className={styles.textBtn}
                aria-pressed={composer === "import"}
                onClick={() => openComposer("import")}
              >
                {t("importCsv", lang)}
              </button>
              <button
                type="button"
                className={styles.textBtn}
                onClick={() => downloadText(
                  "applications.csv",
                  serializeApplicationCsv(items, { statuses, lang }),
                  "text/csv;charset=utf-8",
                )}
              >
                {t("exportCsv", lang)}
              </button>
            </div>

            {composer === "add" && (
              <form
                className={styles.composer}
                aria-label={t("addApplication", lang)}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAdd();
                }}
              >
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t("addApplicationCompany", lang)}</span>
                  <input
                    className={styles.fieldInput}
                    value={addCompany}
                    maxLength={200}
                    required
                    autoComplete="organization"
                    onChange={(event) => setAddCompany(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t("addApplicationTitle", lang)}</span>
                  <input
                    className={styles.fieldInput}
                    value={addTitle}
                    maxLength={200}
                    required
                    onChange={(event) => setAddTitle(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {t("addApplicationUrl", lang)} · {t("addApplicationOptional", lang)}
                  </span>
                  <input
                    className={styles.fieldInput}
                    value={addUrl}
                    maxLength={2048}
                    inputMode="url"
                    placeholder="https://"
                    onChange={(event) => {
                      setAddUrl(event.target.value);
                      if (addError) setAddError("");
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t("manageStatuses", lang)}</span>
                  <select
                    className={styles.fieldSelect}
                    value={addStatusId}
                    onChange={(event) => setAddStatusId(event.target.value)}
                  >
                    {statuses.map((option) => (
                      <option key={option.id} value={option.id}>
                        {resolveStatusLabel(option, lang)}
                      </option>
                    ))}
                  </select>
                </label>
                {addError ? <p className={styles.fieldError}>{addError}</p> : null}
                <div className={styles.formActions}>
                  <button type="button" className={styles.ghostBtn} onClick={() => setComposer(null)}>
                    {t("cancel", lang)}
                  </button>
                  <button
                    type="submit"
                    className={styles.addBtn}
                    disabled={busy || !addCompany.trim() || !addTitle.trim()}
                  >
                    {t("watchJoin", lang)}
                  </button>
                </div>
              </form>
            )}

            {composer === "import" && (
              <div className={styles.composer} aria-label={t("importCsv", lang)}>
                <p className={styles.fieldHint}>{t("importCsvFormat", lang)}</p>
                <div className={`${styles.formActions} ${styles.formActionsStart}`}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => downloadText(
                      "applications-template.csv",
                      serializeApplicationCsvTemplate(lang),
                      "text/csv;charset=utf-8",
                    )}
                  >
                    {t("downloadCsvTemplate", lang)}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("chooseCsvFile", lang)}
                  </button>
                  {csvName ? <span className={styles.fileName}>{csvName}</span> : null}
                </div>
                <input
                  ref={fileRef}
                  className={styles.srOnly}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  aria-label={t("chooseCsvFile", lang)}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    void onPickFile(file);
                  }}
                />
                {csvParse ? (
                  <p className={styles.fieldHint}>
                    {t("importCsvPreview", lang)
                      .replace("{n}", String(csvParse.rows.length))
                      .replace("{s}", String(csvParse.skipped.length))}
                  </p>
                ) : null}
                {addError ? <p className={styles.fieldError}>{addError}</p> : null}
                <div className={styles.formActions}>
                  <button type="button" className={styles.ghostBtn} onClick={() => setComposer(null)}>
                    {t("cancel", lang)}
                  </button>
                  <button
                    type="button"
                    className={styles.addBtn}
                    disabled={busy || !csvParse || csvParse.rows.length === 0}
                    onClick={() => void confirmImport()}
                  >
                    {t("confirmImport", lang)}
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <p className={styles.empty}>{t("applicationsEmpty", lang)}</p>
            ) : visible.length === 0 ? (
              <p className={styles.empty}>{t("applicationsEmpty", lang)}</p>
            ) : (
              <ul className={styles.watchList}>
                {visible.map((item) => {
                  const def = lookupStatusDef(statuses, item.status);
                  const tone = pillTone(def);
                  const open = pickerId === item.id;
                  const catalogRow = !isManualApplicationId(item.companyPoiId);
                  const rowBody = (
                    <>
                      <span className={styles.watchTitle}>{item.title}</span>
                      <span className={styles.watchMeta}>
                        {[item.companyName, formatRelativeTime(item.updatedAt || item.createdAt, lang)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </>
                  );
                  return (
                    <li key={item.id} className={styles.watchItem}>
                      <div className={styles.watchRow}>
                        {catalogRow ? (
                          <button type="button" className={styles.watchMain} onClick={() => onPick(item)}>
                            {rowBody}
                          </button>
                        ) : item.applyUrl ? (
                          <a
                            className={styles.watchMain}
                            href={item.applyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {rowBody}
                          </a>
                        ) : (
                          <div className={styles.watchMain}>{rowBody}</div>
                        )}
                        <button
                          type="button"
                          className={`${styles.statusPill} ${
                            tone === "offer"
                              ? styles.statusPillOffer
                              : tone === "rejected"
                                ? styles.statusPillRejected
                                : tone === "closed"
                                  ? styles.statusPillClosed
                                  : styles.statusPillActive
                          }`}
                          aria-expanded={open}
                          aria-haspopup="listbox"
                          onClick={() => setPickerId(open ? null : item.id)}
                        >
                          {resolveStatusLabel(def, lang)}
                        </button>
                        {onRemove && (
                          <button
                            type="button"
                            className={styles.watchRemove}
                            aria-label={`${t("removeApplication", lang)} ${item.title}`}
                            onClick={() => onRemove(item)}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className={styles.picker} role="listbox" aria-label={t("manageStatuses", lang)}>
                          <p className={styles.pickerLabel}>{t("statusGroupActive", lang)}</p>
                          <div className={styles.pickerGrid}>
                            {activeStatuses.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                role="option"
                                aria-selected={option.id === def.id}
                                className={`${styles.pickerChip} ${option.id === def.id ? styles.pickerChipOn : ""}`}
                                onClick={() => {
                                  onStatusChange?.(item, option.id);
                                  setPickerId(null);
                                }}
                              >
                                {resolveStatusLabel(option, lang)}
                              </button>
                            ))}
                          </div>
                          {closedStatuses.length > 0 && (
                          <>
                          <p className={styles.pickerLabel}>{t("statusGroupClosed", lang)}</p>
                          <div className={styles.pickerGrid}>
                            {closedStatuses.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                role="option"
                                aria-selected={option.id === def.id}
                                className={`${styles.pickerChip} ${option.id === def.id ? styles.pickerChipOn : ""}`}
                                onClick={() => {
                                  onStatusChange?.(item, option.id);
                                  setPickerId(null);
                                }}
                              >
                                {resolveStatusLabel(option, lang)}
                              </button>
                            ))}
                          </div>
                          </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function FilterChip({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={pressed}
      className={`${styles.filterChip} ${pressed ? styles.filterChipOn : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
