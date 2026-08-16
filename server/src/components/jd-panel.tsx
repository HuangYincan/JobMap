"use client";

import type { CSSProperties } from "react";
import {
  formatSalary,
  resolveApplyLink,
  type ApplySource,
  type Position,
  type RecruitmentPOI,
} from "@/lib/types";
import { t, type Language } from "@/lib/i18n";
import styles from "./jd-panel.module.css";

export interface JdPanelProps {
  company: RecruitmentPOI;
  position: Position;
  onClose: () => void;
  lang?: Language;
  accentColor?: string;
}

const APPLY_SOURCE_KEY = {
  official: "applySourceOfficial",
  boss: "applySourceBoss",
  shixiseng: "applySourceShixiseng",
  nowcoder: "applySourceNowcoder",
  liepin: "applySourceLiepin",
  other: "applySourceOther",
} as const satisfies Record<ApplySource, Parameters<typeof t>[0]>;

const TYPE_KEY = {
  intern: "internType",
  campus: "campusType",
  social: "socialType",
} as const;

function fallbackDescription(company: RecruitmentPOI, position: Position, lang: Language): string {
  const typeLabel = t(TYPE_KEY[position.type], lang);
  if (lang === "zh") {
    return `${company.name} · ${position.department || typeLabel}招聘「${position.title}」。${
      position.education ? `学历要求${position.education}。` : ""
    }${position.skills?.length ? `关注 ${position.skills.join("、")}。` : ""}参与日常研发/业务协作，具体职责以部门安排为准。`;
  }
  return `${company.name} is hiring a ${position.title} on the ${position.department || typeLabel} team.${
    position.education ? ` ${position.education} preferred.` : ""
  }${position.skills?.length ? ` Skills: ${position.skills.join(", ")}.` : ""}`;
}

export function JdPanel({
  company,
  position,
  onClose,
  lang = "zh",
  accentColor = "#007AFF",
}: JdPanelProps) {
  const typeLabel = t(TYPE_KEY[position.type], lang);
  const description = position.description || fallbackDescription(company, position, lang);
  const apply = resolveApplyLink(company, position);
  const applyLabel = apply
    ? `${t("applyJob", lang)} · ${t(APPLY_SOURCE_KEY[apply.source], lang)}`
    : t("applyUnavailable", lang);

  return (
    <aside
      className={styles.panel}
      style={{ "--accent": accentColor } as CSSProperties}
      aria-label={position.title}
    >
      <header className={styles.topBar}>
        <div className={styles.kicker}>{company.name}</div>
        <button className={styles.closeButton} onClick={onClose} aria-label={t("closeJd", lang)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className={styles.body}>
        <h2 className={styles.title}>{position.title}</h2>
        <p className={styles.subtitle}>
          {[position.department, typeLabel, formatSalary(position.salary)].filter(Boolean).join(" · ")}
        </p>

        <dl className={styles.facts}>
          <Fact label={t("department", lang)} value={position.department} />
          <Fact label={t("jobType", lang)} value={typeLabel} />
          <Fact label={t("salary", lang)} value={formatSalary(position.salary)} />
          <Fact label={t("education", lang)} value={position.education} />
          <Fact label={t("deadline", lang)} value={position.deadline} />
        </dl>

        {position.majors && position.majors.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("majors", lang)}</h3>
            <div className={styles.chips}>
              {position.majors.map((m) => (
                <span key={m} className={styles.chip}>{m}</span>
              ))}
            </div>
          </section>
        )}

        {position.skills && position.skills.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("skills", lang)}</h3>
            <div className={styles.chips}>
              {position.skills.map((s) => (
                <span key={s} className={styles.chip}>{s}</span>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("jobDescription", lang)}</h3>
          <p className={styles.prose}>{description}</p>
        </section>
      </div>

      <footer className={styles.footer}>
        {apply ? (
          <a
            className={styles.apply}
            href={apply.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {applyLabel}
          </a>
        ) : (
          <button type="button" className={`${styles.apply} ${styles.applyDisabled}`} disabled>
            {applyLabel}
          </button>
        )}
      </footer>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
