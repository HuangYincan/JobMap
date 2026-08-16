"use client";

import type { SavedPlace } from "@/lib/account";
import { getMode } from "@/lib/modes";
import { t, type Language } from "@/lib/i18n";
import styles from "./recent-panel.module.css";

export interface SavedPanelProps {
  items: SavedPlace[];
  signedIn: boolean;
  lang: Language;
  onClose: () => void;
  onPick: (place: SavedPlace) => void;
  onRemove?: (poiId: string) => void;
  shifted?: boolean;
}

export function SavedPanel({
  items,
  signedIn,
  lang,
  onClose,
  onPick,
  onRemove,
  shifted = false,
}: SavedPanelProps) {
  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={styles.sidebar} aria-label={t("saved", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("savedPlaces", lang)}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", lang)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        {!signedIn ? (
          <p className={styles.empty}>{t("savedNeedSignIn", lang)}</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>{t("savedEmpty", lang)}</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.savedRow}>
                <button type="button" className={styles.row} onClick={() => onPick(item)}>
                  <span className={styles.query}>{item.name}</span>
                  <span className={styles.meta}>
                    {[getMode(item.mode).name, item.address].filter(Boolean).join(" · ")}
                  </span>
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className={styles.textBtn}
                    onClick={() => onRemove(item.poiId)}
                    aria-label={`${t("unsavePlace", lang)} ${item.name}`}
                  >
                    {t("unsavePlace", lang)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
