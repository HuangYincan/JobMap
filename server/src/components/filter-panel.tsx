"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FilterConfig, FilterOption, FilterState } from "@/lib/types";
import { t, uiLabel, type Language } from "@/lib/i18n";
import styles from "./filter-panel.module.css";

export interface FilterPanelProps {
  /** Mode-specific filter configs, rendered in order. */
  filters: FilterConfig[];
  /** Current filter values keyed by filter key. */
  values: FilterState;
  /** Called whenever a control changes: `(key, value)` with the new value. */
  onChange: (key: string, value: any) => void;
  /** Clears all filters back to defaults. */
  onReset: () => void;
  /** Result count shown inside the Apply button. */
  resultCount?: number;
  /** When provided, renders the footer Apply button. */
  onApply?: () => void;
  /** UI language. */
  lang?: Language;
}

type FilterValue = FilterState[string];

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/** Formats a number without trailing float noise (3.5, not 3.5000001). */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

// ---------------------------------------------------------------------------
// Control components (presentational, one per FilterType)
// ---------------------------------------------------------------------------

function SelectControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const current = typeof value === "string" ? value : "";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const allLabel = lang === "zh" ? "全部" : "All";
  const matchedOption = config.options?.find((option) => option.value === current);
  const currentLabel = matchedOption ? uiLabel(matchedOption, lang) : allLabel;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (next: string) => {
    onChange(config.key, next);
    setOpen(false);
  };

  return (
    <div className={styles.control}>
      <span className={styles.label} id={`filter-${config.key}-label`}>
        {uiLabel(config, lang)}
      </span>
      <div className={styles.selectWrap} ref={wrapRef}>
        <button
          type="button"
          id={`filter-${config.key}`}
          className={`${styles.select} ${open ? styles.selectOpen : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`filter-${config.key}-label`}
          onClick={() => setOpen((v) => !v)}
        >
          {currentLabel}
        </button>
        {open && (
          <ul className={styles.selectMenu} role="listbox" aria-label={uiLabel(config, lang)}>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={current === ""}
                className={`${styles.selectOption} ${current === "" ? styles.selectOptionActive : ""}`}
                onClick={() => pick("")}
              >
                {allLabel}
              </button>
            </li>
            {config.options?.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current === option.value}
                  className={`${styles.selectOption} ${current === option.value ? styles.selectOptionActive : ""}`}
                  onClick={() => pick(option.value)}
                >
                  {uiLabel(option, lang)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MultiSelectControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const selected = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

  const toggleOption = (optionValue: string) => {
    const next = selected.includes(optionValue)
      ? selected.filter((v) => v !== optionValue)
      : [...selected, optionValue];
    onChange(config.key, next);
  };

  return (
    <div className={styles.control}>
      <span className={styles.label}>{uiLabel(config, lang)}</span>
      <div className={styles.chips} role="group" aria-label={uiLabel(config, lang)}>
        {config.options?.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`${styles.chip} ${active ? styles.chipActive : ""}`}
              aria-pressed={active}
              onClick={() => toggleOption(option.value)}
            >
              {uiLabel(option, lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RangeControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const step = config.step ?? 1;
  const span = max - min || 1;

  const rawLo =
    Array.isArray(value) && typeof value[0] === "number" ? value[0] : min;
  const rawHi =
    Array.isArray(value) && typeof value[1] === "number" ? value[1] : max;
  const lo = clamp(Math.min(rawLo, rawHi), min, max);
  const hi = clamp(Math.max(rawLo, rawHi), min, max);

  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;

  return (
    <div className={styles.control}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{uiLabel(config, lang)}</span>
        <span className={styles.value}>
          {formatNum(lo)}–{formatNum(hi)}
          {config.unit
            ? ` ${lang === "zh" ? config.unit : config.unitEn ?? config.unit}`
            : ""}
        </span>
      </div>
      <div className={styles.rangeTrack}>
        <div
          className={styles.rangeFill}
          style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }}
        />
        {/* 双头都用全局 [min,max] 几何，onChange 里钳制互不越界。动态 max/min 会让
            拇指按各自 [min,max] 定位而 fill 按全局 [min,max]，区间收窄时错位。 */}
        <input
          type="range"
          className={`${styles.rangeInput} ${styles.rangeInputMin}`}
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={`${uiLabel(config, lang)} min`}
          onChange={(e) => onChange(config.key, [Math.min(Number(e.target.value), hi), hi])}
        />
        <input
          type="range"
          className={`${styles.rangeInput} ${styles.rangeInputMax}`}
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label={`${uiLabel(config, lang)} max`}
          onChange={(e) => onChange(config.key, [lo, Math.max(Number(e.target.value), lo)])}
        />
      </div>
    </div>
  );
}

function SliderControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const min = config.min ?? 0;
  const max = config.max ?? 100;
  const step = config.step ?? 1;
  const span = max - min || 1;

  const v =
    typeof value === "number" && Number.isFinite(value)
      ? clamp(value, min, max)
      : min;
  const pct = ((v - min) / span) * 100;

  return (
    <div className={styles.control}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{uiLabel(config, lang)}</span>
        <span className={styles.value}>
          {formatNum(v)}
          {config.unit
            ? ` ${lang === "zh" ? config.unit : config.unitEn ?? config.unit}`
            : ""}
        </span>
      </div>
      <input
        type="range"
        className={styles.slider}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        min={min}
        max={max}
        step={step}
        value={v}
        aria-label={uiLabel(config, lang)}
        onChange={(e) => onChange(config.key, Number(e.target.value))}
      />
    </div>
  );
}

function ToggleControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const isOn = typeof value === "boolean" ? value : false;
  return (
    <div className={`${styles.control} ${styles.toggleRow}`}>
      <span className={styles.label}>{uiLabel(config, lang)}</span>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={uiLabel(config, lang)}
        className={`${styles.toggle} ${isOn ? styles.toggleOn : ""}`}
        onClick={() => onChange(config.key, !isOn)}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  );
}

function TaxonomyControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const selected = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
  const families = config.options ?? [];

  const isOn = (path: string) => selected.includes(path);

  const familyExpanded = (family: FilterOption) =>
    isOn(family.value) ||
    (family.children ?? []).some((child) => isOn(child.value));

  const toggle = (path: string, family?: FilterOption) => {
    const next = new Set(selected);
    if (next.has(path)) {
      next.delete(path);
      if (family && path === family.value) {
        for (const child of family.children ?? []) next.delete(child.value);
      }
    } else {
      next.add(path);
      if (family && path !== family.value) next.add(family.value);
    }
    onChange(config.key, [...next]);
  };

  return (
    <div className={styles.control}>
      <span className={styles.label}>{uiLabel(config, lang)}</span>
      <div className={styles.chips} role="group" aria-label={uiLabel(config, lang)}>
        {families.map((family) => {
          const active = familyExpanded(family);
          return (
            <button
              key={family.value}
              type="button"
              className={`${styles.chip} ${active ? styles.chipActive : ""}`}
              aria-pressed={active}
              onClick={() => toggle(family.value, family)}
            >
              {uiLabel(family, lang)}
            </button>
          );
        })}
      </div>
      {families.map((family) => {
        if (!family.children?.length || !familyExpanded(family)) return null;
        return (
          <div key={`${family.value}-leaves`} className={styles.taxonomyLeaves}>
            <span className={styles.taxonomyHint}>{uiLabel(family, lang)}</span>
            <div className={styles.chips} role="group" aria-label={uiLabel(family, lang)}>
              {family.children.map((child) => {
                const active = isOn(child.value);
                return (
                  <button
                    key={child.value}
                    type="button"
                    className={`${styles.chip} ${styles.chipLeaf} ${active ? styles.chipActive : ""}`}
                    aria-pressed={active}
                    onClick={() => toggle(child.value, family)}
                  >
                    {uiLabel(child, lang)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DateControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  const current = typeof value === "string" ? value : "";
  return (
    <div className={styles.control}>
      <label className={styles.label} htmlFor={`filter-${config.key}`}>
        {uiLabel(config, lang)}
      </label>
      <input
        id={`filter-${config.key}`}
        type="date"
        className={styles.dateInput}
        value={current}
        onChange={(e) => onChange(config.key, e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function FilterControl({
  config,
  value,
  onChange,
  lang,
}: {
  config: FilterConfig;
  value: FilterValue | undefined;
  onChange: (key: string, value: any) => void;
  lang: Language;
}) {
  switch (config.type) {
    case "select":
      return (
        <SelectControl config={config} value={value} onChange={onChange} lang={lang} />
      );
    case "multi-select":
      return (
        <MultiSelectControl
          config={config}
          value={value}
          onChange={onChange}
          lang={lang}
        />
      );
    case "range":
      return (
        <RangeControl config={config} value={value} onChange={onChange} lang={lang} />
      );
    case "slider":
      return (
        <SliderControl
          config={config}
          value={value}
          onChange={onChange}
          lang={lang}
        />
      );
    case "toggle":
      return (
        <ToggleControl config={config} value={value} onChange={onChange} lang={lang} />
      );
    case "date":
      return (
        <DateControl config={config} value={value} onChange={onChange} lang={lang} />
      );
    case "taxonomy":
      return (
        <TaxonomyControl
          config={config}
          value={value}
          onChange={onChange}
          lang={lang}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// FilterPanel
// ---------------------------------------------------------------------------

export function FilterPanel({
  filters,
  values,
  onChange,
  onReset,
  resultCount,
  onApply,
  lang = "zh",
}: FilterPanelProps) {
  return (
    <section className={styles.panel} aria-label={t("filter", lang)}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("filter", lang)}</h2>
        <button type="button" className={styles.resetButton} onClick={onReset}>
          {t("reset", lang)}
        </button>
      </header>

      <div className={styles.list}>
        {filters.map((config) => (
          <FilterControl
            key={config.key}
            config={config}
            value={values[config.key]}
            onChange={onChange}
            lang={lang}
          />
        ))}
      </div>

      {onApply && (
        <footer className={styles.footer}>
          <button type="button" className={styles.applyButton} onClick={onApply}>
            <span>{t("apply", lang)}</span>
            {resultCount !== undefined && (
              <span className={styles.applyCount}>{resultCount}</span>
            )}
          </button>
        </footer>
      )}
    </section>
  );
}
