# 01 - Target Architecture

> **Status:** architecture contract; Phase 1–4 implemented and merged into `dev`
> **Last reviewed:** 2026-08-28

## Current Repository Fact

The platform is implemented and runs on `dev`: an importer Python package with declarative plugin/import validation, ordered PostGIS migrations (`001`–`020`) with a migration runner, executable API routes, a map-access policy seam, and a Next.js 16 frontend. Migration `020` enforces the position/site/company ownership invariant; environment application status is documented in [02-data-model.md](02-data-model.md). Live PostGIS verification, the API surface, and the local runbook all exist; the public documentation site and production deployment remain out of scope. This document is the design contract for the current system.

The WS0 job-navigation contracts and WS1 route core are implemented under `server/src/lib/navigation/`.
WS1 adds the small `RouteProvider` injection seam, validated `RouteService`, explicit straight-line estimate
adapter, process-local route-artifact store bounded by both 1,000 entries and 50,000 aggregate geometry points,
navigation-session fingerprinting, and a tested HTTP boundary.
Production registers no live route provider: `POST /api/navigation/routes/plan` therefore returns a labeled
`estimate` with no geometry or `routeId`; no real road route, live traffic, or provider arrival-by capability is
claimed. `GET /api/navigation/routes/[routeId]` only returns an unexpired provider artifact to the same
independent navigation session, and never exposes its internal session fingerprint.
WS2 adds Agent work/navigation domain tools, `showRoute` format validation, and shared navigation-session
cookie handling on `POST /api/agent/chat`.
WS4 adds `MapView.createPolyline`, `MapBridge.drawRoute`, and a client `GET` of the same-session route
artifact before drawing a solid overlay. Estimates have no `routeId` and are drawn only as a dashed
straight line with a visible source bar. Production still registers no live route provider.
WS3 adds a replaceable in-memory/JSONL product-event sink (`server/src/lib/navigation/analytics.ts`)
and an offline eval runner (`eval-runner.ts`, `eval-policy.ts`) that computes §7 metrics and SQL/Python
reports. The sink is **not** persisted and is **not** wired to production chat or `RouteService`.

WS0 validates route-reference syntax: `routeId` must match
`^rte_[a-f0-9]{32,124}$`, for a total length of 36–128 characters. WS1 generates provider-route IDs with
server-side `node:crypto` CSPRNG only after result/geometry validation and binds artifacts to a one-way session
fingerprint; estimates never receive an ID. For `appointment.startsAt`,
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

WS0/WS1/WS2/WS3 job-navigation foundation (implemented)
  -> provider-neutral intent/route/error contract
  -> pure server-side validation
  -> RouteService timeout/abort/result validation
  -> explicit estimate fallback (no geometry or routeId)
  -> entry/geometry-budget-bounded, session-fingerprinted provider artifacts
  -> Agent work/navigation tools + showRoute validation (client overlay not drawn)
  -> replaceable eval event sink + offline runner (not persisted; not audit_events)
