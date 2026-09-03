# Navigation eval scripts

Offline SQL/Python reports for the WS3 job-navigation eval runner.

- **Does not** connect to Postgres.
- **Does not** read or write `audit_events`.
- stdlib only (`python3`); no pip dependencies.

Event field dictionary: `report.py` declares the accepted JSONL columns (`EVENT_COLUMNS` and `CAMEL_TO_SNAKE`); keep it in sync with the runner tests when adding a field.

```bash
# From the repo worktree, after the Node runner wrote results.json + events.jsonl:
python3 server/scripts/navigation-eval/report.py \
  --input /tmp/navigation-eval-results.json \
  --events /tmp/navigation-eval-events.jsonl \
  --sql server/scripts/navigation-eval/funnel.sql \
  --out-md /tmp/navigation-eval-report.md \
  --out-csv /tmp/navigation-eval-metrics.csv \
  --out-json /tmp/navigation-eval-metrics.json
```

`funnel.sql` queries the example SQLite table `navigation_events` loaded from JSONL.
`events.example.jsonl` is a committed synthetic sample with no PII, geometry, or keys.
