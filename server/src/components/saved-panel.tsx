"use client";

import { useMemo, useState } from "react";
import type { SavedPlace } from "@/lib/account";
import {
  buildCompareColumns,
  COMPARE_ROWS,
  toggleCompareSelection,
} from "@/lib/compare-saved";
import { getMode } from "@/lib/modes";
import { t, type Language, type TranslationKey } from "@/lib/i18n";
import type { POI } from "@/lib/types";
import styles from "./recent-panel.module.css";

const ROW_LABEL: Record<(typeof COMPARE_ROWS)[number]["key"], TranslationKey> = {
  scale: "compareScale",
  industries: "compareIndustry",
  rating: "compareRating",
  openJobs: "compareOpenJobs",
  families: "compareFamilies",
  salary: "compareSalary",
  distance: "compareDistance",
  address: "compareAddress",
  benefits: "compareBenefits",
};

export interface SavedListProps {
  items: SavedPlace[];
  signedIn: boolean;
  lang: Language;
  catalog?: POI[];
  origin?: { lng: number; lat: number } | null;
  onPick: (place: SavedPlace) => void;
  onHover?: (poiId: string | null) => void;
  onRemove?: (poiId: string) => void;
}

/** 列表 + 勾选对比表。桌面霜面卡和手机抽屉共用，不新开一层。 */
export function SavedList({
  items,
  signedIn,
  lang,
  catalog = [],
  origin = null,
  onPick,
  onHover,
  onRemove,
}: SavedListProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const liveIds = useMemo(() => new Set(items.map((item) => item.poiId)), [items]);
  const selected = useMemo(() => picked.filter((id) => liveIds.has(id)), [picked, liveIds]);
  const columns = useMemo(
    () => buildCompareColumns(selected, items, catalog, origin),
    [selected, items, catalog, origin],
  );

  if (!signedIn) {
    return <p className={styles.empty}>{t("savedNeedSignIn", lang)}</p>;
  }
  if (items.length === 0) {
    return <p className={styles.empty}>{t("savedEmpty", lang)}</p>;
  }

  return (
    <>
      <p className={styles.compareHint}>{t("compareHint", lang)}</p>
      {columns.length === 2 && (
        <table className={styles.compareTable}>
          <caption className={styles.srOnly}>{t("compareTitle", lang)}</caption>
          <thead>
            <tr>
              <th scope="col">{t("compareField", lang)}</th>
              {columns.map((col) => (
                <th key={col.poiId} scope="col">
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row">{t(ROW_LABEL[row.key], lang)}</th>
                {columns.map((col) => (
                  <td
                    key={col.poiId}
                    className={row.key === "salary" ? styles.salaryCell : undefined}
                  >
                    {col[row.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected.length === 1 && <p className={styles.compareHint}>{t("compareNeedTwo", lang)}</p>}
      {selected.length > 0 && (
        <button type="button" className={styles.textBtn} onClick={() => setPicked([])}>
          {t("compareClear", lang)}
        </button>
      )}
      <ul className={styles.list}>
        {items.map((item) => {
          const checked = selected.includes(item.poiId);
          return (
            <li key={item.id} className={styles.savedRow}>
              <button
                type="button"
                className={`${styles.compareToggle} ${checked ? styles.compareOn : ""}`}
                aria-pressed={checked}
                aria-label={`${t("compareSelect", lang)} ${item.name}`}
                onClick={() => setPicked((cur) => toggleCompareSelection(cur, item.poiId))}
              />
              <button
                type="button"
                className={styles.row}
                onClick={() => onPick(item)}
                onMouseEnter={() => onHover?.(item.poiId)}
                onMouseLeave={() => onHover?.(null)}
              >
                <span className={styles.query}>{item.name}</span>
                <span className={styles.meta}>
                  {[getMode(item.mode).name, item.address].filter(Boolean).join(" · ")}
                </span>
              </button>
              {onRemove && (
                <button
                  type="button"
                  className={styles.textBtn}
                  onClick={() => {
                    setPicked((cur) => cur.filter((id) => id !== item.poiId));
                    onRemove(item.poiId);
                  }}
                  aria-label={`${t("unsavePlace", lang)} ${item.name}`}
                >
                  {t("unsavePlace", lang)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export interface SavedPanelProps extends SavedListProps {
  onClose: () => void;
  shifted?: boolean;
}

export function SavedPanel({ onClose, shifted = false, ...listProps }: SavedPanelProps) {
  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={styles.sidebar} aria-label={t("saved", listProps.lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("savedPlaces", listProps.lang)}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", listProps.lang)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <SavedList {...listProps} />
      </aside>
    </div>
  );
}