```

### Canonical Data vs Map Overlay

Canonical entities/items describe companies, jobs, or later domains once. A map is an authorized view/overlay with membership, visibility, annotations, and saved state. User-private data must not be copied into global records merely to render a map.

### Browser Map vs Server Route Boundary

The browser `MapEngine` and server-side `RouteProvider` are separate boundaries. `MapEngine` is responsible
for basemap and overlay presentation; WS1's injectable `RouteProvider`/`RouteService` boundary is responsible
for route requests, provider-result normalization, and route error, timeout, abort, quality, geometry-validation,
and estimate-fallback semantics. Until product permissions,
call ordering, terms, quotas, caching/display rights, and commercial authorization are confirmed manually, the
project does not select, register, configure, or call any live route provider. The two navigation route handlers
and process-local artifact store now exist, but their production planning path is estimate-only; no real route
or live traffic data is implied. Agent domain tools share the navigation session cookie with these handlers.
`showRoute` is validated on both sides. A legal client `showRoute` fetches
`GET /api/navigation/routes/:routeId` with `credentials: 'include'` and, on 200 + geometry, draws a
solid polyline through `MapBridge.drawRoute`. Estimates never call that GET. Live provider adapters
remain unimplemented; production planning is still estimate-only.

The WS0 provider review records product facts without selecting an adapter. Amap Route Planning 2.0 is recorded
by its reviewed per-mode endpoints `/v5/direction/driving`, `/v5/direction/walking`,
`/v5/direction/transit/integrated`, `/v5/direction/bicycling`, and `/v5/direction/electrobike`, not as a
single endpoint with a `mode=0/1/2/3/4` mapping. Baidu DirectionLite is recorded separately with
`driving`, `riding`, `walking`, and `transit`; ordinary Baidu Direction API v2 coordinate parameters and
transit-time fields are not extrapolated to DirectionLite. No provider is selected, registered, or called in WS1.

### Tenant and Access Boundary

The MVP starts with users, user-owned maps, and explicit `owner/editor/viewer` memberships. A public map is anonymous-read-only. Every API query resolves identity and map access before it reads or writes data. The Phase 1 migration and tests must enforce the same rule; organizations and RLS are deferred decisions, not implied features.

### Plugin Boundary

`plugin_manifest` declares a schema and limited capabilities. A plugin cannot run untrusted code, install packages, read tenant data without authorization, or acquire a source automatically. The concrete lifecycle is in [03-plugin-system.md](03-plugin-system.md).

### Import Boundary

An import pipeline is `fetch/receive -> validate -> normalize -> provenance -> idempotent upsert -> quality report`. It stores evidence according to the source retention policy and records failures without silently dropping data. Retrying, scheduling, dead-letter handling, and observability are later phases unless required by the first importer.

## API Contract

The API is implemented and tested. Current routes include `/api/pois` (list, with `bounds`/`filters` spatial clip), `/api/pois/[id]`, `/api/pois/domain-local` (Hangzhou `hz_pois` ILIKE + tier LOD), `/api/search`, `/api/suggest`, `/api/modes`, `/api/filter-options`, `/api/auth/*`, `/api/me/*` (account-scoped: search history, saved places, applications, notifications), `POST /api/navigation/routes/plan`, `GET /api/navigation/routes/[routeId]`, and `POST /api/agent/chat`. Navigation responses are always `no-store`; planning JSON is bounded. The dedicated host-only HttpOnly/SameSite=Lax navigation cookie uses `Path=/api`, so `/api/agent/chat` and the navigation route handlers share it without sending it to page/static requests. Only its SHA-256 fingerprint reaches `AgentContext.navigationSession` and the dual-bounded artifact store. The broader typed contract is in [14-api-contract.md](14-api-contract.md). The contract guarantees:

- identity and map authorization before data access;
- schema validation, bounded pagination/cursors, strict bbox/radius parsing, and parameterized queries;
- stable error shape such as `{ code, message, requestId }`;
- rate limits and audit events for write/sensitive operations;
- versioned typed contract/OpenAPI or generated equivalent before public API claims;
- map-action payload validation on server and client.

### Controlled AI Map Actions

The repository already has a general Agent and controlled map actions. Request/message boundaries are validated,
allowlisted tools are available, and `action-schema.ts` validates the seven allowlisted action schemas and their
bounds (the seventh is `showRoute { routeId }`; the client fetches the session artifact and draws
via `MapView.createPolyline`, and never puts geometry back onto AgentAction / SSE). The server validates extracted action payloads; the client revalidates them, rate-limits same-type
actions, executes them, and supports undo. Bounded client `localStorage` may retain actions and tool summaries.
This is not a server-side action audit trail, and no server-side action or product-analytics audit sink is implied.
WS3's navigation event sink is an explicit, replaceable in-memory/JSONL contract for offline eval only;
it is not attached to chat or RouteService and does not write `audit_events`.
The Agent cannot execute arbitrary SQL, browser commands, URLs, or plugin code; this does not make every tool
read-only because logged-in `memory_save` is controlled write functionality. WS0/WS1 now provide the
provider-neutral job-navigation contract, route service, explicit estimate path, session-bound artifact store,
and two navigation route handlers. Agent job/navigation tools, `showRoute` action validation, and
`POST /api/agent/chat` navigation-session sharing are implemented; production planning remains
estimate-only. Analytics persistence and live route providers remain unimplemented.
The frontend route overlay draws estimate dashes and provider polylines when an artifact exists;
it does not imply live traffic.

## Target Directory Structure

```text
server/                 # Next.js application (App Router + API routes)
server/src/lib/navigation/ # WS0 contracts + WS1 route service, estimate, session/artifact and HTTP modules + WS3 eval sink/runner (not persisted)
crawler/                # approved-data importer (Python + uv)
db/migrations/          # ordered SQL migrations (001–020); 020 enforces position/site/company ownership
db/scripts/             # migration runner
tests/                  # cross-service test suites
tech/zh-cn/             # planned public documentation source
tech/roles/             # internal evidence records
```

## Phase 1 Required Decisions

Resolved: supported Node/Python versions (Node 22, Python 3.12), auth strategy (self-built password/OTP + OAuth authorization-code flow with gated demo fallback), application-vs-RLS enforcement (application-level), migration convention (ordered SQL + ledger), manifest validator, source registry format, environment variables, and local development topology. ORM, distributed cache, pgvector, LLM provider selection, production deployment, and further map-engine adapters remain undecided or deferred.
