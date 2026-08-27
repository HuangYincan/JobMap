# 03 - Plugin System Contract

> **Status:** manifest/import/reviewed-acquisition seams, recruitment presentation, and first-party AI-assistant core implemented; learned recommendation and executable third-party plugins deferred
> **Last reviewed:** 2026-08-27

## Implementation Evidence

- `crawler/app/domain_map_importer/manifest.py`: `validate_manifest()` accepts a declarative manifest and rejects unsupported keys, unknown capabilities, invalid semantic versions, and malformed `dataPolicy`.
- `crawler/app/domain_map_importer/imports.py`: `validate_local_fixture()` / `normalize_import()` validate a local fixture shape, require provenance metadata, detect duplicate and malformed records, and produce a deterministic report with a content hash.
- `crawler/app/domain_map_importer/access.py`: `map_access()` / `can_access_map()` enforce public-read-only and owner/editor/viewer permissions.
- `crawler/app/domain_map_importer/acquire.py`: polite GET + robots + blocked commercial hosts. `html_jobs.py` / `radar_jobs.py` / `official_refresh.py` map HTML or a published jobs.json snapshot onto `SourceCompany`.
- `server/src/lib/agent/**`: first-party Agent loop, provider/tool registries, controlled actions, SSE boundary, and user-memory integration are implemented; the planned Work-mode job-navigation extension is specified in `tech/31-job-navigation-agent-plan.md`.
- Unit tests for these seams pass (`make test-unit`).

## Principle

A plugin is a versioned, declarative extension to a domain map. **Plugin registration, tenant enablement, data import, and automated data acquisition are separate operations.** A domain plugin never authorizes data collection.

The recruitment domain, reviewed import/acquisition paths, first-party presentation, and AI-assistant core are implemented. Housing, university, learned recommendation, and executable third-party plugins remain deferred. The Work-mode job-navigation extension is planned, not implemented.

## Plugin Classes

| Class | Purpose | MVP status | Trust boundary |
|---|---|---|---|
| Domain schema | Declares entity/item fields and UI-safe metadata | Validator implemented; runtime registry remains first-party | Platform-reviewed declarative data |
| Import adapter | Reads approved seed, CSV, or API input | Implemented for reviewed recruitment inputs | Validated input, provenance required |
| Acquisition adapter | Retrieves a source automatically | Polite official HTML + published radar JSON only | Requires source-specific approval and kill switch |
| Presentation extension | Provides reviewed UI rendering | Recruitment and AI surfaces implemented; every new UI still requires approval | First-party, versioned code only |
| Executable third-party plugin | Runs supplied code | Explicitly out of scope | Requires a separate sandbox/security ADR |

User upload in the MVP means validated data mapped to a pre-approved declarative template. It never means installing or executing user-provided code.

## Declarative Manifest

Every platform-reviewed plugin must declare, at minimum:

```ts
type PluginManifest = {
  code: string;                 // stable, lowercase identifier
  version: string;              // semantic version
  schemaVersion: number;
  owner: 'platform' | 'tenant';
  entityType: string;
  itemType?: string;
  entityFields: Record<string, FieldDefinition>;
  itemFields?: Record<string, FieldDefinition>;
  capabilities: Array<'seed-import' | 'api-import' | 'spatial-query' | 'map-render'>;
  dataPolicy: {
    sourceRequired: boolean;
    retentionClass: 'public' | 'tenant-private';
  };
};
```

The server validates manifests and `attributes` against the registered schema. `code` plus `version` is unique. Schema changes require an explicit compatibility plan; incompatible changes create a new schema version and migration path.

## Lifecycle

1. Propose a plugin and record scope in `tech/roles/product/`.
2. Review the manifest, capabilities, source policy, tenant visibility, and uninstall/retention behavior.
3. Add a migration-owned registration record and validated server registry entry.
4. Add an import adapter only after its data source is approved.
5. Add frontend presentation only after the ASCII/text layout gate and component-source review.
6. Test activation, rejection of invalid input, tenant isolation, deactivation, and provenance behavior.

## Data Source Requirements

Every import must reference a source record. It must record the original URL/API, license or authorization basis, retrieved time, content hash/version, parser version, attribution text, refresh policy, and deletion/takedown contact. Imports are idempotent on source plus external identifier within their canonical scope.

## Current Registry

| Plugin | Status | Notes |
|---|---|---|
| `recruitment` | Implemented | Nationwide DB-backed Work mode using reviewed imports with provenance; new sources still require review |
| `housing` | Deferred | Requires its own approved data and spatial model |
| `university` | Deferred | Second-domain demonstration, not an MVP feature |
| `user-profile` | Deferred | PII/security design required |
| `recommendation` | Deferred | Learned ranking/recommendation requires evaluation and data-governance design; P5 uses explainable constraints instead |
| `ai-assistant` | Core implemented; P5 extension planned | 受控地图动作与用户记忆已落地,见 `tech/24-agent-feature.md` / `tech/30-agent-memory.md`;求职导航见 `tech/31-job-navigation-agent-plan.md` |

Do not use a copy-template command until a real generator and its tests exist.
