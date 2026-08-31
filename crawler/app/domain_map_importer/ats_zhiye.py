# Zhiye (Beisen italent `*.zhiye.com`) ATS adapter — probe-driven public job list.
#
# The portal shell ships NO job rows (the list is rendered by an SPA), so the
# adapter performs the three-step probe documented in
# tech/roles/data/etl/zhiye-ats.md:
#   1. GET the portal HTML → parse the `var BSGlobal = {...}` config
#      (PortalId / tenantInfo.Domain) and locate the 2022 portal SPA bundle
#      (`pc-*.chunk.min.js` under ux-recruitment-portal-2022/release/dist/).
#   2. GET the bundle (single polite request) → grep quoted `/api/*` path
#      candidates (the portal routes / API addresses are compiled into it).
#   3. Probe the job-list candidates (GET `?portalId=…`, then POST
#      `{"portalId": …}`) until one returns a JSON payload with an extractable
#      job list; that endpoint + response contract is then paginated.
#
# Contract (locked by the first live crawl, see zhiye-ats.md 校准点):
#   page payload {"code": 0, "data": {"list": [rows], "total": N}}
#     aliases: data.list/jobs/records; data.total/count/totalCount;
#     row id keys: jobId/positionId/id; title keys: title/name/positionName.
#   pagination: GET {endpoint}?portalId=…&page=N&pageSize=M until total.
#
# Access rules: PoliteFetcher only (robots gate, >=2s pacing, honest UA
# DomainMapImporter/0.1 — NO login / NO CAPTCHA / NO rate-limit evasion).
# Share-token / referral URLs are never requested; the portal page itself is a
# public career site shell.

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from .acquire import AcquisitionError
from .ats_feishu import CITY_ALIASES, CITY_PINYIN, CITY_PROVINCE, AdapterError, clean_jd
from .radar_jobs import is_aggregate_title

DEFAULT_PAGE_SIZE = 50
MAX_JOBS = 2000  # safety cap per company
MAX_JD_CHARS = 8000
MAX_PROBE_CANDIDATES = 8  # polite bound on candidate probing per company

# Portal shell config: `var BSGlobal = {...};` (non-greedy: first object literal).
_BSGLOBAL_RE = re.compile(r"var\s+BSGlobal\s*=\s*(\{.*?\})\s*;", re.S)
# `BSGlobal.staticPath = "//acdn.bstatics.com/...";` (separate script block).
_STATIC_PATH_RE = re.compile(r'BSGlobal\.staticPath\s*=\s*["\']([^"\']*)["\']')
# The 2022 portal SPA bundle script (e.g. pc-ef703ae29522fd7fa535.chunk.min.js).
_BUNDLE_RE = re.compile(
    r'<script[^>]*\bsrc=["\']([^"\']*ux-recruitment-portal-2022[^"\']*\.chunk\.min\.js)["\']',
    re.I,
)
# Quoted /api/… paths inside the minified bundle (probe step 1).
API_PATH_RE = re.compile(r'["\'](/api/[^"\']{2,160})["\']')

# API paths that are never job lists (auth/asset plumbing) — filtered out.
_IGNORED_API_HINTS = (
    "login", "captcha", "geetest", "verify", "sso", "auth",
    "token", "upload", "download", "image", "file",
)
# Path hints that make a candidate likely to be a job-list endpoint.
JOB_LIST_HINTS = ("position", "job", "recruit", "zhaopin", "search")

# Job-list container keys inside the page payload (contract aliases).
_LIST_KEYS = ("list", "jobs", "records")
# Row identity / title keys (contract aliases).
_ID_KEYS = ("jobId", "positionId", "id")
_TITLE_KEYS = ("title", "name", "positionName")
_TOTAL_KEYS = ("total", "count", "totalCount", "total_count")

# 已知城市名(裸名,长名优先)— job_city 归一表:CITY_PINYIN ∪ CITY_PROVINCE ∪
# CITY_ALIASES 值。文本含已知城市即归一到该城市,与 radar / feishu 的裸城市
# 名语义一致(既有 drops 的 site.city 如「上海市」)。
_KNOWN_CITIES = tuple(
    sorted(
        set(CITY_PINYIN) | set(CITY_PROVINCE) | set(CITY_ALIASES.values()),
        key=len,
        reverse=True,
    )
)


def is_zhiye_host(host: str) -> bool:
    """Route: any `*.zhiye.com` hostname runs through this adapter."""
    host = (host or "").strip().lower()
    return host == "zhiye.com" or host.endswith(".zhiye.com")


