# 02 - Data Model and Spatial Contract

> **Status:** implementation-backed; migrations `001`–`021` are the current ordered set (the runner records applied checksums in `schema_migrations`; `017` stores avatar bytes, `018` stores user memories, `019` enforces memory uniqueness, `020` adds the position/site ownership invariant, and `021` widens application status ids and adds `updated_at`)
> **Last reviewed:** 2026-08-29
> **Authority:** `db/migrations/001-021` are the implementation source of truth; this document must be updated when migrations change.

## Implementation Evidence

- `db/migrations/001_extensions_and_identity.sql`: PostGIS + pg_trgm, `users`, `maps`, `map_memberships`.
- `db/migrations/002_plugins_and_provenance.sql`: `plugin_manifests`, `plugin_schema_versions`, `sources`, `import_runs`, `source_records`.
- `db/migrations/003_canonical_entities_and_items.sql`: canonical `entities` and `items` with composite provenance keys, coordinate constraints, generated SRID 4326 geometry and GiST index.
- `db/migrations/004_overlays_and_audit.sql`: `map_entity_overlays`, `map_annotations`, `map_favorites`, `audit_events`.
- Later migrations extend the model: `005` accounts/sessions/history, `006` recruitment sites (`companies` / `company_sites` / `positions`), `007` profile prefs/OAuth, `008` saved places, `009` applications, `010` notifications, `011` national scope (tier/city/alive), `012` tier 0..21 + category, `013` Hangzhou POIs (`hz_pois`), `014` credentials auth, `015` recent entity, `016` site key, `017` avatar bytes, `018` user memories, `019` user-memory uniqueness, `020` position/site/company ownership integrity, `021` application watch (`status` free-form id + `updated_at`; user stage catalog in `users.preferences.applicationPipeline`).
- `db/scripts/apply.sh` runs each migration and its ledger row in a single transaction with a transaction-scoped advisory lock; `db/scripts/preflight.sh` checks PostGIS and ledger checksum drift.
- Live verification: `make db-migrate` applied `001`–`016` on the local PostGIS (2026-08-16 and later); `make test-integration` passed. Migration `020` has static coverage and a DB integration probe, but this workstream did not apply it (migration apply is Env-only).

## Modeling Boundaries

- **Canonical data** represents a real-world entity/item once, independent of a user's map.
- **Map overlays** attach canonical entities to a map with tenant-specific visibility, annotations, pins, and presentation state. Do not duplicate a company for every map.
- **Tenancy** is initially user-owned maps plus explicit map memberships. A public map is anonymously readable only; writes require an authenticated owner/editor. Organizations are deferred.
- **Plugins** declare field schemas. Arbitrary JSON is not trusted: the server validates it against a registered manifest/version.
- **Sources** provide provenance. Every imported item or entity must be traceable to one source record and source record version.

## Required Phase 1 Tables

The first migrations define, in dependency order (implemented in `001`–`004`; extended by `005`–`021`):

1. `users`
2. `map_memberships` and `maps` (owner/editor/viewer access)
3. `plugin_manifests` and schema versions
4. `sources`, `source_records`, and `import_runs`
5. canonical `entities` and `items`
6. `map_entity_overlays` and user annotations/favorites as later migrations require
7. audit events for access-sensitive actions

Foreign-key and application authorization rules must guarantee that an item domain matches its entity domain and that overlay writes are scoped to an editable map. Cross-table invariants that cannot be expressed as `CHECK` constraints require a tested trigger or transaction-level validation.

### Recruitment position/site ownership integrity (migration `020`)

Migration `006` keeps `positions.company_id → companies.id ON DELETE CASCADE` and `positions.site_id → company_sites.id ON DELETE RESTRICT` as separate foreign keys. Migration `020_position_site_company_fk.sql` adds the missing pairwise invariant: `(positions.site_id, positions.company_id)` must reference `(company_sites.id, company_sites.company_id)`, with `ON DELETE RESTRICT` on the additional key. The original foreign keys are not dropped or weakened.

Before installing the key, migration `020` runs a read-only preflight for rows where `p.company_id IS DISTINCT FROM s.company_id`. A non-zero result raises an exception, emits the count, and includes a read-only diagnostic `SELECT`; it does not update or delete business data. After an approved data remediation, rerun `make db-migrate` as an environment-only operation.

### Application watch pipeline (migration `021`)

