# Merge extracted official-page jobs onto curated SourceCompany JSON.

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .html_jobs import extract_jobs

PARSER_VERSION = "1.0.0"


def guess_family(title: str) -> str:
    blob = title.lower()
    if "实习" in title or "intern" in blob:
        return "intern"
    if "社招" in title or "social" in blob:
        return "social"
    return "campus"


def slug_id(title: str) -> str:
    compact = re.sub(r"[^0-9A-Za-z一-鿿]+", "-", title).strip("-").lower()
    return compact[:48] or "job"


def apply_extracted_jobs(company: dict[str, Any], jobs: list[dict[str, str]], *, retrieved_at: str) -> dict[str, Any]:
    next_company = json.loads(json.dumps(company))
    site_id = next_company["sites"][0]["id"] if next_company.get("sites") else f"{next_company['slug']}-site"
    seen = {pos.get("externalId") for pos in next_company.get("positions", [])}
    for job in jobs:
        title = job["title"]
        external_id = f"web-{slug_id(title)}"
        if external_id in seen:
            continue
        seen.add(external_id)
        next_company.setdefault("positions", []).append(
            {
                "externalId": external_id,
                "title": title[:120],
                "siteId": site_id,
                "family": guess_family(title),
                "taxonomy": {"family": guess_family(title)},
                "status": "open",
                "applySource": "official",
                "applyUrl": job.get("url") or next_company.get("careerUrl"),
                "retrievedAt": retrieved_at,
            }
        )
    return next_company


def refresh_company_from_html(company: dict[str, Any], html: str, page_url: str, *, retrieved_at: str | None = None) -> dict[str, Any]:
    stamp = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return apply_extracted_jobs(company, extract_jobs(html, page_url), retrieved_at=stamp)


def write_company(path: Path, company: dict[str, Any]) -> None:
    path.write_text(json.dumps(company, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
