"use client";

import { t, type Language } from "@/lib/i18n";
import type { BasemapStyle } from "@/lib/saved-overlay";
import styles from "./recent-panel.module.css";

export interface LayersPanelProps {
  lang: Language;
  savedOverlay: boolean;
  overlayCount: number;
  signedIn: boolean;
  mapStyle: BasemapStyle;
  onToggleOverlay: () => void;
  onMapStyle: (style: BasemapStyle) => void;
  onClose: () => void;
  shifted?: boolean;
}

export function LayersPanel({
  lang,
  savedOverlay,
  overlayCount,
  signedIn,
  mapStyle,
  onToggleOverlay,
  onMapStyle,
  onClose,
  shifted = false,
}: LayersPanelProps) {
  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
      <aside className={styles.sidebar} aria-label={t("layers", lang)}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t("layers", lang)}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("closePanel", lang)}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <section className={styles.trending} aria-label={t("savedOverlay", lang)}>
          <h3 className={styles.sectionLabel}>{t("savedOverlay", lang)}</h3>
          <button
            type="button"
            className={`${styles.layerRow} ${savedOverlay ? styles.layerRowOn : ""}`}
            aria-pressed={savedOverlay}
            onClick={onToggleOverlay}
          >
            <span>
              <strong>{t("savedOverlay", lang)}</strong>
              <small>
                {signedIn
                  ? overlayCount
                    ? `${overlayCount}`
                    : t("savedEmpty", lang)
                  : t("savedNeedSignIn", lang)}
              </small>
            </span>
            <span className={`${styles.switch} ${savedOverlay ? styles.switchOn : ""}`} aria-hidden="true" />
          </button>
        </section>

        <section className={styles.trending} aria-label={t("mapStyle", lang)}>
          <h3 className={styles.sectionLabel}>{t("mapStyle", lang)}</h3>
          <div className={styles.layerStyles} role="listbox" aria-label={t("mapStyle", lang)}>
            {(
              [
                ["normal", "standard", styles.thumb1],
                ["satellite", "satellite", styles.thumb2],
                ["whitesmoke", "dark", styles.thumb3],
              ] as const
            ).map(([value, label, thumb]) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={mapStyle === value}
                className={`${styles.layerStyle} ${mapStyle === value ? styles.layerStyleOn : ""}`}
                onClick={() => onMapStyle(value)}
              >
                <span className={`${styles.layerThumb} ${thumb}`} />
                {t(label, lang)}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
