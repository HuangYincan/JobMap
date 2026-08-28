# Navigation WS3 offline baseline (2026-08-28)

This baseline is produced by the deterministic eval runner in
`server/src/lib/navigation/eval-runner.ts` against the WS0 40-case fixture and
runner-only extra safety cases. It is **not** a live-user, LLM, or UI baseline.

## Sample

| set | n | what it is |
|---|---:|---|
| WS0 contract fixtures | 40 | synthetic `candidate` objects; distribution 12 commute search / 10 compare / 10 interview / 8 safety |
| Runner extra safety/scenario cases | 10 | expired/unauthorized artifact, timeout, estimate-without-`routeId`, three injected fake-provider backend chains, extra illegal actions |
| **Total this batch** | **50** | process-local, no network, no `DATABASE_URL`, no map keys |

The 40 fixture `id` / `scenario` / `utterance` / `candidate` /
`expected.{task,ok,missingSlots,errorCode}` values were **not** modified.

## Metrics measured this batch (Node, recomputed by `report.py`)

Thresholds are tech/31 §7.3 for the subset this batch can test. Observed values
on this runner (2026-08-28, worktree `feature/job-navigation-ws3-eval-events`):

| metric | threshold | observed | n |
|---|---:|---:|---:|
| required-slot micro accuracy | ≥ 0.90 | 1.00 | 200 slot decisions (40 × 5 slots) |
| first-tool / forbid-planning accuracy | ≥ 0.90 | 1.00 | 40 fixtures vs playbook |
| route source/quality labels | 1.00 | 1.00 | 13 successful route results |
| illegal action block rate | 1.00 | 1.00 | 204 injected illegal `showRoute` / unknown actions |
| explicit provider degradation | 1.00 | 1.00 | 12 estimate / failed-provider checks |

These numbers mean the **parser, policy, `validateAction`, and RouteService estimate/fake seams**
behaved as the playbook specified. They do **not** mean a model chose tools correctly.

Business growth metrics (task completion, clarification, degradation, zero-result)
have SQL/Python formulas and example calculations on this synthetic event sample
(`server/scripts/navigation-eval/funnel.sql`, `report.py`). No production baseline
is claimed; the sample is not a user cohort.

## Bias

- No LLM. First tool is a closed policy function, not a model.
- No live route provider. Default 40-run uses estimate-only `RouteService`.
  Fake Amap-shaped provider is injected only in extra cases.
- No real road geometry, traffic, or arrival-by.
- No real users, no real utterances beyond the frozen synthetic `utterance` field
  (that field is never copied into events).
- Catalog is a six-position synthetic Hangzhou company, not the production DB.
- UI, overlay, desktop, and mobile are untested (WS4).

## Conclusions that do not follow

- Not: “three core scenarios are 100% end-to-end on desktop and mobile.” That gate is WS4 after §8 layout approval.
- Not: real commute filtering is production-ready or traffic-aware.
- Not: an Agent/LLM will pick the same tools on live chat.
- Not: product analytics are stored. The sink is in-memory/JSONL; chat and RouteService do not emit or persist.
- Not: `audit_events` is a funnel table. It is not used.

## Next-round hypotheses

1. After a live provider is authorized, re-run extra cases against a recorded
   (not production-key-logged) fixture and compare estimate vs `provider_route` labels.
2. After WS4 UI exists, add desktop/mobile Playwright coverage for the three
   scenarios; do not reuse this 40-case backend score as a UI score.
3. Persistence, consent, deletion, and retention remain a separate decision;
   do not copy this JSONL schema into Postgres without that decision.
4. If an LLM planner is introduced, keep this policy runner as the non-LLM
   control and add a separate labeled LLM split; do not mix the accuracies.
