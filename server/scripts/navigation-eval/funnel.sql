-- Offline navigation eval funnel queries.
-- Target: example table `navigation_events` loaded from runner JSONL (SQLite).
-- This file must never read or write Postgres `audit_events`.

-- Task funnel
SELECT
  task,
  SUM(CASE WHEN event = 'navigation_intent_parsed' THEN 1 ELSE 0 END) AS parsed,
  SUM(CASE WHEN event = 'navigation_slot_clarified' THEN 1 ELSE 0 END) AS clarified,
  SUM(CASE WHEN event = 'navigation_job_search_completed' THEN 1 ELSE 0 END) AS job_search_completed,
  SUM(CASE WHEN event = 'navigation_comparison_viewed' THEN 1 ELSE 0 END) AS comparison_viewed,
  SUM(CASE WHEN event = 'navigation_route_resolved' THEN 1 ELSE 0 END) AS route_resolved,
  SUM(CASE WHEN event = 'navigation_route_degraded' THEN 1 ELSE 0 END) AS route_degraded,
  SUM(CASE WHEN event = 'navigation_task_completed' THEN 1 ELSE 0 END) AS task_completed
FROM navigation_events
GROUP BY task
ORDER BY task;

-- Route degradation rate
SELECT
  CASE
    WHEN (SUM(CASE WHEN event IN ('navigation_route_resolved', 'navigation_route_degraded') THEN 1 ELSE 0 END) = 0)
      THEN NULL
    ELSE
      CAST(SUM(CASE WHEN event = 'navigation_route_degraded' THEN 1 ELSE 0 END) AS REAL)
      / SUM(CASE WHEN event IN ('navigation_route_resolved', 'navigation_route_degraded') THEN 1 ELSE 0 END)
  END AS degradation_rate,
  SUM(CASE WHEN event = 'navigation_route_degraded' THEN 1 ELSE 0 END) AS degraded,
  SUM(CASE WHEN event = 'navigation_route_resolved' THEN 1 ELSE 0 END) AS resolved
FROM navigation_events;

-- Duration distribution by travel mode
SELECT
  mode,
  COUNT(*) AS n,
  AVG(duration_ms) AS avg_duration_ms,
  MIN(duration_ms) AS min_duration_ms,
  MAX(duration_ms) AS max_duration_ms
FROM navigation_events
WHERE duration_ms IS NOT NULL AND mode IS NOT NULL
GROUP BY mode
ORDER BY mode;

-- Zero-result job search rate
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE CAST(SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
  END AS zero_result_rate,
  SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END) AS zero_result_events,
  COUNT(*) AS job_search_events
FROM navigation_events
WHERE event = 'navigation_job_search_completed';

-- Clarification then completion
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE CAST(SUM(completed_after_clarify) AS REAL) / COUNT(*)
  END AS clarified_then_completed_rate,
  COUNT(*) AS clarified_cases,
  SUM(completed_after_clarify) AS completed_after_clarify
FROM (
  SELECT
    case_id,
    MAX(CASE WHEN event = 'navigation_task_completed' AND completed = 1 THEN 1 ELSE 0 END) AS completed_after_clarify
  FROM navigation_events
  WHERE case_id IN (
    SELECT DISTINCT case_id
    FROM navigation_events
    WHERE event = 'navigation_slot_clarified'
  )
  GROUP BY case_id
);
