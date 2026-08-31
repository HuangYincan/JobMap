"use client";

import { t, type Language } from "@/lib/i18n";
import styles from "./route-overlay-bar.module.css";

export type RouteOverlayKind =
  | "idle"
  | "missing-origin"
  | "location-denied"
  | "loading"
  | "provider"
  | "estimate"
  | "expired"
  | "offline"
  | "forbidden"
  | "not-found"
  | "position-offline"
  | "partial-fail";

export interface RouteOverlayModel {
  kind: RouteOverlayKind;
  provider?: string;
  fetchedAt?: string;
  trafficAware?: boolean;
  quality?: string;
  reason?: string;
  failedCount?: number;
}

export function RouteOverlayBar({
  model,
  lang = "zh",
  shifted = false,
  embedded = false,
  onRetry,
}: {
  model: RouteOverlayModel;
  lang?: Language;
  shifted?: boolean;
  embedded?: boolean;
  onRetry?: () => void;
}) {
  // 2026-08-29: 去掉地图「路线来源」霜面条的默认占位（直线估算 / 未定位）。
  if (
    model.kind === "idle" ||
    model.kind === "estimate" ||
    model.kind === "missing-origin" ||
    model.kind === "location-denied"
  ) {
    return null;
  }
  const text = overlayCopy(model, lang);
  return (
    <div
      className={`${styles.bar} ${shifted ? styles.shifted : ""} ${embedded ? styles.embedded : ""}`}
      role="status"
      data-route-overlay="true"
    >
      <span className={styles.label}>{t("routeSource", lang)}</span>
      <span className={styles.text}>{text}</span>
      {(model.kind === "offline" || model.kind === "expired") && onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t("routeRetry", lang)}
        </button>
      )}
    </div>
  );
}

function overlayCopy(model: RouteOverlayModel, lang: Language): string {
  switch (model.kind) {
    case "missing-origin":
      return t("commuteOriginMissing", lang);
    case "location-denied":
      return t("commuteOriginDenied", lang);
    case "loading":
      return t("routeLoading", lang);
    case "estimate":
      return `${t("routeSourceEstimate", lang)}${model.reason ? ` · ${model.reason}` : ""}`;
    case "provider": {
      const traffic = model.trafficAware ? t("routeHasTraffic", lang) : t("routeNoTraffic", lang);
      const when = model.fetchedAt ? ` · ${model.fetchedAt}` : "";
      return `${model.provider ?? "—"}${when} · ${traffic} · ${model.quality ?? ""}`;
    }
    case "expired":
      return t("routeExpired", lang);
    case "offline":
      return t("routeOffline", lang);
    case "forbidden":
      return t("routeForbidden", lang);
    case "not-found":
      return t("routeNotFound", lang);
    case "position-offline":
      return t("routePositionOffline", lang);
    case "partial-fail":
      return model.failedCount
        ? `${t("routePartialFail", lang)} · ${model.failedCount}`
        : t("routePartialFail", lang);
    default:
      return t("routeSource", lang);
  }
}
