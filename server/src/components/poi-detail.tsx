"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  cardDisplayMeters,
  formatDistance,
  formatSalary,
  isDomainPOI,
  isRecruitmentPOI,
  type JobFamily,
  type POI,
  type Position,
  type RecruitmentPOI,
} from "@/lib/types";
import { estimateCommuteOptions, amapDirectionsUrl, type CommuteMode } from "@/lib/commute";
import { t, type Language } from "@/lib/i18n";
import { isAlivePosition } from "@/lib/position-alive";
import { faviconCandidatesFromUrl } from "@/lib/company-logo";
import { JOB_FAMILY_PLUGIN, ROLE_OPTIONS } from "@/lib/job-taxonomy";
import {
  EMPTY_POSITION_FILTERS,
  filterPositions,
  hasActivePositionFilters,
  type PositionFilters,
} from "@/lib/position-filters";
import styles from "./poi-detail.module.css";

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

const SCALE_LABELS: Record<
  RecruitmentPOI["company"]["scale"],
  { zh: string; en: string }
> = {
  bigtech: { zh: "大厂", en: "Big Tech" },
  unicorn: { zh: "独角兽", en: "Unicorn" },
  startup: { zh: "创业公司", en: "Startup" },
  enterprise: { zh: "大型企业", en: "Enterprise" },
};

/** 岗位类型 chips(实习/校招/社招)— 顶层选项取自 JOB_FAMILY_PLUGIN,标签单一来源 */
const FAMILY_OPTIONS: { value: JobFamily; label: string }[] = (
  JOB_FAMILY_PLUGIN.filter.options ?? []
).map((option) => ({ value: option.value as JobFamily, label: option.label }));

/** 多选 chip toggle:在组内加/减一个值 */
function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export interface POIDetailViewProps {
  poi: POI;
  onBack: () => void;
  lang?: Language;
  accentColor?: string;
  onSelectPosition?: (position: Position) => void;
  selectedPositionId?: string | null;
  saved?: boolean;
  onToggleSave?: () => void;
  /** 岗位详情展示距离圆心，与卡片同口径（用户定位，缺则视野中心）。 */
  displayOrigin?: { lng: number; lat: number } | null;
}

