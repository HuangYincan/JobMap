"use client";

import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  formatDistance,
  formatSalary,
  isDomainPOI,
  isRecruitmentPOI,
  type DomainPOI,
  type POI,
  type RecruitmentPOI,
} from "@/lib/types";
import { t, type Language } from "@/lib/i18n";
import { isAlivePosition } from "@/lib/position-alive";
import { faviconCandidatesFromUrl } from "@/lib/company-logo";
import styles from "./poi-card.module.css";

/**
 * 公司 Logo：优先真实图片（logoUrl），加载失败沿 favicon 候选链切换
 * （careerUrl 派生的 favicon.im → icon.horse，含裸 IP 域名映射），全部失败回退 emoji。
 */
function CompanyLogo({
  logo,
  logoUrl,
  careerUrl,
}: {
  logo?: string;
  logoUrl?: string;
  careerUrl?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  // 候选：logoUrl 本身 → careerUrl 的 favicon 候选链（去重，防止同一 URL 重试）
  const candidates = useMemo(() => {
    if (!logoUrl) return [];
    return [logoUrl, ...faviconCandidatesFromUrl(careerUrl).filter((u) => u !== logoUrl)];
  }, [logoUrl, careerUrl]);
  const src = attempt < candidates.length ? candidates[attempt] : undefined;

  if (src) {
    return (
      <span className={styles.logoImgWrap} aria-hidden="true">
        <img
          src={src}
          alt=""
          className={styles.logoImg}
          loading="lazy"
          onError={() => setAttempt((n) => n + 1)}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return logo ? (
    <span className={styles.logo} aria-hidden="true">
      {logo}
    </span>
  ) : null;
}

export interface POICardProps {
  poi: POI;
  /** 选中态（与地图同步） */
  selected?: boolean;
  /** 高亮态（卡片-地图联动，hover 自地图侧触发） */
  highlighted?: boolean;
  onClick?: (poi: POI) => void;
  lang?: Language;
  /** 模式主题色（作为 CSS 变量 --accent 注入） */
  accentColor?: string;
  /** 卡片右上「移除收藏」按钮(仅收藏模式传入;不传则完全不渲染,零影响普通模式) */
  onRemove?: (poi: POI) => void;
}

/** CSS 自定义属性样式类型（React 19 移除了默认 index signature） */
type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>;

const DEFAULT_ACCENT = "#007AFF";

const FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23e6e9ec'/%3E%3C/svg%3E";

/** 公司规模标签映射 */
const SCALE_LABELS: Record<
  RecruitmentPOI["company"]["scale"],
  { zh: string; en: string }
> = {
  bigtech: { zh: "大厂", en: "Big Tech" },
  unicorn: { zh: "独角兽", en: "Unicorn" },
  startup: { zh: "创业公司", en: "Startup" },
  enterprise: { zh: "大型企业", en: "Enterprise" },
};

/**
 * 移除收藏 icon 按钮(2026-08-22 收藏模式卡片化):liquid glass icon 按钮,
 * 32px 命中区、透明底 → hover 变调(--accent,主交互色 #007AFF)。
 * 点击/键盘不冒泡到卡片(article)与 cardSlot/list,避免触发选中/取消选中。
 */
function RemoveSavedButton({
  poi,
  onRemove,
  lang,
}: {
  poi: POI;
  onRemove: (poi: POI) => void;
  lang: Language;
}) {
  return (
    <button
      type="button"
      className={styles.removeBtn}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(poi);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={t("removeSaved", lang)}
      title={t("removeSaved", lang)}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1.5 12a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9L18 7M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  );
}

/** 行业标签映射（seed / amap 返回行业 key → 显示文本） */
const INDUSTRY_LABELS: Record<string, { zh: string; en: string }> = {
  internet: { zh: "互联网", en: "Internet" },
  finance: { zh: "金融", en: "Finance" },
  consulting: { zh: "咨询", en: "Consulting" },
  hardware: { zh: "硬件制造", en: "Hardware" },
  ai: { zh: "人工智能", en: "AI" },
  ecommerce: { zh: "电商", en: "E-commerce" },
  game: { zh: "游戏", en: "Gaming" },
  automotive: { zh: "汽车", en: "Automotive" },
  biotech: { zh: "生物医药", en: "Biotech" },
  consumer: { zh: "消费品", en: "Consumer" },
  transport: { zh: "出行", en: "Transport" },
  content: { zh: "内容", en: "Content" },
};

/** 将 hex 颜色转为 rgba（用于强调色半透明底） */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) {
    return `rgba(0, 122, 255, ${alpha})`;
  }
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildAriaLabel(poi: POI, lang: Language): string {
  if (isDomainPOI(poi)) {
    const parts = [poi.name, poi.category];
    if (typeof poi.rating === "number") {
      parts.push(`${lang === "zh" ? "评分" : "Rating"} ${poi.rating.toFixed(1)}`);
    }
    return parts.join(", ");
  }
  const industries = poi.company.industries
    .map((ind) => INDUSTRY_LABELS[ind]?.[lang] ?? ind)
    .join(", ");
  const parts = [poi.name, industries];
  if (typeof poi.company.rating === "number") {
    parts.push(
      `${lang === "zh" ? "评分" : "Rating"} ${poi.company.rating.toFixed(1)}`
    );
  }
  return parts.join(", ");
}

export function POICard({
  poi,
  selected = false,
  highlighted = false,
  onClick,
  lang = "zh",
  accentColor,
  onRemove,
}: POICardProps) {
  const accent = accentColor || DEFAULT_ACCENT;
  const styleVars: CSSVarStyle = {
    "--accent": accent,
    "--accent-soft": hexToRgba(accent, 0.1),
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(poi);
    }
  };

  const classes = [
    styles.card,
    selected ? styles.selected : "",
    highlighted ? styles.highlighted : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={classes}
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={buildAriaLabel(poi, lang)}
      style={styleVars}
      onClick={(e) => {
        // 卡片自身点击不冒泡到 cardSlot/list,避免触发 onDeselect 取消选中(交互 2)
        e.stopPropagation();
        onClick?.(poi);
      }}
      onKeyDown={handleKeyDown}
    >
      {isDomainPOI(poi) ? (
        <DomainCardContent poi={poi} lang={lang} onRemove={onRemove} />
      ) : isRecruitmentPOI(poi) ? (
        <RecruitmentCardContent poi={poi} lang={lang} onRemove={onRemove} />
      ) : null}
    </article>
  );
}

function DomainCardContent({
  poi,
  lang,
  onRemove,
}: {
  poi: DomainPOI;
  lang: Language;
  onRemove?: (poi: POI) => void;
}) {
  const subtitle = [poi.category, poi.subcategory].filter(Boolean).join(" · ");
  const price = poi.priceLevel ? "¥".repeat(poi.priceLevel) : null;
  const photos = poi.photos?.slice(0, 3) ?? [];

  return (
    <>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h3 className={styles.name}>{poi.name}</h3>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {onRemove && <RemoveSavedButton poi={poi} onRemove={onRemove} lang={lang} />}
      </header>

      <div className={styles.metaRow}>
        {typeof poi.rating === "number" && (
          <span className={styles.rating}>
            <span className={styles.star} aria-hidden="true">
              ★
            </span>
            {poi.rating.toFixed(1)}
          </span>
        )}
        {price && <span className={styles.price}>{price}</span>}
        <span className={styles.distance}>{formatDistance(poi.distance)}</span>
        <span className={styles.metaSpacer} />
        {poi.openHours && (
          <span className={styles.openBadge}>{poi.openHours}</span>
        )}
      </div>

      {photos.length > 0 && (
        <div
          className={styles.photos}
          style={{
            gridTemplateColumns: `repeat(${photos.length}, 1fr)`,
          }}
        >
          {photos.map((src, i) => (
            <img
              key={`${poi.id}-photo-${i}`}
              src={src}
              alt=""
              loading="lazy"
              className={styles.photo}
              onError={(e) => {
                e.currentTarget.src = FALLBACK_IMAGE;
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RecruitmentCardContent({
  poi,
  lang,
  onRemove,
}: {
  poi: RecruitmentPOI;
  lang: Language;
  onRemove?: (poi: POI) => void;
}) {
  const openPositions = poi.positions.filter((p) => isAlivePosition(p));
  const openCount = openPositions.length;
  const scale = SCALE_LABELS[poi.company.scale];
  const scaleLabel = scale?.[lang] ?? poi.company.scale;
  const industries = poi.company.industries.map(
    (ind) => INDUSTRY_LABELS[ind]?.[lang] ?? ind
  );
  // 2026-08-20 (positions 去重): import 自愈落库前的过渡期, 同 external_id 双行
  // (旧 seed source + 新真实 source) 会同时进入预览 → <span key={pos.id}> 同 key
  // 警告上百条。渲染前按 pos.id 去重 (保序保首个), 残余重复也绝不报警。
  const seenPositionIds = new Set<string>();
  const positionsPreview = openPositions
    .filter((pos) => {
      if (seenPositionIds.has(pos.id)) return false;
      seenPositionIds.add(pos.id);
      return true;
    })
    .slice(0, 3);
  const benefits = poi.benefits?.slice(0, 4) ?? [];

  const positionsLabel =
    lang === "zh"
      ? `${openCount} 个${t("viewPositions", lang)}`
      : `${openCount} ${t("viewPositions", lang)}`;

  return (
    <>
      <header className={styles.recruitHeader}>
        <CompanyLogo
          logo={poi.company.logo}
          logoUrl={poi.company.logoUrl}
          careerUrl={poi.company.careerUrl}
        />
        <div className={styles.titleBlock}>
          <h3 className={styles.name}>{poi.name}</h3>
          {industries.length > 0 && (
            <div className={styles.chips}>
              {industries.map((ind) => (
                <span key={ind} className={styles.chip}>
                  {ind}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={styles.scaleBadge}>{scaleLabel}</span>
        {onRemove && <RemoveSavedButton poi={poi} onRemove={onRemove} lang={lang} />}
      </header>

      <div className={styles.metaRow}>
        {typeof poi.company.rating === "number" && (
          <span className={styles.rating}>
            <span className={styles.star} aria-hidden="true">
              ★
            </span>
            {poi.company.rating.toFixed(1)}
          </span>
        )}
        {openCount > 0 && (
          <span className={styles.positionsBadge}>{positionsLabel}</span>
        )}
        <span className={styles.metaSpacer} />
        <span className={styles.distance}>{formatDistance(poi.distance)}</span>
      </div>

      {positionsPreview.length > 0 && (
        <div className={styles.positions}>
          {positionsPreview.map((pos) => (
            <span key={pos.id} className={styles.positionPill}>
              <span className={styles.positionTitle}>{pos.title}</span>
              <span className={styles.positionSalary}>
                {formatSalary(pos.salary)}
              </span>
            </span>
          ))}
        </div>
      )}

      {benefits.length > 0 && (
        <div className={styles.benefits}>
          {benefits.map((b) => (
            <span key={b} className={styles.benefitChip}>
              {b}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
