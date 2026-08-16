# Official-career drops

Drop one JSON file per company (or an array of companies). `npm run import:seed` merges these with `WORK_SEED` (same slug → sites/positions union). Empty directory is a no-op.

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
