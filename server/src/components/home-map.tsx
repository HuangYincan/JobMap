"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { getBrowserLanguage, t, type Language } from "@/lib/i18n";

import styles from "./home-map.module.css";

/**
 * GATE_A 守卫(2026-08-22 ws-gate-a,fix/gate-a-guard):
 * next/dynamic 的 loading fallback 原本无守卫——map-shell chunk 的 import promise 一旦
 * 挂起(Turbopack live-merge 坏状态 / 网络),页面永留 "Loading map…",且 GATE_B 的错误态
 * UI 根本不渲染(整个 MapShell 未挂载)。此组件给该帧加 15s 超时出口。
 *
 * 重试 = window.location.reload():Next dynamic 的 import promise 挂起后不会自行重试,
 * reload 是唯一可靠通道(与用户「刷新即好」行为一致)。
 */
const GUARD_TIMEOUT_MS = 15_000;

function MapLoadingGuard() {
  const [lang] = useState<Language>(() =>
    typeof window === "undefined" ? "en" : getBrowserLanguage(),
  );
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), GUARD_TIMEOUT_MS);
    // 组件卸载(dynamic 加载完成)后 cleanup 清 timer,失败态不再触发——零泄漏
    return () => clearTimeout(id);
  }, []);

  if (!timedOut) {
    // 计时内零视觉改动:与现状 Loading map… 完全一致
    return (
      <div
        style={{
          height: "100svh",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div className={styles.failed}>
      <p className={styles.failedTitle}>{t("mapLoadFailed", lang)}</p>
      <button
        type="button"
        className={styles.retry}
        onClick={() => window.location.reload()}
      >
        {t("mapLoadRetry", lang)}
      </button>
      <p className={styles.hint}>{t("mapLoadTimeoutHint", lang)}</p>
    </div>
  );
}

const MapShell = dynamic(() => import("@/components/map-shell").then((mod) => mod.MapShell), {
  ssr: false,
  loading: () => <MapLoadingGuard />,
});

export function HomeMap() {
  return <MapShell />;
}
