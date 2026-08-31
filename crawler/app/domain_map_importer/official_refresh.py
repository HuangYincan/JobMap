# Merge extracted official-page jobs onto curated SourceCompany JSON.

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .ats_feishu import AdapterError, fetch_all_jobs, is_feishu_jobs_host, jobs_to_positions
from .html_jobs import extract_jobs

PARSER_VERSION = "1.1.0"


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
        external_id = job.get("externalId") or f"web-{slug_id(title)}"
        if external_id in seen:
            continue
        seen.add(external_id)
        family = job.get("family") or guess_family(title)
        position = {
            "externalId": external_id,
            "title": title[:120],
            "siteId": site_id,
            "family": family,
            "taxonomy": {"family": family},
            "status": "open",
            "applySource": "official",
            "applyUrl": job.get("applyUrl") or job.get("url") or next_company.get("careerUrl"),
            "retrievedAt": retrieved_at,
        }
        if job.get("description"):
            position["description"] = job["description"]
        next_company.setdefault("positions", []).append(position)
    return next_company


def refresh_company_from_html(company: dict[str, Any], html: str, page_url: str, *, retrieved_at: str | None = None) -> dict[str, Any]:
    stamp = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return apply_extracted_jobs(company, extract_jobs(html, page_url), retrieved_at=stamp)


def refresh_company_from_source(
    company: dict[str, Any],
    fetcher,
    html: str,
    page_url: str,
    *,
    retrieved_at: str | None = None,
    page_size: int = 20,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Refresh a company through the ATS adapter matching its careerUrl host.

    Feishu jobs hosts are read through the public search_job JSON API (real JD
    text + per-job apply links); every other host keeps the HTML heuristic.
    API failures degrade to the HTML path instead of dropping the company.

    Returns (refreshed_company, meta) where meta carries the source used,
    counts and any API page errors for the CLI summary.
    """
    from urllib.parse import urlparse

    host = (urlparse(page_url).hostname or "").lower()
    stamp = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta: dict[str, Any] = {"source": "html", "api_errors": [], "api_jobs": 0}
    if is_feishu_jobs_host(host):
        try:
            jobs, api_errors = fetch_all_jobs(fetcher, host, page_size=page_size)
        except AdapterError as exc:
            jobs, api_errors = [], [{"url": page_url, "error": str(exc)}]
        meta = {
            "source": "feishu-api" if jobs else "html",
            "api_errors": api_errors,
            "api_jobs": len(jobs),
        }
        if jobs:
            next_company = apply_extracted_jobs(
                company, jobs_to_positions(jobs, company, stamp), retrieved_at=stamp
            )
            return next_company, meta
        # API yielded nothing usable → polite HTML fallback (existing behavior).
        # meta is kept so the CLI summary still reports api_errors/api_jobs.
    return refresh_company_from_html(company, html, page_url, retrieved_at=stamp), meta


def write_company(path: Path, company: dict[str, Any]) -> None:
    path.write_text(json.dumps(company, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