Migration `009` stored `applications.status` as `applied | viewed | withdrawn`. Migration `021_application_pipeline.sql` drops that enum check, allows 1–32 character status ids, adds `updated_at`, backfills `viewed` → `applied`, and indexes `(user_id, updated_at DESC)`. The editable stage catalog is JSON on `users.preferences.applicationPipeline` (not a new table). Apply remains environment-only.

## Source and Provenance Minimums

A source record includes stable source code, original URL/API, license/authorization basis, allowed access method, attribution text, retrieval timestamp, content hash, parser version, and retention/deletion policy. An import run records start/end, input version/hash, counts, failures, and operator. The original payload is retained only when the source policy permits it; otherwise retain a sufficient hash and normalized evidence.

## PostGIS Policy

- PostgreSQL 16 with PostGIS 3.4 is mandatory. The first migration runs `CREATE EXTENSION IF NOT EXISTS postgis`; `pg_trgm` is optional for search. `pgvector` is deferred pending an ADR and a verified image strategy.
- Store source longitude/latitude as WGS84 decimal degrees only after normalization. If an upstream Chinese map uses GCJ-02, record the source coordinate system and transformation decision; never silently mix systems.
- `lng` and `lat` are either both null or both present, constrained to `[-180, 180]` and `[-90, 90]`. Geometry is `geometry(Point, 4326)` generated only from a valid pair.
- Use a GiST index on geometry for viewport filtering and KNN candidate ordering. Use `geom::geography` with `ST_DWithin`/`ST_Distance` when the product promises metre/kilometre values. KNN degree ordering is a candidate optimization, not a guarantee of metre-accurate global ranking; re-rank the candidate set by geography distance where required.
- Every spatial API validates bbox order, SRID, finite numeric inputs, result limits, and pagination. Spatial correctness tests cover coordinate pairs, boundary values, empty geometry, and known-distance fixtures.

## Target DDL Shape

The following is a design sketch, not executable DDL:

```sql
CREATE TABLE maps (
  id bigserial PRIMARY KEY,
  owner_user_id bigint NOT NULL REFERENCES users(id),
  name text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'public')),
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  id bigserial PRIMARY KEY,
  plugin_code text NOT NULL,
  source_record_id bigint NOT NULL REFERENCES source_records(id),
  external_id text NOT NULL,
  name text NOT NULL,
  city text,
  address text,
  lng double precision,
  lat double precision,
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    CASE WHEN lng IS NOT NULL AND lat IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    END
  ) STORED,
  attributes jsonb NOT NULL DEFAULT '{}',
  UNIQUE (source_record_id, external_id),
  CHECK ((lng IS NULL) = (lat IS NULL)),
  CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  CHECK (lat IS NULL OR lat BETWEEN -90 AND 90)
);
CREATE INDEX entities_geom_gist ON entities USING gist (geom);
```

## Query Contracts

- Viewport queries are tenant/map-authorized first, then constrained by plugin, bbox, cursor, and hard result limit.
- Nearest and buffer queries use parameterized SQL and geography units. Maximum radius and candidate count are server limits.
- User/map data is never exposed merely because an entity is geographically near it.

Implementation begins with a tested migration; this document must not claim a future filename is already present.

## Persistability (client + API gate, no new table)

Account `search_history` and `saved_places` only accept catalog recruitment rows. `lib/persistable.ts` (`PERSISTABLE_MODES` = work / internship) is the extension seam — add `college` when that catalog lands. Domain AMap POIs stay session-only. Search-history guests use browser `dm.guest-search-history.v1`, not a table. Recent L2 lists `applications` (signed-in only). `POST /api/me/saved` returns 400 `NOT_PERSISTABLE` for domain snapshots. Application `status` is a stage id (builtin or `c_*`); the user's editable catalog lives in `preferences.applicationPipeline` (max 24, label ≤16). Default catalog is 已投递 / 面试中 / Offer / 未通过 / 已撤回 / 已接受. Unmodified legacy 12-stage catalogs collapse on read. Legacy round ids (`waiting` / `r1`–`r3` → `interview`; `rejected_r1`–`rejected_r3` → `rejected`) coerce when the current catalog no longer lists them. Legacy `viewed` reads as `applied`. `PATCH /api/me/applications` updates one row; `PUT /api/me/applications/pipeline` saves the catalog and reassigns removed ids to the fallback stage. Migration `021` apply is environment-only.
