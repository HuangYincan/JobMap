# Test Strategy

> **Status:** test design contract; no executable test suite exists yet
> **Last reviewed:** 2026-08-15

## Current State

The repository has no server/importer manifests, migration runner, or test files. Do not report `make test`, E2E, coverage, security scans, or browser checks as passing until their executable artifacts are added.

## Phase 1 Test Baseline

Phase 1 must add tests beside the implementation and wire them into a shared command contract.

| Layer | Required first evidence |
|---|---|
| Migration/integration | Empty PostGIS database; extension existence; migration ordering and idempotent runner behavior |
| Authorization | owner/editor/viewer/public read and denied cross-user/map cases |
| Data import | schema validation, source provenance, duplicate/idempotent import, failed-record reporting |
| Spatial | coordinate constraints, known-distance fixtures, bbox/radius bounds, index/query-plan checks where practical |
| Plugin | manifest validation, invalid capability rejection, tenant enablement/deactivation |
| API | request/error contract, pagination limits, parameter validation, authorization |

## Browser and UI QA

After UI implementation begins, `agent-browser` is the primary interactive/screenshot QA tool requested for this project. Playwright may be added for repeatable regression and accessibility checks; it is not a substitute for the required interactive review.

Every user-facing flow requires:

- approved ASCII/text layout evidence before code;
- desktop and mobile viewport screenshots; iPhone SE, iPhone 14 Pro Max, and a tablet matrix;
- light/dark, keyboard, touch, reduced-motion, loading/error/empty, and API-key/network failure checks;
- accessibility checks targeting WCAG 2.2 AA, including focus order and a map list/text alternative.

Use state/role-based locators and explicit readiness conditions. Do not use fixed sleeps such as `waitForTimeout` as a readiness assertion.

## CI Policy

The current workflow only validates documentation policy because application artifacts do not exist. Once Phase 1 provides manifests and tests, CI must add explicit jobs for lint, migration/integration, unit, build, and coverage thresholds. E2E, accessibility, security, performance, and agent-browser screenshot artifact jobs are added only when their commands and fixtures are real. Each documented check must identify its trigger, command, artifact, and blocking status.

## Coverage

The `>80%` target applies to critical executable modules only after coverage tooling is configured. It does not excuse missing integration, authorization, spatial, or security tests, and screenshots do not count as logic coverage.
