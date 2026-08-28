#!/usr/bin/env python3
"""Offline navigation eval report (stdlib only).

Reads the Node runner JSON, recomputes slot/tool/action/quality metrics, and
optionally loads runner JSONL into an in-process SQLite table to execute
funnel.sql. Never connects to Postgres and never reads audit_events.
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
from pathlib import Path

SLOTS = ("origin", "destination", "city", "position", "appointment_time")
EVENT_COLUMNS = (
    ("event", "TEXT"),
    ("occurred_at", "TEXT"),
    ("case_id", "TEXT"),
    ("task", "TEXT"),
    ("city", "TEXT"),
    ("mode", "TEXT"),
    ("candidate_count", "INTEGER"),
    ("duration_ms", "INTEGER"),
    ("result_count", "INTEGER"),
    ("quality", "TEXT"),
    ("failure_class", "TEXT"),
    ("completed", "INTEGER"),
)
CAMEL_TO_SNAKE = {
    "event": "event",
    "occurredAt": "occurred_at",
    "caseId": "case_id",
    "task": "task",
    "city": "city",
    "mode": "mode",
    "candidateCount": "candidate_count",
    "durationMs": "duration_ms",
    "resultCount": "result_count",
    "quality": "quality",
    "failureClass": "failure_class",
    "completed": "completed",
}


def rate(correct: int, total: int) -> dict:
    return {
        "correct": correct,
        "total": total,
        "accuracy": 1.0 if total == 0 else correct / total,
    }


def compute_slot_accuracy(rows: list[dict]) -> dict:
    correct = 0
    total = 0
    for row in rows:
        expected_ok = bool(row.get("expectedOk"))
        parse_ok = bool(row.get("parseOk"))
        expected = set(row.get("expectedMissingSlots") or [])
        predicted = set(row.get("predictedMissingSlots") or [])
        for slot in SLOTS:
            total += 1
            expected_missing = expected_ok and slot in expected
            predicted_missing = parse_ok and slot in predicted
            if expected_missing == predicted_missing:
                correct += 1
    return rate(correct, total)


def compute_tool_accuracy(rows: list[dict]) -> dict:
    correct = 0
    for row in rows:
        first_matches = row.get("predictedFirstTool") == row.get("playbookFirstTool")
        forbid_honored = (not row.get("planningForbiddenExpected")) or (
            not row.get("planningAttempted")
        )
        if first_matches and forbid_honored:
            correct += 1
    return rate(correct, len(rows))


def compute_quality_label_rate(rows: list[dict]) -> dict:
    produced = [row for row in rows if row.get("ok")]
    correct = 0
    for row in produced:
        labeled = (
            isinstance(row.get("provider"), str)
            and len(row.get("provider") or "") > 0
            and isinstance(row.get("fetchedAt"), str)
            and len(row.get("fetchedAt") or "") > 0
            and row.get("quality") in ("estimate", "provider_route")
        )
        if labeled:
            correct += 1
    return rate(correct, len(produced))


def compute_illegal_block_rate(rows: list[dict]) -> dict:
    correct = sum(1 for row in rows if row.get("rejected"))
    return rate(correct, len(rows))


def compute_degradation_rate(rows: list[dict]) -> dict:
    correct = 0
    total = 0
    for row in rows:
        if row.get("quality") == "estimate" or row.get("provider") == "estimate":
            total += 1
            if (
                row.get("ok")
                and row.get("quality") == "estimate"
                and row.get("provider") == "estimate"
                and not row.get("hasRouteId")
                and not row.get("hasGeometry")
            ):
                correct += 1
        if row.get("degradedFromProvider"):
            total += 1
            if (
                row.get("ok")
                and row.get("quality") == "estimate"
                and row.get("provider") == "estimate"
            ):
                correct += 1
        if not row.get("ok"):
            total += 1
            if row.get("quality") != "provider_route":
                correct += 1
    return rate(correct, total)


def compute_metrics(payload: dict) -> dict:
    return {
        "slotAccuracy": compute_slot_accuracy(payload.get("slots") or []),
        "toolAccuracy": compute_tool_accuracy(payload.get("tools") or []),
        "qualityLabelRate": compute_quality_label_rate(payload.get("routes") or []),
        "illegalActionBlockRate": compute_illegal_block_rate(
            payload.get("illegalActions") or []
        ),
        "explicitDegradationRate": compute_degradation_rate(payload.get("routes") or []),
    }


def load_events(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def events_to_sqlite(events: list[dict]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cols = ", ".join(f"{name} {ctype}" for name, ctype in EVENT_COLUMNS)
    conn.execute(f"CREATE TABLE navigation_events ({cols})")
    insert = (
        "INSERT INTO navigation_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    for event in events:
        row = []
        for camel, snake in CAMEL_TO_SNAKE.items():
            value = event.get(camel)
            if snake == "completed" and isinstance(value, bool):
                value = 1 if value else 0
            row.append(value)
        conn.execute(insert, row)
    conn.commit()
    return conn


def run_funnel_sql(conn: sqlite3.Connection, sql_path: Path) -> list[dict]:
    script = sql_path.read_text(encoding="utf-8")
    statements = [part.strip() for part in script.split(";") if part.strip() and not part.strip().startswith("--")]
    # Keep comment-only chunks out; split may still include leading comments.
    cleaned = []
    for statement in statements:
        lines = [
            line
            for line in statement.splitlines()
            if line.strip() and not line.strip().startswith("--")
        ]
        joined = "\n".join(lines).strip()
        if joined:
            cleaned.append(joined)
    results = []
    for statement in cleaned:
        cur = conn.execute(statement)
        columns = [col[0] for col in cur.description] if cur.description else []
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]
        results.append({"sql": statement, "rows": rows})
    return results


def write_markdown(
    path: Path,
    metrics: dict,
    payload: dict,
    funnel: list[dict] | None,
) -> None:
    lines = [
        "# Navigation offline eval report",
        "",
        "This report measures deterministic contract/policy metrics on synthetic",
        "fixtures. It is not an LLM eval, not a live-traffic eval, and not a UI eval.",
        "",
        f"- fixtureCount: {payload.get('fixtureCount')}",
        f"- extraCaseCount: {payload.get('extraCaseCount')}",
        "",
        "## Metrics",
        "",
        "| metric | correct | total | accuracy |",
        "|---|---:|---:|---:|",
    ]
    for name, key in (
        ("slotAccuracy", "slotAccuracy"),
        ("toolAccuracy", "toolAccuracy"),
        ("qualityLabelRate", "qualityLabelRate"),
        ("illegalActionBlockRate", "illegalActionBlockRate"),
        ("explicitDegradationRate", "explicitDegradationRate"),
    ):
        item = metrics[key]
        lines.append(
            f"| {name} | {item['correct']} | {item['total']} | {item['accuracy']:.6f} |"
        )
    lines.extend(
        [
            "",
            "## Business metric definitions (no production baseline)",
            "",
            "- task completion rate: task_completed / intent_parsed (synthetic runner only)",
            "- clarification rate: slot_clarified / intent_parsed",
            "- route degradation rate: route_degraded / (route_resolved + route_degraded)",
            "- zero-result rate: job_search_completed with result_count=0 / all job_search_completed",
            "",
            "These formulas are example calculations on the offline event sample.",
            "They are not product KPIs and must not be cited as live-user performance.",
            "",
        ]
    )
    if funnel:
        lines.append("## SQL funnel")
        lines.append("")
        for block in funnel:
            lines.append("```sql")
            lines.append(block["sql"])
            lines.append("```")
            lines.append("")
            if block["rows"]:
                keys = list(block["rows"][0].keys())
                lines.append("| " + " | ".join(keys) + " |")
                lines.append("|" + "|".join(["---"] * len(keys)) + "|")
                for row in block["rows"]:
                    lines.append("| " + " | ".join(str(row[k]) for k in keys) + " |")
                lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_csv(path: Path, metrics: dict) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["metric", "correct", "total", "accuracy"]
        )
        writer.writeheader()
        for key, item in metrics.items():
            writer.writerow(
                {
                    "metric": key,
                    "correct": item["correct"],
                    "total": item["total"],
                    "accuracy": f"{item['accuracy']:.10f}",
                }
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Node runner JSON")
    parser.add_argument("--events", help="Optional runner JSONL")
    parser.add_argument("--sql", help="Optional funnel.sql path")
    parser.add_argument("--out-md", required=True)
    parser.add_argument("--out-csv", required=True)
    parser.add_argument("--out-json")
    args = parser.parse_args(argv)

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    metrics = compute_metrics(payload)
    funnel = None
    if args.events:
        sql_path = Path(args.sql) if args.sql else Path(__file__).with_name("funnel.sql")
        conn = events_to_sqlite(load_events(Path(args.events)))
        funnel = run_funnel_sql(conn, sql_path)
        conn.close()
    write_markdown(Path(args.out_md), metrics, payload, funnel)
    write_csv(Path(args.out_csv), metrics)
    if args.out_json:
        Path(args.out_json).write_text(
            json.dumps({"metrics": metrics, "funnel": funnel}, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
