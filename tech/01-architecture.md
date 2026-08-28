# 01 - Target Architecture

> **Status:** architecture contract; Phase 1–4 implemented and merged into `dev`
> **Last reviewed:** 2026-08-28

## Current Repository Fact

The platform is implemented and runs on `dev`: an importer Python package with declarative plugin/import validation, ordered PostGIS migrations (`001`–`020`) with a migration runner, executable API routes, a map-access policy seam, and a Next.js 16 frontend. Migration `020` enforces the position/site/company ownership invariant; environment application status is documented in [02-data-model.md](02-data-model.md). Live PostGIS verification, the API surface, and the local runbook all exist; the public documentation site and production deployment remain out of scope. This document is the design contract for the current system.

The WS0 job-navigation contract is implemented in `server/src/lib/navigation/{constants,errors,index,types,validation}.ts`.
These modules contain only frozen contract types, stable errors, and pure validation; they have no network,
database, or session I/O. This is not a route service: the job-navigation `RouteProvider`, `RouteService`,
artifact store, navigation API, job/navigation Agent tools, `showRoute`, and frontend route UI are not implemented.

WS0 only validates route-reference syntax: `routeId` must match
`^rte_[a-f0-9]{32,124}$`, for a total length of 36–128 characters. WS1 is responsible for
server-side CSPRNG generation and session binding; WS0 does not generate IDs. For `appointment.startsAt`,
`Z` remains valid and an explicit UTC offset is accepted only in this project's closed range of
`[-12:00, +14:00]`; this is a project acceptance policy, not a statement of the full ISO 8601 range.
WS0 does not validate whether an offset matches an IANA timezone.

## MVP Direction

- **Application:** Next.js 16.3.1 App Router, TypeScript 5.9.3, React 19.2.8, Node 22. The map shell and API routes live in `server/`; styling is CSS Modules (Tailwind was never adopted — see [06-decisions.md](06-decisions.md) ADR-003).
- **Database:** PostgreSQL 16 with PostGIS 3.4 is mandatory. PostGIS is the spatial system of record; pgvector is deferred. Migrations `001`–`020` are the current ordered implementation set (the runner records applied checksums in `schema_migrations`; migration `017` stores avatar bytes, `018` stores user memories, `019` enforces memory uniqueness, and `020` enforces the position/site/company ownership invariant). Environment application status is documented in [02-data-model.md](02-data-model.md).
- **Data import:** Python 3.12 with uv in `crawler/`. The manifest validator, local-fixture normalizer, reviewed acquisition adapters, and import-plan validation exist; public Work reads are strict DB-only through `loadServerCatalog` (no database/query failure returns an empty list, not seed data). Acquisition follows source-review records (`tech/roles/data/etl/`), and scheduled crawling remains a later, source-reviewed capability.
- **Map:** Amap is the initial adapter. Domain mode inside Hangzhou reads the local `hz_pois` table via `/api/pois/domain-local` (zero AMap calls); outside Hangzhou it uses the active map engine's `searchPOI` provider, with `amap-api` as the SSR/test/no-provider fallback. Work mode reads the recruitment catalog from PostGIS (`loadServerCatalog`) and does not fall back to offline drops. Runtime multi-engine support is implemented for the registered engines; adding further adapters remains deferred.
- **Authentication:** self-built password, OTP, and OAuth authorization-code flows (provider configuration is optional; demo login is gated and non-production-only; no NextAuth/Clerk — see [06-decisions.md](06-decisions.md)). The application-level `map_access`/`can_access_map` seam defines the authorization boundary.

## System Boundaries

```text
Approved source/import
  -> source record + import run + normalization
  -> canonical entities/items in PostGIS
  -> map overlay filtered by tenant/map authorization
  -> typed API contract
  -> map adapter and approved UI

Existing general Agent and controlled map actions
  -> request/message validation
  -> allowlisted tools
  -> server validates extracted action schemas/bounds
  -> client revalidates, rate-limits same-type actions, executes, and supports undo
  -> bounded client localStorage may retain actions/tool summaries

WS0 job-navigation contract (implemented)
  -> provider-neutral intent/route/error contract
  -> pure server-side validation
```

### Canonical Data vs Map Overlay

Canonical entities/items describe companies, jobs, or later domains once. A map is an authorized view/overlay with membership, visibility, annotations, and saved state. User-private data must not be copied into global records merely to render a map.

### Browser Map vs Server Route Boundary

The browser `MapEngine` and the future server-side `RouteProvider` are separate boundaries. `MapEngine` is
responsible for basemap and overlay presentation; `RouteProvider` will be responsible for route requests,
provider-result normalization, and route error, timeout, and quality semantics. Until product permissions,
call ordering, terms, quotas, caching/display rights, and commercial authorization are confirmed manually, the
project must not select, register, configure, or call any live route provider. No real route, traffic data, route
API, artifact storage, navigation Agent tool, or route UI is implied by the WS0 contract.

The WS0 provider review records product facts without selecting an adapter. Amap Route Planning 2.0 is recorded
by its reviewed per-mode endpoints `/v5/direction/driving`, `/v5/direction/walking`,
`/v5/direction/transit/integrated`, `/v5/direction/bicycling`, and `/v5/direction/electrobike`, not as a
single endpoint with a `mode=0/1/2/3/4` mapping. Baidu DirectionLite is recorded separately with
`driving`, `riding`, `walking`, and `transit`; ordinary Baidu Direction API v2 coordinate parameters and
transit-time fields are not extrapolated to DirectionLite. No provider is selected, registered, or called in WS0.

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

The repository already has a general Agent and controlled map actions. Request/message boundaries are validated,
allowlisted tools are available, and `action-schema.ts` validates the six allowlisted action schemas and their
bounds. The server validates extracted action payloads; the client revalidates them, rate-limits same-type
actions, executes them, and supports undo. Bounded client `localStorage` may retain actions and tool summaries.
This is not a server-side action audit trail, and no server-side action or product-analytics audit sink is implied.
The Agent cannot execute arbitrary SQL, browser commands, URLs, or plugin code; this does not make every tool
read-only because logged-in `memory_save` is controlled write functionality. WS0 adds the provider-neutral
job-navigation contract and pure validation only; job-navigation `RouteProvider`, `RouteService`, artifact
store, navigation API, Agent job/navigation tools, `showRoute`, and frontend route UI remain unimplemented.

## Target Directory Structure

```text
server/                 # Next.js application (App Router + API routes)
server/src/lib/navigation/ # existing WS0 job-navigation contracts, stable errors, and pure validation
crawler/                # approved-data importer (Python + uv)
db/migrations/          # ordered SQL migrations (001–020); 020 enforces position/site/company ownership
db/scripts/             # migration runner
tests/                  # cross-service test suites
tech/zh-cn/             # planned public documentation source
tech/roles/             # internal evidence records
```

## Phase 1 Required Decisions

Resolved: supported Node/Python versions (Node 22, Python 3.12), auth strategy (self-built password/OTP + OAuth authorization-code flow with gated demo fallback), application-vs-RLS enforcement (application-level), migration convention (ordered SQL + ledger), manifest validator, source registry format, environment variables, and local development topology. ORM, distributed cache, pgvector, LLM provider selection, production deployment, and further map-engine adapters remain undecided or deferred.