def parse_bs_global(html: str) -> dict[str, Any] | None:
    """Extract the `var BSGlobal = {...};` portal config from the shell HTML."""
    match = _BSGLOBAL_RE.search(html or "")
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def tenant_domain(bs_global: dict[str, Any]) -> str:
    """The portal tenant subdomain (`tenantInfo.Domain`, e.g. 'iflytek')."""
    info = bs_global.get("tenantInfo") or {}
    return str(info.get("Domain") or "").strip()


def portal_id(bs_global: dict[str, Any]) -> str:
    """The portal UUID the job API scopes requests to (`PortalId`)."""
    return str(bs_global.get("PortalId") or "").strip()


def portal_base_url(bs_global: dict[str, Any], fallback_host: str = "") -> str:
    """`https://{tenantDomain}.zhiye.com` — the tenant's API host."""
    domain = tenant_domain(bs_global)
    if domain:
        return f"https://{domain}.zhiye.com"
    host = (fallback_host or "").strip().lower()
    return f"https://{host}" if host else ""


def bundle_url(bs_global: dict[str, Any], html: str) -> str | None:
    """The 2022 portal SPA bundle URL (staticPath + pc-*.chunk.min.js).

    Both halves come from the shell HTML; the bundle src is usually a
    protocol-relative CDN URL. Bare filenames are resolved against staticPath.
    """
    static = ""
    match = _STATIC_PATH_RE.search(html or "")
    if match:
        static = match.group(1).strip().strip("'\"")
    match = _BUNDLE_RE.search(html or "")
    if not match:
        return None
    src = match.group(1).strip()
    if src.startswith("//"):
        return "https:" + src
    if src.startswith(("https://", "http://")):
        return src
    if static:
        return ("https:" + static if static.startswith("//") else static) + src
    return None


def extract_api_paths(bundle_js: str) -> list[str]:
    """Quoted `/api/…` path candidates found in the SPA bundle (probe step 1).

    Keeps first-seen order; drops query strings and plumbing paths that can
    never be a job list (auth / captcha / upload / asset endpoints).
    """
    seen: list[str] = []
    for raw in API_PATH_RE.findall(bundle_js or ""):
        path = raw.split("?", 1)[0]
        if any(hint in path for hint in _IGNORED_API_HINTS):
            continue
        if path not in seen:
            seen.append(path)
    return seen


def job_candidates(candidates: list[str]) -> list[str]:
    """Job-list candidates first (bundle order preserved); no noise."""
    return [path for path in candidates if any(hint in path for hint in JOB_LIST_HINTS)]


