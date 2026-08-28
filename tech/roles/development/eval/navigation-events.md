# Navigation product events — data dictionary

**Status:** WS3 offline eval contract (2026-08-28). Events are in-memory / JSONL only.
They are **not** persisted to Postgres and **must not** reuse `audit_events`.

This batch measures deterministic parser/policy/tool contracts on synthetic fixtures.
It does not measure an online LLM, live traffic, or real users.

## Closed event names (tech/31 §7.1, 可少不可多)

| event | When the offline runner emits it |
|---|---|
| `navigation_intent_parsed` | Every fixture after `parseNavigationIntent` |
| `navigation_slot_clarified` | Parsed intent with non-empty `missingSlots` |
| `navigation_job_search_completed` | After `work__searchPositions` |
| `navigation_route_requested` | Before compare/plan tool calls |
| `navigation_route_resolved` | Provider-quality success (`provider_route`) |
| `navigation_route_degraded` | Explicit estimate quality or provider timeout fallback |
| `navigation_comparison_viewed` | After `navigation__compareCommutes` |
| `navigation_route_action_applied` | Extra fake-provider path only: format-valid `showRoute{routeId}` (no overlay) |
| `navigation_task_completed` | Parsed, no missing slots, playbook first tool ran |

`navigation_route_action_applied` is omitted from the 40-fixture default run because
the client overlay is unimplemented (WS4). The extra interview success path emits it
after `validateAction` accepts an issued opaque `routeId`. That is format validation,
not a UI application.

## Allowed fields

| field | type | meaning |
|---|---|---|
| `event` | enum | Closed name above |
| `occurredAt` | string | UTC ISO-8601 (`...Z`) |
| `caseId` | string | Stable synthetic id (`^[a-z0-9-]{1,64}$`) |
| `task` | enum | `job_search` / `job_compare` / `interview_arrival` |
| `city` | string | City name only (≤64), never a street address |
| `mode` | enum | `walk` / `bike` / `transit` / `drive` |
| `candidateCount` | integer ≥0 | Compare/search candidate count |
| `durationMs` | integer ≥0 | Tool/route elapsed ms in the runner |
| `resultCount` | integer ≥0 | Search hit count |
| `quality` | enum | `estimate` / `provider_route` |
| `failureClass` | string | Closed-ish code (`UNKNOWN_FIELD`, `MISSING_SLOTS`, `TIMEOUT`, …) |
| `completed` | boolean | Whether that step succeeded |

Unknown fields fail closed (`parseNavigationEvent` / `assertSafeNavigationEvent`).

## Forbidden fields (keys or values)

Must not appear: raw utterance / full conversation, full address, precise origin/destination
objects, `lng` / `lat`, polyline / geometry, provider raw responses, cookies, secrets,
`AMAP_WEB_KEY` / `BAIDU_MAP_AK` / `TENCENT_MAP_KEY`, user memory text.

`routeId` is also **not** an allowed event field. Opaque ids may appear in tool text for
provider routes; they must not be copied into the product event object.

## Example JSONL row

```json
{"event":"navigation_intent_parsed","occurredAt":"2026-08-28T12:00:00.005Z","caseId":"commute-01","task":"job_search","city":"杭州","completed":true}
```

See `server/scripts/navigation-eval/events.example.jsonl` for a committed four-line sample.
