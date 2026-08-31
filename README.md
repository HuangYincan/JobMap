# JobMap

A map-first job explorer: company offices on the map, real open positions, and an AI agent that can search, fly the camera, and open JDs.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.4-green.svg)](https://postgis.net/)

Work mode reads an imported recruitment catalog from Postgres (no offline seed fallback). Domain mode is a general POI map. Data comes only from reviewed sources (campus-hire radar snapshot, official career pages, reviewed ATS JSON). Direct scraping of BOSS / 牛客 / 小红书 / 实习僧 is not supported.

## Quick start

Needs Node 20+, Docker (PostGIS), and an [AMap JS API](https://lbs.amap.com/) key for the map.

```bash
# 1. Local database
make db-up
make db-migrate          # needs DATABASE_URL, see server/.env.example

# 2. App
cd server
cp .env.example .env.local
# fill NEXT_PUBLIC_AMAP_KEY + NEXT_PUBLIC_AMAP_SECURITY_CODE
npm install
npm run import:seed:apply
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional: Tencent / Baidu JS keys in `.env.local` for other basemaps; `AMAP_WEB_KEY` (with Baidu / Tencent REST fallbacks) for office geocoding. Never print or commit `.env.local`.

## Layout

```text
JobMap/
├── server/              # Next.js app (UI + /api/*)
├── crawler/             # Python importer (radar / official career / ATS)
├── db/                  # PostGIS migrations + apply scripts
├── tests/               # database integration tests
├── Makefile             # db-up, migrate, importer tests, …
└── docker-compose.yml   # local PostGIS only
```

```bash
make help                # supported make targets
make db-up               # start PostGIS
make db-migrate          # apply SQL migrations
make test-unit           # crawler unit tests
cd server && npm test    # app tests
cd server && npm run typecheck
```

## License

[MIT License](LICENSE) © 2026 Yincan Huang
