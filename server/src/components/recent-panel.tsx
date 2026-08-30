"use client";

import { useMemo, useState } from "react";
import type { ApplicationRecord } from "@/lib/account";
import {
  addStatus,
  createCustomStatus,
  formatRelativeTime,
  lookupStatusDef,
  matchesWatchFilter,
  moveStatusGroup,
  pillTone,
  removeStatus,
  renameStatus,
  resolveStatusLabel,
  type ApplicationStatusDef,
  type ApplicationStatusGroup,
  type ApplicationWatchFilter,
} from "@/lib/application-pipeline";
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
  onStatusesChange?: (next: ApplicationStatusDef[]) => void;
  shifted?: boolean;
  embedded?: boolean;
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
  onStatusesChange,
  shifted = false,
  embedded = false,
}: RecentPanelProps) {
  const [filter, setFilter] = useState<ApplicationWatchFilter>({ kind: "all" });
  const [pickerId, setPickerId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftGroup, setDraftGroup] = useState<ApplicationStatusGroup>("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const visible = useMemo(
    () => items.filter((item) => matchesWatchFilter(item.status, filter, statuses)),
    [items, filter, statuses],
  );
  const activeStatuses = statuses.filter((item) => item.group === "active");
  const closedStatuses = statuses.filter((item) => item.group === "closed");

  const commitStatuses = (next: ApplicationStatusDef[]) => {
    onStatusesChange?.(next);
  };

  const startEdit = (def: ApplicationStatusDef) => {
    setEditingId(def.id);
    setEditingLabel(resolveStatusLabel(def, lang));
  };

  const finishEdit = () => {
    if (editingId) commitStatuses(renameStatus(statuses, editingId, editingLabel));
    setEditingId(null);
    setEditingLabel("");
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
            {signedIn && (
              <button
                type="button"
                className={styles.textBtn}
                aria-pressed={managing}
                onClick={() => {
                  setManaging((open) => !open);
                  setPickerId(null);
                }}
              >
                {managing ? t("doneManageStatuses", lang) : t("manageStatuses", lang)}
              </button>
            )}
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
          <>
            {managing && (
              <section className={styles.manage} aria-label={t("manageStatuses", lang)}>
                <StatusGroupEditor
                  label={t("statusGroupActive", lang)}
                  items={activeStatuses}
                  group="active"
                  lang={lang}
                  editingId={editingId}
                  editingLabel={editingLabel}
                  canRemove={statuses.length > 1}
                  onEdit={startEdit}
                  onEditingLabel={setEditingLabel}
                  onFinishEdit={finishEdit}
                  onMove={(id, group) => commitStatuses(moveStatusGroup(statuses, id, group))}
                  onRemove={(id) => commitStatuses(removeStatus(statuses, id))}
                />
                <StatusGroupEditor
                  label={t("statusGroupClosed", lang)}
                  items={closedStatuses}
                  group="closed"
                  lang={lang}
                  editingId={editingId}
                  editingLabel={editingLabel}
                  canRemove={statuses.length > 1}
                  onEdit={startEdit}
                  onEditingLabel={setEditingLabel}
                  onFinishEdit={finishEdit}
                  onMove={(id, group) => commitStatuses(moveStatusGroup(statuses, id, group))}
                  onRemove={(id) => commitStatuses(removeStatus(statuses, id))}
                />
                <form
                  className={styles.addRow}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const created = createCustomStatus(draftLabel, draftGroup);
                    if (!created) return;
                    commitStatuses(addStatus(statuses, created));
                    setDraftLabel("");
                  }}
                >
                  <input
                    className={styles.addInput}
                    value={draftLabel}
                    maxLength={16}
                    placeholder={t("addStatusPlaceholder", lang)}
                    aria-label={t("addStatusPlaceholder", lang)}
                    onChange={(event) => setDraftLabel(event.target.value)}
                  />
                  <div className={styles.groupToggle} role="group" aria-label={t("statusGroupActive", lang)}>
                    <button
                      type="button"
                      className={`${styles.groupBtn} ${draftGroup === "active" ? styles.groupBtnOn : ""}`}
                      aria-pressed={draftGroup === "active"}
                      onClick={() => setDraftGroup("active")}
                    >
                      {t("statusGroupActive", lang)}
                    </button>
                    <button
                      type="button"
                      className={`${styles.groupBtn} ${draftGroup === "closed" ? styles.groupBtnOn : ""}`}
                      aria-pressed={draftGroup === "closed"}
                      onClick={() => setDraftGroup("closed")}
                    >
                      {t("statusGroupClosed", lang)}
                    </button>
                  </div>
                  <button type="submit" className={styles.addBtn} disabled={!draftLabel.trim()}>
                    {t("addStatus", lang)}
                  </button>
                </form>
              </section>
            )}

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
                  return (
                    <li key={item.id} className={styles.watchItem}>
                      <div className={styles.watchRow}>
                        <button type="button" className={styles.watchMain} onClick={() => onPick(item)}>
                          <span className={styles.watchTitle}>{item.title}</span>
                          <span className={styles.watchMeta}>
                            {[item.companyName, formatRelativeTime(item.updatedAt || item.createdAt, lang)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`${styles.statusPill} ${
                            tone === "offer" ? styles.statusPillOffer : tone === "closed" ? styles.statusPillClosed : styles.statusPillActive
                          }`}
                          aria-expanded={open}
                          aria-haspopup="listbox"
                          onClick={() => setPickerId(open ? null : item.id)}
                        >
                          {resolveStatusLabel(def, lang)}
                        </button>
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
          </>
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

function StatusGroupEditor({
  label,
  items,
  group,
  lang,
  editingId,
  editingLabel,
  canRemove,
  onEdit,
  onEditingLabel,
  onFinishEdit,
  onMove,
  onRemove,
}: {
  label: string;
  items: ApplicationStatusDef[];
  group: ApplicationStatusGroup;
  lang: Language;
  editingId: string | null;
  editingLabel: string;
  canRemove: boolean;
  onEdit: (def: ApplicationStatusDef) => void;
  onEditingLabel: (value: string) => void;
  onFinishEdit: () => void;
  onMove: (id: string, group: ApplicationStatusGroup) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className={styles.manageGroup}>
      <h3 className={styles.sectionLabel}>{label}</h3>
      <div className={styles.manageChips}>
        {items.map((def) => (
          <div key={def.id} className={styles.manageChip}>
            {editingId === def.id ? (
              <input
                className={styles.manageInput}
                value={editingLabel}
                maxLength={16}
                autoFocus
                aria-label={t("addStatusPlaceholder", lang)}
                onChange={(event) => onEditingLabel(event.target.value)}
                onBlur={onFinishEdit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onFinishEdit();
                  }
                  if (event.key === "Escape") onFinishEdit();
                }}
              />
            ) : (
              <button type="button" className={styles.manageName} onClick={() => onEdit(def)}>
                {resolveStatusLabel(def, lang)}
              </button>
            )}
            <button
              type="button"
              className={styles.manageMove}
              onClick={() => onMove(def.id, group === "active" ? "closed" : "active")}
            >
              {group === "active" ? t("statusGroupClosed", lang) : t("statusGroupActive", lang)}
            </button>
            <button
              type="button"
              className={styles.manageRemove}
              disabled={!canRemove}
              aria-label={t("removeStatus", lang)}
              title={!canRemove ? t("cannotRemoveLastStatus", lang) : t("removeStatus", lang)}
              onClick={() => onRemove(def.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
