# 01 - Target Architecture

> **Status:** architecture contract; Phase 1–4 implemented and merged into `dev`
> **Last reviewed:** 2026-08-21

## Current Repository Fact

The platform is implemented and runs on `dev`: an importer Python package with declarative plugin/import validation, ordered PostGIS migrations (`001`–`016`, live-applied) with a migration runner, executable API routes, a map-access policy seam, and a Next.js 16 frontend. Live PostGIS verification, the API surface, and the local runbook all exist; the public documentation site and production deployment remain out of scope. This document is the design contract for the current system.

## MVP Direction

- **Application:** Next.js 16.3.1 App Router, TypeScript 5.9.3, React 19.2.8, Node 22. The map shell and API routes live in `server/`; styling is CSS Modules (Tailwind was never adopted — see [06-decisions.md](06-decisions.md) ADR-003).
- **Database:** PostgreSQL 16 with PostGIS 3.4 is mandatory. PostGIS is the spatial system of record; pgvector is deferred. Migrations `001`–`016` are live-applied on the local Docker database.
- **Data import:** Python 3.12 with uv in `crawler/`. The manifest validator and local-fixture normalizer exist; acquisition follows source-review records (`tech/roles/data/etl/`), and scheduled crawling is a later, source-reviewed capability.
- **Map:** Amap is the initial adapter. Domain mode inside Hangzhou reads the local `hz_pois` table via `/api/pois/domain-local` (zero AMap calls); outside Hangzhou it falls back to the AMap browser API. Work mode reads the recruitment catalog from PostGIS (`loadServerCatalog`). Runtime multi-engine support is deferred.
- **Authentication:** self-built demo OTP + OAuth stub (no NextAuth/Clerk — see [06-decisions.md](06-decisions.md)). The application-level `map_access`/`can_access_map` seam defines the authorization boundary.

## System Boundaries

```text
Approved source/import
  -> source record + import run + normalization
  -> canonical entities/items in PostGIS
  -> map overlay filtered by tenant/map authorization
  -> typed API contract
  -> map adapter and approved UI

AI (deferred)
  -> typed intent
  -> server-side allowlisted map action
  -> client validates and renders action
```

### Canonical Data vs Map Overlay

Canonical entities/items describe companies, jobs, or later domains once. A map is an authorized view/overlay with membership, visibility, annotations, and saved state. User-private data must not be copied into global records merely to render a map.

### Tenant and Access Boundary

The MVP starts with users, user-owned maps, and explicit `owner/editor/viewer` memberships. A public map is anonymous-read-only. Every API query resolves identity and map access before it reads or writes data. The Phase 1 migration and tests must enforce the same rule; organizations and RLS are deferred decisions, not implied features.

### Plugin Boundary

`plugin_manifest` declares a schema and limited capabilities. A plugin cannot run untrusted code, install packages, read tenant data without authorization, or acquire a source automatically. The concrete lifecycle is in [03-plugin-system.md](03-plugin-system.md).

### Import Boundary

An import pipeline is `fetch/receive -> validate -> normalize -> provenance -> idempotent upsert -> quality report`. It stores evidence according to the source retention policy and records failures without silently dropping data. Retrying, scheduling, dead-letter handling, and observability are later phases unless required by the first importer.

## API Contract

The API is implemented and tested. Current routes include `/api/pois` (list, with `bounds`/`filters` spatial clip), `/api/pois/[id]`, `/api/pois/domain-local` (Hangzhou `hz_pois` ILIKE + tier LOD), `/api/search`, `/api/suggest`, `/api/modes`, `/api/filter-options`, `/api/auth/*`, and `/api/me/*` (account-scoped: search history, saved places, applications, notifications). The typed contract is in [14-api-contract.md](14-api-contract.md). The contract guarantees:

- identity and map authorization before data access;
- schema validation, bounded pagination/cursors, strict bbox/radius parsing, and parameterized queries;
- stable error shape such as `{ code, message, requestId }`;
- rate limits and audit events for write/sensitive operations;
- versioned typed contract/OpenAPI or generated equivalent before public API claims;
- map-action payload validation on server and client.

### Controlled AI Map Actions

AI is deferred. When introduced, it may only return a discriminated allowlist such as `filter_and_highlight`, `fly_to`, `show_buffer`, or `nearest_list`. The server validates identity, map ownership, entity visibility, result count, and radius before emitting an action. The AI may not execute SQL, browser commands, arbitrary URLs, or plugin code. Actions are auditable and have explicit failure states.

## Target Directory Structure

```text
server/                 # Next.js application (App Router + API routes)
crawler/                # approved-data importer (Python + uv)
db/migrations/          # ordered SQL migrations (001–018, live-applied)
db/scripts/             # migration runner
tests/                  # cross-service test suites
tech/zh-cn/             # planned public documentation source
tech/roles/             # internal evidence records
```

## Phase 1 Required Decisions

Resolved: supported Node/Python versions (Node 22, Python 3.12), auth strategy (self-built OTP + OAuth stub), application-vs-RLS enforcement (application-level), migration convention (ordered SQL + ledger), manifest validator, source registry format, environment variables, and local development topology. ORM, cache, pgvector, LLM provider, production deployment, and multi-engine map support remain undecided.
