"use client";

import type { SearchHistoryEntry } from "@/lib/account";
import { getMode } from "@/lib/modes";
import { t, type Language } from "@/lib/i18n";
import { trendingForMode, type TrendingQuery } from "@/lib/trending-search";
import type { MapMode } from "@/lib/types";
import styles from "./recent-panel.module.css";

export interface RecentPanelProps {
  items: SearchHistoryEntry[];
  signedIn: boolean;
  lang: Language;
  mode: MapMode;
  onClose: () => void;
  onPick: (entry: SearchHistoryEntry) => void;
  onPickTrending?: (item: TrendingQuery) => void;
  onClear?: () => void;
  shifted?: boolean;
  embedded?: boolean;
}

export function RecentPanel({
  items,
  signedIn,
  lang,
  mode,
  onClose,
  onPick,
  onPickTrending,
  onClear,
  shifted = false,
  embedded = false,
}: RecentPanelProps) {
  const trending = trendingForMode(mode);
  return (
    <div className={embedded ? styles.embed : `${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={`${styles.sidebar} ${embedded ? styles.sheet : ""}`} aria-label={t("recent", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("recentSearches", lang)}</h2>
          <div className={styles.headerActions}>
            {items.length > 0 && onClear && (
              <button type="button" className={styles.textBtn} onClick={onClear}>
                {t("clearHistory", lang)}
              </button>
            )}
            <button type="button" className={styles.close} onClick={onClose} aria-label={t("back", lang)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>
        {trending.length > 0 && (
          <section className={styles.trending} aria-label={t("trendingSearches", lang)}>
            <h3 className={styles.sectionLabel}>{t("trendingSearches", lang)}</h3>
            <div className={styles.chips}>
              {trending.map((item) => (
                <button
                  key={item.query}
                  type="button"
                  className={styles.chip}
                  onClick={() => onPickTrending?.(item)}
                >
                  {item.label || item.query}
                </button>
              ))}
            </div>
          </section>
        )}
        {items.length === 0 ? (
          <p className={styles.empty}>{signedIn ? t("recentEmpty", lang) : t("recentEmptyGuest", lang)}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className={styles.row} onClick={() => onPick(item)}>
                  <span className={styles.query}>{item.query}</span>
                  <span className={styles.meta}>
                    {getMode(item.mode).name}
                    {item.entity ? ` · ${t(item.entity.kind === "company" ? "entityCompany" : "entityPoi", lang)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
