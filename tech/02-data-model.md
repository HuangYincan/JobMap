# 02 - Data Model and Spatial Contract

> **Status:** implementation-backed; migrations exist but have not yet been verified against a live PostGIS database
> **Last reviewed:** 2026-08-15
> **Authority:** `db/migrations/001-004` are the implementation source of truth; this document must be updated when migrations change.

## Implementation Evidence

- `db/migrations/001_extensions_and_identity.sql`: PostGIS + pg_trgm, `users`, `maps`, `map_memberships`.
- `db/migrations/002_plugins_and_provenance.sql`: `plugin_manifests`, `plugin_schema_versions`, `sources`, `import_runs`, `source_records`.
- `db/migrations/003_canonical_entities_and_items.sql`: canonical `entities` and `items` with composite provenance keys, coordinate constraints, generated SRID 4326 geometry and GiST index.
- `db/migrations/004_overlays_and_audit.sql`: `map_entity_overlays`, `map_annotations`, `map_favorites`, `audit_events`.
- `db/scripts/apply.sh` runs each migration and its ledger row in a single transaction with a transaction-scoped advisory lock; `db/scripts/preflight.sh` checks PostGIS and ledger checksum drift.
- Live database verification is blocked until Docker/PostGIS is available.

## Modeling Boundaries

- **Canonical data** represents a real-world entity/item once, independent of a user's map.
- **Map overlays** attach canonical entities to a map with tenant-specific visibility, annotations, pins, and presentation state. Do not duplicate a company for every map.
- **Tenancy** is initially user-owned maps plus explicit map memberships. A public map is anonymously readable only; writes require an authenticated owner/editor. Organizations are deferred.
- **Plugins** declare field schemas. Arbitrary JSON is not trusted: the server validates it against a registered manifest/version.
- **Sources** provide provenance. Every imported item or entity must be traceable to one source record and source record version.

## Required Phase 1 Tables

The first migration will define, in dependency order:

1. `users`
2. `map_memberships` and `maps` (owner/editor/viewer access)
3. `plugin_manifests` and schema versions
4. `sources`, `source_records`, and `import_runs`
5. canonical `entities` and `items`
6. `map_entity_overlays` and user annotations/favorites as later migrations require
7. audit events for access-sensitive actions

Foreign-key and application authorization rules must guarantee that an item domain matches its entity domain and that overlay writes are scoped to an editable map. Cross-table invariants that cannot be expressed as `CHECK` constraints require a tested trigger or transaction-level validation.

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

Account `search_history` and `saved_places` only accept catalog recruitment rows. `lib/persistable.ts` (`PERSISTABLE_MODES` = work / internship) is the extension seam — add `college` when that catalog lands. Domain AMap POIs stay session-only. Guest Recent is browser `dm.guest-search-history.v1`, not a table. `POST /api/me/saved` returns 400 `NOT_PERSISTABLE` for domain snapshots.
