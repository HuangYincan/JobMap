# 03 - Plugin System Contract

> **Status:** manifest, local-fixture import, and reviewed polite acquisition seams implemented; frontend presentation deferred
> **Last reviewed:** 2026-08-17

## Implementation Evidence

- `crawler/app/domain_map_importer/manifest.py`: `validate_manifest()` accepts a declarative manifest and rejects unsupported keys, unknown capabilities, invalid semantic versions, and malformed `dataPolicy`.
- `crawler/app/domain_map_importer/imports.py`: `validate_local_fixture()` / `normalize_import()` validate a local fixture shape, require provenance metadata, detect duplicate and malformed records, and produce a deterministic report with a content hash.
- `crawler/app/domain_map_importer/access.py`: `map_access()` / `can_access_map()` enforce public-read-only and owner/editor/viewer permissions.
- `crawler/app/domain_map_importer/acquire.py`: polite GET + robots + blocked commercial hosts. `html_jobs.py` / `radar_jobs.py` / `official_refresh.py` map HTML or a published jobs.json snapshot onto `SourceCompany`.
- Unit tests for these seams pass (`make test-unit`).

## Principle

A plugin is a versioned, declarative extension to a domain map. **Plugin registration, tenant enablement, data import, and automated data acquisition are separate operations.** A domain plugin never authorizes data collection.

The MVP will implement only the recruitment domain and one approved import path. Housing, university, user-profile, recommendation, and AI plugins are deferred.

## Plugin Classes

| Class | Purpose | MVP status | Trust boundary |
|---|---|---|---|
| Domain schema | Declares entity/item fields and UI-safe metadata | Planned | Platform-reviewed declarative data |
| Import adapter | Reads approved seed, CSV, or API input | Planned | Validated input, provenance required |
| Acquisition adapter | Retrieves a source automatically | Polite official HTML + published radar JSON only | Requires source-specific approval and kill switch |
| Presentation extension | Provides reviewed UI rendering | Deferred after map shell approval | First-party, versioned code only |
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
| `recruitment` | Planned MVP | Approved-data import candidate: `xiaozhao-radar` `jobs.json`; attribution and source record required |
| `housing` | Deferred | Requires its own approved data and spatial model |
| `university` | Deferred | Second-domain demonstration, not an MVP feature |
| `user-profile` | Deferred | PII/security design required |
| `recommendation` | Deferred | Evaluation and data-governance design required |
| `ai-assistant` | Deferred | Controlled map-action protocol required |

Do not use a copy-template command until a real generator and its tests exist.
