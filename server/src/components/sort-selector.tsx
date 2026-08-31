"use client";

import { useEffect, useRef, useState } from "react";
import type { SortOption } from "@/lib/types";
import { t, uiLabel, type Language } from "@/lib/i18n";
import styles from "./sort-selector.module.css";

export interface SortSelectorProps {
  /** Sort options to display. */
  options: SortOption[];
  /** Currently selected sort key. */
  value: string;
  /** Called with the newly selected sort key. */
  onChange: (value: string) => void;
  /** UI language. */
  lang?: Language;
}

export function SortSelector({
  options,
  value,
  onChange,
  lang = "zh",
}: SortSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.key === value);

  // Close on outside pointer-down or Escape while open.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.triggerLabel}>{current ? uiLabel(current, lang) : value}</span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul className={styles.menu} role="listbox" aria-label={t("sort", lang)}>
          {options.map((option) => {
            const active = option.key === value;
            return (
              <li key={option.key} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`${styles.option} ${active ? styles.optionActive : ""}`}
                  onClick={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                >
                  {uiLabel(option, lang)}
                  {active && (
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
