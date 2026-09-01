/** Escape a value used as a PostgreSQL LIKE/ILIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function likeContains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

export function likePrefix(value: string): string {
  return `${escapeLikePattern(value)}%`;
}

/** Explicitly use backslash as LIKE's escape character in generated SQL. */
export const LIKE_ESCAPE_SQL = " ESCAPE E'\\\\'";

export function ilike(field: string, placeholder: string): string {
  return `${field} ILIKE ${placeholder}${LIKE_ESCAPE_SQL}`;
}
