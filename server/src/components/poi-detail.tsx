"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  formatDistance,
  formatSalary,
  isDomainPOI,
  isRecruitmentPOI,
  type POI,
  type Position,
  type RecruitmentPOI,
} from "@/lib/types";
import { estimateCommuteOptions, amapDirectionsUrl, type CommuteMode } from "@/lib/commute";
import { t, type Language } from "@/lib/i18n";
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

export interface POIDetailViewProps {
  poi: POI;
  onBack: () => void;
  lang?: Language;
  accentColor?: string;
  onSelectPosition?: (position: Position) => void;
  selectedPositionId?: string | null;
}

export function POIDetailView({
  poi,
  onBack,
  lang = "zh",
  accentColor = "#007AFF",
  onSelectPosition,
  selectedPositionId,
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
}: {
  poi: RecruitmentPOI;
  lang: Language;
  onSelectPosition?: (position: Position) => void;
  selectedPositionId?: string | null;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const industries = poi.company.industries.map((ind) => INDUSTRY_LABELS[ind]?.[lang] ?? ind);
  const scale = SCALE_LABELS[poi.company.scale]?.[lang] ?? poi.company.scale;
  const open = useMemo(() => poi.positions.filter((p) => p.status === "open"), [poi.positions]);

  return (
    <>
      <div className={styles.companyHead}>
        {poi.company.logoUrl && !logoFailed ? (
          <img
            className={styles.logo}
            src={poi.company.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setLogoFailed(true)}
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
        <span>{formatDistance(poi.distance)}</span>
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
            {t("viewPositions", lang)} ({open.length})
          </h3>
          <ul className={styles.jobs}>
            {open.map((pos) => (
              <li key={pos.id}>
                <button
                  type="button"
                  className={`${styles.job} ${selectedPositionId === pos.id ? styles.jobSelected : ""}`}
                  onClick={() => onSelectPosition?.(pos)}
                >
                  <div className={styles.jobTitle}>{pos.title}</div>
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
        </section>
      )}
    </>
  );
}

function ReviewSection({
  rating,
  reviewCount,
  reviews,
  lang,
}: {
  rating?: number;
  reviewCount?: number;
  reviews?: { id: string; author: string; rating?: number; excerpt: string }[];
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
        <p className={styles.muted}>{t("noReviews", lang)}</p>
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
  if (!value) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{label}</h3>
      <p className={styles.prose}>{value}</p>
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
