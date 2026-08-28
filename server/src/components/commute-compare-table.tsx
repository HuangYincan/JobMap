"use client";

import { t, type Language } from "@/lib/i18n";
import {
  COMMUTE_COMPARE_ROWS,
  type CommuteCompareColumn,
  type CommuteCompareRowKey,
} from "@/lib/commute-compare";
import styles from "./commute-compare-table.module.css";

const ROW_LABEL: Record<CommuteCompareRowKey, "commuteRowMinutes" | "commuteRowQuality" | "commuteRowJobs" | "commuteRowSalary" | "commuteRowAddress"> = {
  commuteMinutes: "commuteRowMinutes",
  quality: "commuteRowQuality",
  openJobs: "commuteRowJobs",
  salary: "commuteRowSalary",
  address: "commuteRowAddress",
};

export function CommuteCompareTable({
  columns,
  lang = "zh",
}: {
  columns: CommuteCompareColumn[];
  lang?: Language;
}) {
  if (columns.length < 2) {
    return <p className={styles.hint}>{t("commuteNeedTwo", lang)}</p>;
  }
  return (
    <div className={styles.wrap} data-commute-compare="true">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("commuteCompare", lang)}</th>
            {columns.map((col) => (
              <th key={col.poiId} scope="col">
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMMUTE_COMPARE_ROWS.map((row) => (
            <tr key={row}>
              <th scope="row">{t(ROW_LABEL[row], lang)}</th>
              {columns.map((col) => (
                <td key={col.poiId} className={row === "salary" ? styles.salary : undefined}>
                  {col[row]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