def _string(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _first(job: dict[str, Any], keys: tuple[str, ...]) -> str:
    """First non-empty value among aliases; `{name: …}` wrappers unwrapped."""
    for key in keys:
        value = job.get(key)
        if isinstance(value, dict):
            value = value.get("name")
        text = _string(value)
        if text:
            return text
    return ""


def _plausible_job(row: Any) -> bool:
    """True when a row carries both an id and a title (job-list contract)."""
    return isinstance(row, dict) and bool(_first(row, _ID_KEYS) and _first(row, _TITLE_KEYS))


def parse_jobs_payload(payload: Any) -> tuple[list[dict[str, Any]], int]:
    """Return (jobs, total) for one API page (probe-validated contract).

    Primary shape: {"code": 0, "data": {"list": [...], "total": N}}.
    `data` may also be the bare job array. Any other shape → AdapterError so
    the probe rejects it and moves to the next candidate.
    """
    if not isinstance(payload, dict):
        raise AdapterError(f"zhiye API returned non-object payload: {type(payload).__name__}")
    code = payload.get("code")
    if code not in (0, None):
        message = payload.get("message") or payload.get("msg") or ""
        raise AdapterError(f"zhiye API code={code} {message}".strip())
    data = payload.get("data")
    if isinstance(data, list):
        return data, len(data)
    container = data if isinstance(data, dict) else payload
    jobs: list[dict[str, Any]] | None = None
    for key in _LIST_KEYS:
        value = container.get(key)
        if isinstance(value, list):
            jobs = value
            break
    if jobs is None:
        raise AdapterError(f"zhiye API payload has no job list: keys={sorted(container)[:8]}")
    total: Any = container.get("total")
    if not isinstance(total, int):
        for key in _TOTAL_KEYS[1:]:
            value = container.get(key)
            if isinstance(value, int):
                total = value
                break
    return jobs, total if isinstance(total, int) else len(jobs)


def _try_json(body: str) -> Any | None:
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def probe_endpoint(fetcher, base_url: str, candidates: list[str], portal_id_value: str) -> str:
    """Probe job-list candidates until one answers with a parseable job list.

    Step 3 of the zhiye-ats.md probe: GET `?portalId=…` first; if the response
    is not JSON (HTML shell / 405) retry the same path as POST
    `{"portalId": …}`. JSON that fails the job-list contract moves straight to
    the next candidate. Every attempt goes through PoliteFetcher (robots gate,
    >=2s pacing, honest UA) and is bounded by MAX_PROBE_CANDIDATES. An empty
    job list still counts (the endpoint contract holds). Returns the winning
    endpoint.
    """
    errors: list[str] = []
    for path in job_candidates(candidates)[:MAX_PROBE_CANDIDATES]:
        endpoint = f"{base_url}{path}"
        result = fetcher.fetch(f"{endpoint}?portalId={portal_id_value}")
        if result.blocked_by:
            errors.append(f"GET {path}: blocked ({result.blocked_by})")
            continue
        if result.status >= 400:
            errors.append(f"GET {path}: http {result.status}")
            continue
        payload = _try_json(result.body)
        if payload is None:
            # Non-JSON → some portals only accept POST for the list endpoint.
            result = fetcher.fetch(
                endpoint,
                method="POST",
                body=json.dumps({"portalId": portal_id_value}),
                headers={"Content-Type": "application/json"},
            )
            if result.blocked_by:
                errors.append(f"POST {path}: blocked ({result.blocked_by})")
                continue
            if result.status >= 400:
                errors.append(f"POST {path}: http {result.status}")
                continue
            payload = _try_json(result.body)
        if payload is None:
            errors.append(f"{path}: non-JSON response")
            continue
        try:
            jobs, _total = parse_jobs_payload(payload)
        except AdapterError:
            continue  # JSON but not a job-list payload → next candidate
        if jobs and not any(_plausible_job(row) for row in jobs):
            continue  # a list, but nothing that maps to a position
        return endpoint
    raise AdapterError(f"no job endpoint answered (probe tried {len(errors)} attempts)")


def fetch_page(fetcher, endpoint: str, portal_id_value: str, page: int = 1, page_size: int = DEFAULT_PAGE_SIZE) -> tuple[list[dict[str, Any]], int]:
    """GET one page of the probed endpoint: ?portalId=…&page=N&pageSize=M."""
    sep = "&" if "?" in endpoint else "?"
    url = f"{endpoint}{sep}portalId={portal_id_value}&page={page}&pageSize={page_size}"
    result = fetcher.fetch(url)
    if result.blocked_by:
        raise AdapterError(f"blocked: {result.blocked_by}")
    if result.status >= 400:
        raise AdapterError(f"http {result.status}")
    try:
        payload = json.loads(result.body)
    except json.JSONDecodeError:
        raise AdapterError("non-JSON response body")
    return parse_jobs_payload(payload)


def fetch_all_jobs(
    fetcher,
    base_url: str,
    portal_id_value: str,
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_jobs: int = MAX_JOBS,
    candidates: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Probe the job endpoint, then paginate until total / max_jobs.

    Returns (jobs, errors). Probe or page failures surface as errors (never
    crash the batch). Pagination stops on the payload total when present,
    otherwise when a page comes back short or empty.
    """
    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    try:
        endpoint = probe_endpoint(fetcher, base_url, candidates, portal_id_value)
    except AdapterError as exc:
        return jobs, [{"url": base_url, "error": f"probe: {exc}"}]
    page = 1
    while True:
        try:
            page_jobs, total = fetch_page(fetcher, endpoint, portal_id_value, page=page, page_size=page_size)
        except AdapterError as exc:
            errors.append({"url": f"{endpoint}?page={page}", "error": str(exc)})
            break
        jobs.extend(page_jobs)
        if len(jobs) >= max_jobs:
            errors.append({"url": endpoint, "error": f"reached max_jobs={max_jobs}"})
            break
        if total is not None and len(jobs) >= total:
            break
        if not page_jobs:
            break
        if total is None and len(page_jobs) < page_size:
            break  # 短页只在 total 未知时兜底,已知 total 必须翻到 total 为止
        page += 1
    return jobs, errors


def family_for(job: dict[str, Any], title: str) -> str:
    """workType/jobType/recruitType 文本 → family;title 启发式兜底。

    校招/校园 → campus;实习 → intern;社招/社会/全职/外包 → social。与
    feishu 适配器同口径(guess_family 兜底)。
    """
    from .official_refresh import guess_family

    blob = ""
    for key in ("workType", "jobType", "recruitType", "categoryName", "recruitmentType"):
        value = job.get(key)
        if isinstance(value, dict):
            value = value.get("name")
        blob += " " + _string(value)
    lower = blob.lower()
    if "实习" in blob or "intern" in lower:
        return "intern"
    if "校招" in blob or "校园" in blob or "campus" in lower:
        return "campus"
    if "社招" in blob or "社会" in blob or "全职" in blob or "外包" in blob:
        return "social"
    return guess_family(title)


def job_city(job: dict[str, Any]) -> str:
    """Primary city: cityName/city/workCity/location 中文文本,首个非空值。

    归一:去空白与 CITY_ALIASES 笔误 → 文本含已知城市(裸名)时归一到该
    城市;城市名后紧跟「市/省」则保留后缀(「上海市浦东新区」→「上海市」,
    「北京市朝阳区」→「北京市」),裸城市名原样返回(「上海」→「上海」)。
    未匹配已知城市时按原文返回(不丢信息,site 落点仍可用原文本兜底)。
    """
    for key in ("cityName", "city", "workCity", "location"):
        value = job.get(key)
        if isinstance(value, dict):
            value = value.get("name")
        city = _string(value)
        if not city or re.search(r"[A-Za-z]", city):  # 英文地址行不当作城市
            continue
        city = CITY_ALIASES.get(city, city)
        city = re.sub(r"\s+", "", city)
        for name in _KNOWN_CITIES:
            index = city.find(name)
            if index < 0:
                continue
            rest = city[index + len(name):]
            return name + "市" if rest.startswith(("市", "省")) else name
        return city
    return ""


def site_id_for_job(company: dict[str, Any], job: dict[str, Any]) -> str:
    """岗位落点:job 城市匹配到公司现有 site 用其 id;否则按城市约定 id。

    Company sites 的 id 约定 {slug}-site-{pinyin}(radar drops 同款),与
    ats_feishu.site_id_for_job 同逻辑。
    """
    from .ats_feishu import CITY_PINYIN

    city = job_city(job)
    if city:
        for site in company.get("sites", []):
            if site.get("id", "").endswith(f"-site-{CITY_PINYIN.get(city, city)}") or city in (site.get("city") or ""):
                return site["id"]
    sites = company.get("sites") or []
    return sites[0]["id"] if sites else f"{company['slug']}-site"


def job_to_position(
    job: dict[str, Any],
    site_id: str,
    retrieved_at: str,
    *,
    base_url: str = "",
    fallback_url: str = "",
) -> dict[str, Any]:
    """Map one zhiye API job onto the SourcePosition shape.

    externalId 用 portal-* 前缀才被 isAuthenticPositionId 视为真实岗位
    (与 portal-feishu-* 同款;tech/roles/data/etl/zhiye-ats.md)。聚合类标题
    (类别/多岗位打包行)按 radar 校准的 is_aggregate_title 标记 aggregate。
    """
    job_id = _first(job, _ID_KEYS)
    title = _first(job, _TITLE_KEYS)
    if not job_id or not title:
        raise AdapterError(f"zhiye job row missing id/title: keys={sorted(job)[:8]}")
    description = clean_jd(_first(job, ("description", "jobDescription", "duty", "content")))
    requirement = clean_jd(_first(job, ("requirement", "requirements", "positionRequirement", "qualification")))
    jd = f"{description}\n\n岗位要求:\n{requirement}".strip()
    family = family_for(job, title)
    apply = _first(job, ("applyUrl", "url"))
    if apply.startswith("/"):
        apply = f"{base_url}{apply}"
    if not apply:
        apply = fallback_url
    position: dict[str, Any] = {
        "externalId": f"portal-zhiye-{job_id}",
        "title": title[:120],
        "siteId": site_id,
        "family": family,
        "taxonomy": {"family": family},
        "status": "open",
        "applySource": "official",
        "applyUrl": apply,
        "retrievedAt": retrieved_at,
    }
    if jd:
        position["description"] = jd
    if is_aggregate_title(title):
        position["aggregate"] = True
    return position


def jobs_to_positions(
    jobs: list[dict[str, Any]],
    company: dict[str, Any],
    retrieved_at: str,
    *,
    base_url: str = "",
) -> list[dict[str, Any]]:
    """Map crawled jobs onto the company's sites (per-job city → site)."""
    positions = []
    for job in jobs:
        try:
            positions.append(
                job_to_position(
                    job,
                    site_id_for_job(company, job),
                    retrieved_at,
                    base_url=base_url,
                    fallback_url=company.get("careerUrl", ""),
                )
            )
        except AdapterError:
            continue  # skip malformed rows, keep the batch
    return positions


def ensure_city_sites(company: dict[str, Any], jobs: list[dict[str, Any]]) -> None:
    """为 job 城市补齐站点(保留 base 的 curated 站点)。

    与 feishu CLI 同约定:{slug}-site-{pinyin} id、已知城市补「市」、
    province 用 CITY_PROVINCE(省外校验依赖,缺省浙江省会误拒上海站点)。
    """
    from .ats_feishu import CITY_PINYIN, CITY_PROVINCE, city_site_id

    known = {site["id"] for site in company.get("sites", [])}
    for job in jobs:
        city = job_city(job)
        if not city:
            continue
        site_id = city_site_id(company["slug"], city)
        if site_id in known:
            continue
        bare = re.sub(r"[省市区]$", "", city)  # job_city 已归一,兼容「上海市」带后缀形式
        city_name = f"{bare}市" if bare in CITY_PINYIN else city
        company["sites"].append(
            {
                "id": site_id,
                "name": company["name"],
                "city": city_name,
                "province": CITY_PROVINCE.get(bare, ""),
                "location": {"address": city_name},
            }
        )
        known.add(site_id)


def crawl_company(
    fetcher,
    company: dict[str, Any],
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_jobs: int = MAX_JOBS,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Crawl one `*.zhiye.com` company end-to-end(三步探针 → 岗位列表 → drops)。

    Returns (drop_company, meta). The drop is a fresh SourceCompany carrying
    only portal-zhiye-* positions(radar 聚合行由 planSeedImport 对 portal
    公司抑制,与 feishu 同款)并继承 radar 的 curated sites。任何失败都不
    抛异常——原因进 meta["api_errors"],batch 继续。
    """
    career_url = company.get("careerUrl") or ""
    host = (urlparse(career_url).hostname or "").lower()
    base_url = f"https://{host}" if host else ""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    drop = {
        "slug": company.get("slug"),
        "source": "zhiye-ats",
        "name": company.get("name"),
        "industries": company.get("industries", []),
        "scale": company.get("scale", ""),
        "tier": company.get("tier", 7),
        "category": company.get("category", "64"),
        "careerUrl": career_url,
        "sites": json.loads(json.dumps(company.get("sites", []))),
        "positions": [],
    }
    meta: dict[str, Any] = {"source": "zhiye-api", "api_jobs": 0, "api_errors": []}
    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    if not is_zhiye_host(host):
        errors.append({"url": career_url, "error": f"not a zhiye host: {host}"})
    else:
        try:
            portal = fetcher.fetch(career_url)
            if portal.blocked_by:
                raise AdapterError(f"portal blocked: {portal.blocked_by}")
            if portal.status >= 400:
                raise AdapterError(f"portal http {portal.status}")
            bs = parse_bs_global(portal.body)
            if not bs:
                raise AdapterError("no BSGlobal config in portal HTML")
            pid = portal_id(bs)
            if not pid:
                raise AdapterError("no PortalId in BSGlobal")
            bundle = bundle_url(bs, portal.body)
            if not bundle:
                raise AdapterError("no 2022 portal SPA bundle in shell HTML")
            script = fetcher.fetch(bundle)
            if script.blocked_by:
                raise AdapterError(f"bundle blocked: {script.blocked_by}")
            if script.status >= 400:
                raise AdapterError(f"bundle http {script.status}")
            candidates = extract_api_paths(script.body)
            if not candidates:
                raise AdapterError("no /api/ paths found in bundle")
            jobs, errors = fetch_all_jobs(
                fetcher, base_url, pid, page_size=page_size, max_jobs=max_jobs, candidates=candidates
            )
        except (AdapterError, AcquisitionError) as exc:
            errors.append({"url": career_url, "error": str(exc)})
    meta["api_errors"] = errors
    meta["api_jobs"] = len(jobs)
    if jobs:
        ensure_city_sites(drop, jobs)
        drop["positions"] = jobs_to_positions(jobs, drop, stamp, base_url=base_url)
    return drop, meta
