"use client";

import type { ReactNode } from "react";
import { t, type Language, type TranslationKey } from "@/lib/i18n";
import type { BasemapStyle } from "@/lib/saved-overlay";
import { ENGINE_PRIORITY, getEngine } from "@/lib/map-engine/engine-registry";
import { readEnginePreference } from "@/lib/map-engine/engine-preference";
import type { MapEngineId } from "@/lib/map-engine/types";
import { useMapEnginePanel } from "@/hooks/use-map-engine";
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
  /** Saved list + compare as L3, shown after 收藏图层 is on. */
  savedCard?: ReactNode;
}

/** 引擎 id → i18n 短名 key(chip 与状态行文案) */
const ENGINE_NAME_KEY: Record<MapEngineId, TranslationKey> = {
  amap: "engineAmap",
  tencent: "engineTencent",
  baidu: "engineBaidu",
};

/**
 * 地图源 section(ws-f,布局图已批):
 *
 * - 引擎列表与 configured 状态来自 engine-registry(ENGINE_PRIORITY 顺序 +
 *   getEngine(id).isConfigured());
 * - 活跃引擎与切换能力经引擎总线(useMapEnginePanel)获得,MapShell 无需
 *   传 props;移动端抽屉(≤767px)复用本组件(import { MapSourceSection })。
 * - ● 当前引擎(实心 #007AFF);░ 未配置 key 的引擎:40% 透明 + aria-disabled
 *   + tooltip「未配置 <keyVar>」,不可点;
 * - 状态行「高德 · 自动选择 · 点击切换」:手动点击后写 localStorage 偏好
 *   (switchEngine 内 writeEnginePreference)→ 文案变「手动选择」;偏好引擎
 *   未配置时自动回落并显示「自动选择」。
 */
export function MapSourceSection({ lang }: { lang: Language }) {
  const { engine, isSwitching, switchEngine } = useMapEnginePanel();
  const activeId = engine?.id ?? null;
  // 手动选择 = 偏好引擎即当前活跃引擎;偏好缺失/未配置(活跃引擎为回落结果)
  // → 自动选择
  const preference = readEnginePreference();
  const manual = Boolean(preference && activeId && preference === activeId);

  const statusParts = [
    activeId ? t(ENGINE_NAME_KEY[activeId], lang) : null,
    t(manual ? "engineManual" : "engineAuto", lang),
    t("engineClickToSwitch", lang),
  ].filter(Boolean);

  return (
    <section className={styles.trending} aria-label={t("mapSource", lang)}>
      <h3 className={styles.sectionLabel}>{t("mapSource", lang)}</h3>
      <div className={styles.engineGrid} role="listbox" aria-label={t("mapSource", lang)}>
        {ENGINE_PRIORITY.map((id) => {
          const descriptor = getEngine(id);
          const configured = descriptor.isConfigured();
          const active = activeId === id;
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={!configured || isSwitching}
              data-tooltip={
                configured ? undefined : `${t("engineNotConfigured", lang)} ${descriptor.keyVar}`
              }
              className={`${styles.engineChip} ${active ? styles.engineChipOn : ""} ${configured ? "" : styles.engineChipDisabled}`}
              onClick={() => {
                // 未配置/当前引擎/切换中 → 不可点(onClick 守卫,与 aria-disabled 一致)
                if (configured && !active && !isSwitching) void switchEngine(id);
              }}
            >
              <span className={styles.engineDot} aria-hidden="true" />
              {t(ENGINE_NAME_KEY[id], lang)}
            </button>
          );
        })}
      </div>
      <p className={styles.engineStatus}>{statusParts.join(" · ")}</p>
    </section>
  );
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
  savedCard,
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

        {/* 地图源(底图之后,布局图已批) */}
        <MapSourceSection lang={lang} />
      </aside>
      {savedCard}
    </div>
  );
}
