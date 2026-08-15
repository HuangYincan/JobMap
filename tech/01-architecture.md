# 01 - Target Architecture

> **Status:** architecture direction with Phase 1 baseline implemented
> **Last reviewed:** 2026-08-15

## Current Repository Fact

The Phase 1 baseline is implemented on `feature/phase-1-platform-baseline`: an importer Python package with declarative plugin/import validation, ordered PostGIS migrations and a migration runner, a map-access policy seam, and a Next.js frontend shell. Live PostGIS verification, the public documentation site, executable API routes, and production deployment do not yet exist. This document is a design contract for the target system.

## MVP Direction

- **Application:** Next.js 15.5 App Router, TypeScript 5.9, React 19. The map shell exists in `server/`; API routes and Tailwind integration are planned for Phase 2.
- **Database:** PostgreSQL 16 with PostGIS 3.4 is mandatory. PostGIS is the spatial system of record; pgvector is deferred.
- **Data import:** Python 3.12 with uv in `crawler/`. The manifest validator and local-fixture normalizer exist; scheduled crawling is a later, source-reviewed capability.
- **Map:** Amap is the intended initial adapter. The current shell renders a CSS-map fallback and reads `NEXT_PUBLIC_AMAP_KEY` to switch adapter mode; runtime multi-engine support is deferred.
- **Authentication:** the provider and library are undecided. The application-level `map_access`/`can_access_map` seam defines the authorization boundary before map writes exist.

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

## Proposed API Contract

Routes are a design draft until implemented and tested. The eventual API must provide:

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
server/                 # planned Next.js application
crawler/                # planned approved-data importer
db/migrations/          # planned ordered SQL migrations
db/scripts/             # planned migration runner
tests/                  # planned cross-service test suites
tech/zh-cn/             # planned public documentation source
tech/roles/             # internal evidence records
```

## Phase 1 Required Decisions

Before persistent API implementation, record: supported Node/Python versions, auth strategy, application-vs-RLS enforcement, migration convention, manifest validator, source registry format, environment variables, and local development topology. ORM, cache, pgvector, LLM provider, production deployment, and multi-engine map support remain undecided.
