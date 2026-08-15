"use client";

import { useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { MapMode } from "@/lib/types";
import { ACTIVE_MODES, MODES } from "@/lib/modes";
import styles from "./mode-switcher.module.css";

export interface ModeSwitcherProps {
  /** Currently selected map mode */
  activeMode: MapMode;
  /** Called with the newly selected mode */
  onModeChange: (mode: MapMode) => void;
  /** Modes to show. Defaults to ACTIVE_MODES (domain + internship). */
  modes?: MapMode[];
  /** Extra class name applied to the root pill */
  className?: string;
}

/** Inline stroke icons keyed by ModeConfig.icon id */
const ICON_PATHS: Record<string, string> = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  briefcase:
    "M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-10 0V5h4v2h-4Zm-8 6h20",
  leaf: "M6 19C6 12 10 5 19 4c1 9-5 15-13 15Zm0 0-3 3m3-8c2.5 2.5 5 3.5 8 3.5",
  flower:
    "M9.5 6a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M9.5 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M3.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M15.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  graduation:
    "M22 9 12 4 2 9l10 5 10-5Zm0 0v6m-2.5-3.2V16c0 1.5-3.4 3-7.5 3s-7.5-1.5-7.5-3v-4.2",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0 0c2.5 0 4.5-4.5 4.5-10S14.5 2 12 2 7.5 6.5 7.5 12 9.5 22 12 22Zm-9.5-10h19",
};

/** Emoji fallback keyed by ModeConfig.icon id (used when no SVG path exists) */
const EMOJI_FALLBACK: Record<string, string> = {
  map: "🗺️",
  briefcase: "💼",
  leaf: "🍂",
  flower: "🌸",
  graduation: "🎓",
  globe: "🌍",
};

function ModeIcon({ iconId, className }: { iconId: string; className?: string }) {
  const path = ICON_PATHS[iconId];
  if (!path) {
    return (
      <span className={className} aria-hidden="true">
        {EMOJI_FALLBACK[iconId] ?? "📍"}
      </span>
    );
  }
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function ModeSwitcher({
  activeMode,
  onModeChange,
  modes = ACTIVE_MODES,
  className,
}: ModeSwitcherProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Defensive: only render modes that have a registered config.
  const list = modes.filter((mode): mode is MapMode => Boolean(MODES[mode]));
  if (list.length === 0) return null;

  // Keep exactly one radio tabbable (roving tabindex). If activeMode is not in
  // the visible list (caller error), fall back to the first mode.
  const activeIndex = list.indexOf(activeMode);
  const tabbableIndex = activeIndex >= 0 ? activeIndex : 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let dir = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") dir = 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") dir = -1;
    if (!dir) return;

    event.preventDefault();
    const next = (index + dir + list.length) % list.length;
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[next]?.focus();

    const nextMode = list[next];
    if (nextMode !== activeMode) onModeChange(nextMode);
  };

  const rootClassName = className ? `${styles.root} ${className}` : styles.root;

  return (
    <div ref={groupRef} className={rootClassName} role="radiogroup" aria-label="Map mode">
      {list.map((mode, index) => {
        const config = MODES[mode];
        const isActive = mode === activeMode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={index === tabbableIndex ? 0 : -1}
            className={styles.option}
            style={{ "--mode-color": config.color } as CSSProperties}
            onClick={() => onModeChange(mode)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            title={config.nameEn}
          >
            <ModeIcon iconId={config.icon} className={styles.icon} />
            <span className={styles.label}>{config.name}</span>
            <span className={styles.indicator} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
