"use client";

import type { SearchHistoryEntry } from "@/lib/account";
import { getMode } from "@/lib/modes";
import { t, type Language } from "@/lib/i18n";
import styles from "./recent-panel.module.css";

export interface RecentPanelProps {
  items: SearchHistoryEntry[];
  signedIn: boolean;
  lang: Language;
  onClose: () => void;
  onPick: (entry: SearchHistoryEntry) => void;
  onClear?: () => void;
  shifted?: boolean;
}

export function RecentPanel({
  items,
  signedIn,
  lang,
  onClose,
  onPick,
  onClear,
  shifted = false,
}: RecentPanelProps) {
  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={styles.sidebar} aria-label={t("recent", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("recentSearches", lang)}</h2>
          <div className={styles.headerActions}>
            {signedIn && items.length > 0 && onClear && (
              <button type="button" className={styles.textBtn} onClick={onClear}>
                {t("clearHistory", lang)}
              </button>
            )}
            <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", lang)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>
        {!signedIn ? (
          <p className={styles.empty}>{t("recentNeedSignIn", lang)}</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>{t("recentEmpty", lang)}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className={styles.row} onClick={() => onPick(item)}>
                  <span className={styles.query}>{item.query}</span>
                  <span className={styles.meta}>{getMode(item.mode).name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
