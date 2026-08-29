"use client";

import { t, type Language } from "@/lib/i18n";
import styles from "./commute-chrome.module.css";

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
