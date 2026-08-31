---
name: plugin-dev
description: Add or review a declarative Domain Map plugin without bypassing source, tenancy, or frontend approval gates.
---

# Domain Map Plugin Development

1. Confirm a product scope record and exact plugin manifest version.
2. Separate four decisions: manifest registration, map/tenant enablement, data import, and automated acquisition.
3. A plugin is declarative. Do not install or execute user-supplied code.
4. Any external source requires a reviewed record under `tech/roles/data/` before acquisition code. BOSS and Xiaohongshu direct acquisition is prohibited in the MVP.
5. Validate all attributes against the manifest and supported capability allowlist.
6. Require provenance, deterministic normalization, idempotency, deactivation, and tenant-isolation tests.
7. Frontend presentation requires an ASCII/text layout and explicit user approval before code.
8. Update `tech/03-plugin-system.md` and evidence records only with verified behavior.