export function POIDetailView({
  poi,
  onBack,
  lang = "zh",
  accentColor = "#007AFF",
  onSelectPosition,
  selectedPositionId,
  saved = false,
  onToggleSave,
  displayOrigin,
}: POIDetailViewProps) {
  return (
    <div className={styles.detail} style={{ "--accent": accentColor } as CSSProperties}>
      <header className={styles.topBar}>
        <button className={styles.backButton} onClick={onBack} aria-label={t("backToList", lang)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M15 6 9 12l6 6" />
          </svg>
          <span>{t("backToList", lang)}</span>
        </button>
        {onToggleSave && (
          <button
            type="button"
            className={`${styles.saveButton} ${saved ? styles.saveButtonOn : ""}`}
            onClick={onToggleSave}
            aria-pressed={saved}
            aria-label={saved ? t("unsavePlace", lang) : t("savePlace", lang)}
          >
            {saved ? t("unsavePlace", lang) : t("savePlace", lang)}
          </button>
        )}
      </header>

      <div className={styles.body}>
        {isDomainPOI(poi) ? (
          <DomainDetail poi={poi} lang={lang} />
        ) : isRecruitmentPOI(poi) ? (
          <RecruitmentDetail
            poi={poi}
            lang={lang}
            onSelectPosition={onSelectPosition}
            selectedPositionId={selectedPositionId}
            displayOrigin={displayOrigin}
          />
        ) : null}
      </div>
    </div>
  );
}

function DomainDetail({ poi, lang }: { poi: Extract<POI, { kind: "domain" }>; lang: Language }) {
  const photos = poi.photos ?? [];
  return (
    <>
      <h2 className={styles.title}>{poi.name}</h2>
      <p className={styles.subtitle}>
        {[poi.category, poi.subcategory].filter(Boolean).join(" · ")}
      </p>
      <div className={styles.meta}>
        {typeof poi.rating === "number" && (
          <span className={styles.rating}>★ {poi.rating.toFixed(1)}</span>
        )}
        {typeof poi.reviewCount === "number" && poi.reviewCount > 0 && (
          <span>
            {poi.reviewCount} {t("reviews", lang)}
          </span>
        )}
        <span>{formatDistance(poi.distance)}</span>
      </div>
      {photos.length > 0 && <PhotoStrip photos={photos} lang={lang} />}
      <InfoRow label={t("address", lang)} value={poi.location.address} />
      <InfoRow label={t("phone", lang)} value={poi.tel} />
      <InfoRow label={t("hours", lang)} value={poi.openHours} />
      <ReviewSection
        rating={poi.rating}
        reviewCount={poi.reviewCount}
        reviews={poi.reviews}
        reviewUrl={amapReviewUrl(poi)}
        lang={lang}
      />
      <CommuteSection
        meters={poi.distance}
        destination={{ lng: poi.location.lng, lat: poi.location.lat, name: poi.name }}
        lang={lang}
      />
    </>
  );
}

function RecruitmentDetail({
  poi,
  lang,
  onSelectPosition,
  selectedPositionId,
  displayOrigin,
}: {
  poi: RecruitmentPOI;
  lang: Language;
  onSelectPosition?: (position: Position) => void;
  selectedPositionId?: string | null;
  displayOrigin?: { lng: number; lat: number } | null;
}) {
  const [logoAttempt, setLogoAttempt] = useState(0);
  const [filters, setFilters] = useState<PositionFilters>(EMPTY_POSITION_FILTERS);
  // 公司 logo 候选链：logoUrl → careerUrl 派生的 favicon（favicon.im → icon.horse，
  // 含裸 IP 域名映射），全部失败回退 emoji
  const logoCandidates = useMemo(() => {
    if (!poi.company.logoUrl) return [];
    return [
      poi.company.logoUrl,
      ...faviconCandidatesFromUrl(poi.company.careerUrl).filter(
        (u) => u !== poi.company.logoUrl
      ),
    ];
  }, [poi.company.logoUrl, poi.company.careerUrl]);
  const logoSrc =
    logoAttempt < logoCandidates.length ? logoCandidates[logoAttempt] : undefined;
  const industries = poi.company.industries.map((ind) => INDUSTRY_LABELS[ind]?.[lang] ?? ind);
  const scale = SCALE_LABELS[poi.company.scale]?.[lang] ?? poi.company.scale;
  const open = useMemo(() => poi.positions.filter((p) => isAlivePosition(p)), [poi.positions]);
  // 岗位筛选是纯本地视图过滤:切换公司 / 关闭详情即重置,不碰全局 FilterState
  const visible = useMemo(() => filterPositions(open, filters), [open, filters]);
  const filtersActive = hasActivePositionFilters(filters);

  return (
    <>
      <div className={styles.companyHead}>
        {logoSrc ? (
          <img
            className={styles.logo}
            src={logoSrc}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setLogoAttempt((n) => n + 1)}
          />
        ) : (
          <span className={styles.logoFallback} aria-hidden="true">
            {poi.company.logo || "🏢"}
          </span>
        )}
        <div>
          <h2 className={styles.title}>{poi.name}</h2>
          <p className={styles.subtitle}>
            {[scale, ...industries].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className={styles.meta}>
        {typeof poi.company.rating === "number" && (
          <span className={styles.rating}>★ {poi.company.rating.toFixed(1)}</span>
        )}
        <span>
          {open.length} {t("viewPositions", lang)}
        </span>
        <span>{formatDistance(cardDisplayMeters(poi, displayOrigin))}</span>
      </div>
      <InfoRow label={t("address", lang)} value={poi.location.address} />
      {poi.company.summary && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("companySummary", lang)}</h3>
          <p className={styles.prose}>{poi.company.summary}</p>
        </section>
      )}
      {poi.benefits && poi.benefits.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("benefits", lang)}</h3>
          <div className={styles.chips}>
            {poi.benefits.map((b) => (
              <span key={b} className={styles.chip}>
                {b}
              </span>
            ))}
          </div>
        </section>
      )}
      {open.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            {filtersActive
              ? `${t("viewPositions", lang)} ${visible.length} / ${open.length}`
              : `${t("viewPositions", lang)} (${open.length})`}
          </h3>
          <div className={styles.jobFilter}>
            <div className={styles.jobFilterSearchWrap}>
              <svg
                className={styles.jobFilterSearchIcon}
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                className={styles.jobFilterSearch}
                placeholder={t("searchPositions", lang)}
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                aria-label={t("searchPositions", lang)}
              />
            </div>
            <div className={styles.jobFilterRow}>
              <span className={styles.jobFilterLabel}>{t("positionRole", lang)}</span>
              {ROLE_OPTIONS.map((role) => {
                const active = filters.roles.includes(role.value);
                return (
                  <button
                    key={role.value}
                    type="button"
                    className={`${styles.jobFilterChip} ${active ? styles.jobFilterChipActive : ""}`}
                    aria-pressed={active}
                    onClick={() => setFilters((f) => ({ ...f, roles: toggleValue(f.roles, role.value) }))}
                  >
                    {role.label}
                  </button>
                );
              })}
            </div>
            <div className={styles.jobFilterRow}>
              <span className={styles.jobFilterLabel}>{t("positionType", lang)}</span>
              {FAMILY_OPTIONS.map((family) => {
                const active = filters.families.includes(family.value);
                return (
                  <button
                    key={family.value}
                    type="button"
                    className={`${styles.jobFilterChip} ${active ? styles.jobFilterChipActive : ""}`}
                    aria-pressed={active}
                    onClick={() => setFilters((f) => ({ ...f, families: toggleValue(f.families, family.value) }))}
                  >
                    {family.label}
                  </button>
                );
              })}
              {filtersActive && (
                <button
                  type="button"
                  className={styles.jobFilterClear}
                  onClick={() => setFilters(EMPTY_POSITION_FILTERS)}
                >
                  {t("clearFilters", lang)}
                </button>
              )}
            </div>
          </div>
          {visible.length > 0 ? (
            <ul className={styles.jobs}>
              {visible.map((pos) => (
                <li key={pos.id}>
                  <button
                    type="button"
                    className={`${styles.job} ${selectedPositionId === pos.id ? styles.jobSelected : ""}`}
                    onClick={() => onSelectPosition?.(pos)}
                  >
                    <div className={styles.jobTitle}>
                      {pos.title}
                      {pos.aggregate && (
                        <span className={styles.jobBadge}>{t("aggregateBadge", lang)}</span>
                      )}
                    </div>
                    <div className={styles.jobMeta}>
                      {[pos.department, formatSalary(pos.salary), pos.education]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {pos.skills && pos.skills.length > 0 && (
                      <div className={styles.chips}>
                        {pos.skills.slice(0, 4).map((s) => (
                          <span key={s} className={styles.chip}>
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.jobFilterEmpty}>{t("noMatchingPositions", lang)}</p>
          )}
        </section>
      )}
    </>
  );
}

/**
 * 高德评价页 URL:仅当 poi.id 是真 poiid(本地库 / AMap 搜索返回的真实 id)才可拼;
 * 合成 id(`amap-${lng}-${lat}-${name}`)不是真 poiid,不能拿来拼链接。
 * 已有 review 文本时无需外链。
 */
function amapReviewUrl(poi: { id: string; reviews?: unknown[] }): string | undefined {
  if (poi.reviews?.length) return undefined;
  if (!poi.id || poi.id.startsWith("amap-")) return undefined;
  return `https://www.amap.com/place/${encodeURIComponent(poi.id)}`;
}

function ReviewSection({
  rating,
  reviewCount,
  reviews,
  reviewUrl,
  lang,
}: {
  rating?: number;
  reviewCount?: number;
  reviews?: { id: string; author: string; rating?: number; excerpt: string }[];
  reviewUrl?: string;
  lang: Language;
}) {
  if (!rating && !reviewCount && !reviews?.length) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("reviewSection", lang)}</h3>
      {(typeof rating === "number" || typeof reviewCount === "number") && (
        <p className={styles.prose}>
          {typeof rating === "number" ? `★ ${rating.toFixed(1)}` : ""}
          {typeof rating === "number" && typeof reviewCount === "number" ? " · " : ""}
          {typeof reviewCount === "number" ? `${reviewCount} ${t("reviews", lang)}` : ""}
        </p>
      )}
      {reviews && reviews.length > 0 ? (
        <ul className={styles.reviews}>
          {reviews.map((review) => (
            <li key={review.id} className={styles.review}>
              <div className={styles.reviewHead}>
                <strong>{review.author}</strong>
                {typeof review.rating === "number" && (
                  <span className={styles.rating}>★ {review.rating.toFixed(1)}</span>
                )}
              </div>
              <p className={styles.reviewBody}>{review.excerpt}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noReviews}>
          <span>{t("noReviews", lang)}</span>
          {reviewUrl && (
            <a
              className={styles.reviewLink}
              href={reviewUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("viewReviews", lang)} →
            </a>
          )}
        </p>
      )}
    </section>
  );
}

function CommuteSection({
  meters,
  destination,
  lang,
}: {
  meters?: number;
  destination: { lng: number; lat: number; name?: string };
  lang: Language;
}) {
  const options = estimateCommuteOptions(meters);
  if (!options.length) return null;
  const labels: Record<CommuteMode, "commuteWalk" | "commuteBike" | "commuteTransit" | "commuteDrive"> = {
    walk: "commuteWalk",
    bike: "commuteBike",
    transit: "commuteTransit",
    drive: "commuteDrive",
  };
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("commute", lang)}</h3>
      <p className={styles.muted}>{t("commuteEstimate", lang)}</p>
      <ul className={styles.commuteList}>
        {options.map((option) => (
          <li key={option.mode}>
            <a
              className={styles.commute}
              href={amapDirectionsUrl(destination, option.mode)}
              target="_blank"
              rel="noreferrer"
            >
              <strong>{t(labels[option.mode], lang)}</strong>
              <span>
                {option.minutes} {t("commuteMinutes", lang)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  // 脏数据防御:源 CSV 空电话是字面量 '[]'(truthy),空数组也当空值 → 不渲染行
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "[]" || text === "{}") return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{label}</h3>
      <p className={styles.prose}>{text}</p>
    </section>
  );
}

function PhotoStrip({ photos, lang }: { photos: string[]; lang: Language }) {
  const [index, setIndex] = useState(0);
  const total = photos.length;
  const safeIndex = ((index % total) + total) % total;

  if (total === 0) return null;

  const go = (next: number) => setIndex(((next % total) + total) % total);

  return (
    <div className={styles.carousel} aria-roledescription="carousel">
      <div className={styles.carouselStage}>
        <img
          src={photos[safeIndex]}
          alt=""
          className={styles.carouselPhoto}
          loading={safeIndex === 0 ? "eager" : "lazy"}
          // 本地库照片来自高德图床 URL,可能过期/防盗链——与 poi-card 同款兜底
          onError={(e) => {
            e.currentTarget.src =
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23e6e9ec'/%3E%3C/svg%3E";
          }}
        />
        {total > 1 && (
          <>
            <button
              type="button"
              className={`${styles.carouselNav} ${styles.carouselPrev}`}
              onClick={() => go(safeIndex - 1)}
              aria-label={t("prevPhoto", lang)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
            <button
              type="button"
              className={`${styles.carouselNav} ${styles.carouselNext}`}
              onClick={() => go(safeIndex + 1)}
              aria-label={t("nextPhoto", lang)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </>
        )}
      </div>
      {total > 1 && (
        <div className={styles.dots} role="tablist" aria-label={t("photoIndex", lang)}>
          {photos.map((_, i) => (
            <button
              key={`${photos[i]}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === safeIndex}
              className={`${styles.dot} ${i === safeIndex ? styles.dotActive : ""}`}
              onClick={() => setIndex(i)}
              aria-label={`${t("photoIndex", lang)} ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
