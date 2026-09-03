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
            "source": job.get("source") or next_company.get("source") or "official-career",
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
    allow_live_refresh: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Refresh a company through the ATS adapter matching its careerUrl host.

    Feishu jobs hosts are frozen unless the caller explicitly authorizes the
    live adapter.  A 405 is never bypassed with a browser User-Agent, and a
    frozen or partially fetched result never falls back to HTML or replaces
    the existing snapshot.  This prevents an access-policy failure from being
    interpreted as an empty/complete source.

    Returns (refreshed_company, meta) where meta carries the source used,
    completeness, counts and any API page errors for the CLI summary.
    """
    from urllib.parse import urlparse

    host = (urlparse(page_url).hostname or "").lower()
    stamp = retrieved_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta: dict[str, Any] = {"source": "html", "api_errors": [], "api_jobs": 0, "complete": True}
    if is_feishu_jobs_host(host):
        jobs, api_errors = fetch_all_jobs(
            fetcher,
            host,
            page_size=page_size,
            allow_live_refresh=allow_live_refresh,
        )
        mapping_errors: list[dict[str, Any]] = []
        positions = jobs_to_positions(
            jobs,
            company,
            stamp,
            host=host,
            diagnostics=mapping_errors,
        )
        complete = not api_errors and not mapping_errors
        meta = {
            "source": "feishu-api" if allow_live_refresh else "feishu-frozen",
            "api_errors": api_errors,
            "diagnostics": mapping_errors,
            "api_jobs": len(jobs),
            "complete": complete,
        }
        # Only an explicitly enabled, error-free page set is a complete
        # snapshot.  In particular, do not use the HTML shell as a fallback:
        # it has no trustworthy job rows and could hide a failed API refresh.
        if complete:
            feishu_company = {**company, "source": "feishu-ats"}
            return apply_extracted_jobs(feishu_company, positions, retrieved_at=stamp), meta
        return json.loads(json.dumps(company)), meta
    return refresh_company_from_html(company, html, page_url, retrieved_at=stamp), meta


def write_company(path: Path, company: dict[str, Any]) -> None:
    path.write_text(json.dumps(company, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
