# Official-career drops

Drop one JSON file per company (or an array of companies). The DB-only importer reads this directory as the authoritative `official-career` snapshot; it does not merge with `WORK_SEED` or an offline fallback. Source-less nested rows inherit `official-career`; explicit `source` values are preserved. For public Work reads, only `portal-*` positions from this source pass the authenticity rule.

A readable JSON file containing `[]` is a complete zero-row snapshot and reconciles stale `official-career` positions closed. Missing, empty, README-only, malformed, unreadable, or semantically invalid input is not an authoritative successful snapshot and blocks apply. Do not put secrets here. Override the directory with `OFFICIAL_CAREER_DIR`.

Shape matches `SourceCompany` in `lib/recruitment-source.ts`:

```json
{
  "slug": "example-hz",
  "name": "Example",
  "source": "official-career",
  "industries": ["internet"],
  "scale": "startup",
  "careerUrl": "https://example.com/jobs",
  "sites": [
    {
      "id": "hq",
      "name": "杭州总部",
      "location": { "lng": 120.15, "lat": 30.27, "address": "西湖区" }
    }
  ],
  "positions": [
    {
      "externalId": "portal-example-fe",
      "title": "前端",
      "siteId": "hq",
      "source": "official-career",
      "family": "intern",
      "status": "open",
      "applyUrl": "https://example.com/jobs/fe"
    }
  ]
}
```
