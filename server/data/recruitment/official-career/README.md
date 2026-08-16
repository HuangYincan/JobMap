# Official-career drops

Drop one JSON file per company (or an array of companies). `npm run import:seed` and the no-DB work catalog (`loadOfflineWorkCatalog`) merge these with `WORK_SEED` (same slug → sites/positions union; new slugs become catalog POIs). Samples: Alibaba / ByteDance / Tencent / NetEase / Huawei / Ant / 滴滴 / 知乎 / 小米 / 菜鸟 / 有赞 / 海康 / 宇树 / 吉利 / DeepSeek / 恒生 / 大华 2026 autumn frontend on existing seed slugs, plus 之江实验室 as a new slug. Empty directory is a no-op. Same-slug `sites.id` must match the seed (`${slug}-site`) or the merge adds a second map pin. `boss/`, `nowcoder/`, and `shixiseng/` use the same shape; empty dirs stay a no-op.

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
