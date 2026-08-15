"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";
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
import styles from "./poi-card.module.css";

/** 公司 Logo：优先真实图片（logoUrl），加载失败回退 emoji */
function CompanyLogo({ logo, logoUrl }: { logo?: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <span className={styles.logoImgWrap} aria-hidden="true">
        <img
          src={logoUrl}
          alt=""
          className={styles.logoImg}
          loading="lazy"
          onError={() => setFailed(true)}
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
      onClick={() => onClick?.(poi)}
      onKeyDown={handleKeyDown}
    >
      {isDomainPOI(poi) ? (
        <DomainCardContent poi={poi} lang={lang} />
      ) : isRecruitmentPOI(poi) ? (
        <RecruitmentCardContent poi={poi} lang={lang} />
      ) : null}
    </article>
  );
}

function DomainCardContent({
  poi,
  lang,
}: {
  poi: DomainPOI;
  lang: Language;
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
}: {
  poi: RecruitmentPOI;
  lang: Language;
}) {
  const openPositions = poi.positions.filter((p) => p.status === "open");
  const openCount = openPositions.length;
  const scale = SCALE_LABELS[poi.company.scale];
  const scaleLabel = scale?.[lang] ?? poi.company.scale;
  const industries = poi.company.industries.map(
    (ind) => INDUSTRY_LABELS[ind]?.[lang] ?? ind
  );
  const positionsPreview = openPositions.slice(0, 3);
  const benefits = poi.benefits?.slice(0, 4) ?? [];

  const positionsLabel =
    lang === "zh"
      ? `${openCount} 个${t("viewPositions", lang)}`
      : `${openCount} ${t("viewPositions", lang)}`;

  return (
    <>
      <header className={styles.recruitHeader}>
        <CompanyLogo logo={poi.company.logo} logoUrl={poi.company.logoUrl} />
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
