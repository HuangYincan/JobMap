"use client";

import type { CommuteMode } from "@/lib/commute";
import {
  COMMUTE_SLIDER_DEFAULT,
  COMMUTE_SLIDER_MAX,
  COMMUTE_SLIDER_MIN,
  type CommuteBucket,
} from "@/lib/commute-filter";
import { t, type Language } from "@/lib/i18n";
import styles from "./commute-chrome.module.css";

const MODES: CommuteMode[] = ["walk", "bike", "transit", "drive"];
const MODE_KEY: Record<CommuteMode, "commuteWalk" | "commuteBike" | "commuteTransit" | "commuteDrive"> = {
  walk: "commuteWalk",
  bike: "commuteBike",
  transit: "commuteTransit",
  drive: "commuteDrive",
};

export function CommuteChrome({
  lang = "zh",
  originReady,
  originDenied,
  originPending = false,
  mode,
  onModeChange,
  maxMinutes,
  onMaxMinutesChange,
  tab,
  onTabChange,
  strictCount,
  nearCount,
  compareCount,
  onToggleCompare,
  compareOpen,
  closestLabel,
}: {
  lang?: Language;
  originReady: boolean;
  originDenied: boolean;
  originPending?: boolean;
  mode: CommuteMode;
  onModeChange: (mode: CommuteMode) => void;
  maxMinutes: number;
  onMaxMinutesChange: (minutes: number) => void;
  tab: CommuteBucket;
  onTabChange: (tab: CommuteBucket) => void;
  strictCount: number;
  nearCount: number;
  compareCount: number;
  onToggleCompare?: () => void;
  compareOpen?: boolean;
  closestLabel?: string;
}) {
  const originText = originDenied
    ? t("commuteOriginDenied", lang)
    : originPending
      ? t("loading", lang)
      : originReady
        ? t("commuteOriginLocated", lang)
        : t("commuteOriginMissing", lang);

  return (
    <div className={styles.chrome} data-commute-chrome="true">
      <p className={styles.origin}>
        <span className={styles.originLabel}>{t("commuteOrigin", lang)}</span>
        {originText}
      </p>
      <div className={styles.modes} role="group" aria-label={t("commute", lang)}>
        {MODES.map((item) => (
          <button
            key={item}
            type="button"
            className={`${styles.modeBtn} ${mode === item ? styles.modeOn : ""}`}
            aria-pressed={mode === item}
            onClick={() => onModeChange(item)}
          >
            {t(MODE_KEY[item], lang)}
          </button>
        ))}
      </div>
      <label className={styles.sliderRow}>
        <span>
          {t("commuteMaxMinutes", lang)} · {maxMinutes || COMMUTE_SLIDER_DEFAULT}
        </span>
        <input
          type="range"
          min={COMMUTE_SLIDER_MIN}
          max={COMMUTE_SLIDER_MAX}
          value={maxMinutes}
          onChange={(e) => onMaxMinutesChange(Number(e.target.value))}
        />
      </label>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "strict"}
          className={tab === "strict" ? styles.tabOn : styles.tab}
          onClick={() => onTabChange("strict")}
        >
          {t("commuteStrictTab", lang)} {strictCount}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "near"}
          className={tab === "near" ? styles.tabOn : styles.tab}
          onClick={() => onTabChange("near")}
        >
          {t("commuteNearTab", lang)} {nearCount}
        </button>
        {onToggleCompare && (
          <button
            type="button"
            className={`${styles.compare} ${compareOpen ? styles.tabOn : ""}`}
            aria-pressed={Boolean(compareOpen)}
            onClick={onToggleCompare}
          >
            {t("commuteCompare", lang)} {compareCount}
          </button>
        )}
      </div>
      {!originPending && !originReady && (
        <p className={styles.warn}>{originDenied ? t("commuteOriginDenied", lang) : t("commuteOriginMissing", lang)}</p>
      )}
      {originReady && strictCount === 0 && closestLabel && (
        <>
          <p className={styles.warn}>{t("commuteStrictEmpty", lang)}</p>
          <p className={styles.hint}>{closestLabel}</p>
          <p className={styles.hint}>{t("commuteWidenHint", lang)}</p>
        </>
      )}
    </div>
  );
}

export function WorkExploreTabs({
  lang = "zh",
  value,
  onChange,
}: {
  lang?: Language;
  value: "jobs" | "compare" | "trip";
  onChange: (next: "jobs" | "compare" | "trip") => void;
}) {
  const items: Array<{ id: "jobs" | "compare" | "trip"; key: "exploreJobsTab" | "exploreCompareTab" | "exploreTripTab" }> = [
    { id: "jobs", key: "exploreJobsTab" },
    { id: "compare", key: "exploreCompareTab" },
    { id: "trip", key: "exploreTripTab" },
  ];
  return (
    <div className={styles.exploreTabs} role="tablist" data-work-explore-tabs="true">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className={value === item.id ? styles.exploreOn : styles.exploreTab}
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {t(item.key, lang)}
        </button>
      ))}
    </div>
  );
}
