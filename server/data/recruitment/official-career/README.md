# Official-career drops

Drop one JSON file per company (or an array of companies). `npm run import:seed` and the no-DB work catalog (`loadOfflineWorkCatalog`) merge these with `WORK_SEED` (same slug → sites/positions union; new slugs become catalog POIs). Samples: 2026 autumn frontend drops on every seed slug that already has a public career URL (plus 之江实验室 as a new slug). 曦曦AI has no official career page and stays seed-only. Empty directory is a no-op. Same-slug `sites.id` must match the seed (`${slug}-site`) or the merge adds a second map pin. `boss/`, `nowcoder/`, and `shixiseng/` use the same shape; empty dirs stay a no-op.

Shape matches `SourceCompany` in `lib/recruitment-source.ts`:

```json
{
  "slug": "example-hz",
  "name": "Example",
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
      "externalId": "example-fe",
      "title": "前端",
      "siteId": "hq",
      "family": "intern",
      "status": "open",
      "applyUrl": "https://example.com/jobs/fe"
    }
  ]
}
```

Do not put secrets here. Override the directory with `OFFICIAL_CAREER_DIR`.
