"use client";

import type { CSSProperties } from "react";
import { POICard } from "./poi-card";
import { t, type Language } from "@/lib/i18n";
import type { POI } from "@/lib/types";
import styles from "./poi-list.module.css";

export interface POIListProps {
  pois: POI[];
  /** 当前选中卡片 id（地图同步） */
  selectedId?: string | null;
  /** 当前高亮卡片 id（卡片-地图联动） */
  highlightedId?: string | null;
  onSelect?: (poi: POI) => void;
  onHover?: (id: string | null) => void;
  loading?: boolean;
  empty?: boolean;
  lang?: Language;
  accentColor?: string;
}

type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>;

const SKELETON_COUNT = 3;

export function POIList({
  pois,
  selectedId,
  highlightedId,
  onSelect,
  onHover,
  loading = false,
  empty = false,
  lang = "zh",
  accentColor,
}: POIListProps) {
  const showEmpty = !loading && (empty || pois.length === 0);

  return (
    <div
      className={styles.list}
      role="list"
      aria-label={lang === "zh" ? "POI 搜索结果" : "POI search results"}
      aria-busy={loading}
    >
      {loading ? (
        <>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div
              key={`skeleton-${i}`}
              className={styles.skeleton}
              style={{ "--index": i } as CSSVarStyle}
              aria-hidden="true"
            >
              <div
                className={styles.skeletonLine}
                style={{ width: "52%", height: 14 }}
              />
              <div
                className={styles.skeletonLine}
                style={{ width: "72%", height: 11 }}
              />
              <div className={styles.skeletonPhotos} />
            </div>
          ))}
        </>
      ) : showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <p className={styles.emptyTitle}>{t("noResults", lang)}</p>
          <p className={styles.emptyHint}>{t("noResultsHint", lang)}</p>
        </div>
      ) : (
        pois.map((poi, i) => (
          <div
            key={poi.id}
            role="listitem"
            className={styles.cardSlot}
            style={{ "--index": i } as CSSVarStyle}
            onMouseEnter={() => onHover?.(poi.id)}
            onMouseLeave={() => onHover?.(null)}
          >
            <POICard
              poi={poi}
              selected={poi.id === selectedId}
              highlighted={poi.id === highlightedId}
              onClick={onSelect}
              lang={lang}
              accentColor={accentColor}
            />
          </div>
        ))
      )}
    </div>
  );
}
