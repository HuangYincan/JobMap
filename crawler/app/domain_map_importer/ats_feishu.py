# Feishu jobs (jobs.feishu.cn) ATS adapter — per-tenant public job search API.
#
# Evidence (2026-08-19 sample, fixtures/feishu-nio.html):
#   - Portal is the feishu ATSX "saas-career" app (script assets under
#     atsx-throne/hire-fe-prod/portal/saas-career/), no job data server-rendered.
#   - <script id="js-websiteInfo" type="text/json"> carries tenant identity
#     (tenant_name, website_info.id) used to build the API URL.
#   - Feature flag "ats.job.search_job_with_process_type" confirms the
#     "search_job" API family this adapter targets.
#   - Endpoint/response shape below follow the publicly documented feishu ATS
#     job-search interface; live validation is pending the post-merge pilot run
#     (see tech/roles/data/etl/feishu-ats.md). Parsing is deliberately tolerant
#     and raises structured AdapterError on shape drift so the pilot can adapt
#     quickly.
#
# Access rules: PoliteFetcher only (robots gate, >=2s pacing, no login / no
# CAPTCHA / no rate-limit evasion). Pagination via page_token until has_more.

from __future__ import annotations

import json
import re
from typing import Any

SEARCH_JOB_PATH = "/api/v1/search_job"
DEFAULT_PAGE_SIZE = 20
MAX_PAGES = 5  # safety cap per company
MAX_JD_CHARS = 8000

_WEBSITE_INFO = re.compile(
    r'<script\s+id=["\']js-websiteInfo["\'][^>]*type=["\']text/json["\'][^>]*>(.*?)</script>',
    re.I | re.S,
)
_TAG = re.compile(r"<[^>]+>")


class AdapterError(ValueError):
    """Structured failure from a feishu jobs API response (never a crash)."""


def is_feishu_jobs_host(host: str) -> bool:
    """Route: any *.jobs.feishu.cn hostname runs through this adapter."""
    host = (host or "").strip().lower()
    return host == "jobs.feishu.cn" or host.endswith(".jobs.feishu.cn")


def parse_website_info(html: str) -> dict[str, Any] | None:
    match = _WEBSITE_INFO.search(html)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def parse_tenant_id(html: str) -> str | None:
    info = parse_website_info(html)
    if not info:
        return None
    website = info.get("website_info") or {}
    value = website.get("id")
    return str(value).strip() or None if value else None


def build_search_url(host: str, page_size: int = DEFAULT_PAGE_SIZE, page_token: str = "") -> str:
    params = [f"page_size={page_size}"]
    if page_token:
        params.append(f"page_token={page_token}")
    return f"https://{host}{SEARCH_JOB_PATH}?{'&'.join(params)}"


def _find_list(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Locate the job list inside the documented payload; tolerate key drift."""
    data = payload.get("data")
    if not isinstance(data, dict):
        raise AdapterError(f"feishu API payload has no data object: keys={sorted(payload)[:6]}")
    job_list = data.get("job_list")
    if not isinstance(job_list, list):
        job_list = data.get("list")
    if not isinstance(job_list, list):
        raise AdapterError("feishu API data has no job_list/list array")
    return job_list, data


def parse_page(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], str, bool]:
    """Return (jobs, next_page_token, has_more) for one API page."""
    if not isinstance(payload, dict):
        raise AdapterError(f"feishu API returned non-object payload: {type(payload).__name__}")
    code = payload.get("code")
    if code not in (0, None):
        message = payload.get("message") or payload.get("msg") or ""
        raise AdapterError(f"feishu API code={code} {message}".strip())
    job_list, data = _find_list(payload)
    token = str(data.get("page_token") or "").strip()
    has_more = bool(data.get("has_more")) if data.get("has_more") is not None else bool(token)
    return job_list, token, has_more


def clean_jd(raw: str | None) -> str:
    """Strip HTML from a JD and collapse whitespace; keep a bounded length."""
    if not raw:
        return ""
    text = _TAG.sub(" ", raw)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_JD_CHARS]


def _string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def family_for(recruit_type: Any, title: str) -> str:
    from .official_refresh import guess_family

    kind = _string(recruit_type).lower()
    if "intern" in kind:
        return "intern"
    if kind in {"social", "campus"}:
        return kind
    return guess_family(title)


def job_to_position(job: dict[str, Any], site_id: str, retrieved_at: str) -> dict[str, Any]:
    """Map one feishu API job onto the SourcePosition shape (recruitment-source.ts)."""
    job_id = _string(job.get("id"))
    title = _string(job.get("title"))
    if not job_id or not title:
        raise AdapterError(f"feishu job row missing id/title: keys={sorted(job)[:8]}")
    apply_url = _string(job.get("apply_url") or job.get("apply_link") or job.get("url"))
    description = clean_jd(job.get("description") or job.get("job_description"))
    family = family_for(job.get("recruit_type"), title)
    position = {
        "externalId": f"feishu-{job_id}",
        "title": title[:120],
        "siteId": site_id,
        "family": family,
        "taxonomy": {"family": family},
        "status": "open",
        "applySource": "official",
        "applyUrl": apply_url or "",
        "retrievedAt": retrieved_at,
    }
    if description:
        position["description"] = description
    return position


def jobs_to_positions(jobs: list[dict[str, Any]], company: dict[str, Any], retrieved_at: str) -> list[dict[str, Any]]:
    site_id = company["sites"][0]["id"] if company.get("sites") else f"{company['slug']}-site"
    positions = []
    for job in jobs:
        try:
            positions.append(job_to_position(job, site_id, retrieved_at))
        except AdapterError:
            continue  # skip malformed rows, keep the batch
    return positions


def fetch_all_jobs(fetcher, host: str, *, page_size: int = DEFAULT_PAGE_SIZE, max_pages: int = MAX_PAGES) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Fetch every page of the tenant's job list.

    Returns (jobs, page_errors). Each page goes through the fetcher (robots
    gate + pacing). Malformed pages abort pagination but surface as errors.
    """
    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    token = ""
    for _page in range(max_pages):
        url = build_search_url(host, page_size=page_size, page_token=token)
        result = fetcher.fetch(url)
        if result.blocked_by:
            errors.append({"url": url, "error": f"blocked: {result.blocked_by}"})
            break
        if result.status >= 400:
            errors.append({"url": url, "error": f"http {result.status}"})
            break
        try:
            payload = json.loads(result.body)
        except json.JSONDecodeError:
            errors.append({"url": url, "error": "non-JSON response body"})
            break
        try:
            page_jobs, token, has_more = parse_page(payload)
        except AdapterError as exc:
            errors.append({"url": url, "error": str(exc)})
            break
        jobs.extend(page_jobs)
        if not has_more:
            break
    return jobs, errors
