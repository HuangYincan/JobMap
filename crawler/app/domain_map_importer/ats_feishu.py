# Feishu jobs (jobs.feishu.cn) ATS adapter — per-tenant public job search API.
#
# REAL endpoint (discovered 2026-08-19 by JS bundle analysis, live-validated
# on agirobot / poizon / kwh0jtf778 tenants):
#   POST https://<host>/api/v1/search/job/posts
#     query string mirrors the JSON body params + optional SDK `_signature`
#     (NOT required — plain curl with empty lists works).
#     body: {"keyword":"", "limit":50, "offset":0, "job_category_id_list":[],
#            "tag_id_list":[], "location_code_list":[], "subject_id_list":[],
#            "recruitment_id_list":[], "portal_type":6, "job_function_id_list":[],
#            "storefront_id_list":[], "portal_entrance":1}
#     headers: website-path=<site_id> selects a tenant's career-site pool
#              (得物 578078 校招 / 智元 946993 / 禾赛 073183); without it the
#              default pool (社招) is returned. portal-channel/portal-platform
#              are cosmetic (page SDK stamps them).
#   response: {"code":0, "data":{"job_post_list":[...], "count":N, "extra":...}}
#   pagination: limit+offset until offset >= count.
#   portal_type is ignored by these tenants (same pool for 1..8).
#   recruit_type: {"id":"201","name":"正式","parent":{"name":"校招"}} → campus;
#                 "实习" → intern; "全职"/"外包" → social.
#
# The previously-documented GET /api/v1/search_job (page_size/page_token) is a
# headhunter-platform catch-all: every request returns the "字节跳动猎头平台"
# HTML shell, never JSON — do NOT regress to it (2026-08-19 lesson).
#
# Access rules: PoliteFetcher only (robots gate, >=2s pacing, no login / no
# CAPTCHA / no rate-limit evasion). No cookies / no _signature needed.

from __future__ import annotations

import json
import os
import re
from typing import Any

SEARCH_JOB_PATH = "/api/v1/search/job/posts"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 50
MAX_JOBS = 2000  # safety cap per tenant
MAX_JD_CHARS = 8000

# Live access is intentionally opt-in.  The source currently answers the
# importer UA with 405; using a browser UA to get around that is not an
# authorized access method.  Set this only after an operator has recorded
# source authorization and the allowed access/rate policy.
FEISHU_LIVE_REFRESH_ENV = "DOMAIN_MAP_FEISHU_LIVE_REFRESH_AUTHORIZED"


def feishu_live_refresh_authorized() -> bool:
    """Return whether an operator explicitly enabled live Feishu refresh."""
    return os.environ.get(FEISHU_LIVE_REFRESH_ENV, "").strip().lower() in {"1", "true", "yes"}

# ATS 录入笔误归一(2026-08-19 实测禾赛租户出现 "北揽"):
CITY_ALIASES = {"北揽": "北京"}

# 城市名 → site.id 拼音段(与 radar drops 的 site id 约定一致,如 得物-site-shanghai)。
CITY_PINYIN = {
    "北京": "beijing", "上海": "shanghai", "广州": "guangzhou", "深圳": "shenzhen",
    "杭州": "hangzhou", "成都": "chengdu", "武汉": "wuhan", "苏州": "suzhou",
    "宁波": "ningbo", "南京": "nanjing", "西安": "xian", "重庆": "chongqing",
    "长沙": "changsha", "合肥": "hefei", "天津": "tianjin", "青岛": "qingdao",
    "厦门": "xiamen", "珠海": "zhuhai", "佛山": "foshan", "东莞": "dongguan",
}

# 城市 → 省(geocode regeo 校验用;site 缺 province 时 siteCityTarget 默认
# 浙江省, 会把所有上海/北京等地址站点误判为「省外」拒绝 — 2026-08-19 教训)。
CITY_PROVINCE = {
    "北京": "北京市", "上海": "上海市", "天津": "天津市", "重庆": "重庆市",
    "杭州": "浙江省", "宁波": "浙江省", "温州": "浙江省", "嘉兴": "浙江省",
    "苏州": "江苏省", "南京": "江苏省", "无锡": "江苏省", "常州": "江苏省",
    "广州": "广东省", "深圳": "广东省", "珠海": "广东省", "佛山": "广东省",
    "东莞": "广东省", "成都": "四川省", "武汉": "湖北省", "西安": "陕西省",
    "长沙": "湖南省", "合肥": "安徽省", "青岛": "山东省", "厦门": "福建省",
    "郑州": "河南省", "济南": "山东省", "沈阳": "辽宁省", "长春": "吉林省",
    "哈尔滨": "黑龙江省", "昆明": "云南省", "贵阳": "贵州省", "南昌": "江西省",
    "福州": "福建省", "南宁": "广西壮族自治区", "兰州": "甘肃省",
}

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


def build_search_url(host: str, offset: int = 0, limit: int = DEFAULT_PAGE_SIZE, website_path: str = "") -> str:
    """Query string mirrors the JSON body (the portal sends both)."""
    params = [
        f"keyword=", f"limit={limit}", f"offset={offset}",
        "job_category_id_list=", "tag_id_list=", "location_code_list=",
        "subject_id_list=", "recruitment_id_list=", "portal_type=6",
        "job_function_id_list=", "storefront_id_list=", "portal_entrance=1",
    ]
    return f"https://{host}{SEARCH_JOB_PATH}?{'&'.join(params)}"


def build_search_body(offset: int = 0, limit: int = DEFAULT_PAGE_SIZE) -> dict[str, Any]:
    return {
        "keyword": "",
        "limit": limit,
        "offset": offset,
        "job_category_id_list": [],
        "tag_id_list": [],
        "location_code_list": [],
        "subject_id_list": [],
        "recruitment_id_list": [],
        "portal_type": 6,
        "job_function_id_list": [],
        "storefront_id_list": [],
        "portal_entrance": 1,
    }


def parse_page(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Return (job_post_list, total_count) for one API page."""
    if not isinstance(payload, dict):
        raise AdapterError(f"feishu API returned non-object payload: {type(payload).__name__}")
    code = payload.get("code")
    if code not in (0, None):
        message = payload.get("message") or payload.get("msg") or ""
        raise AdapterError(f"feishu API code={code} {message}".strip())
    data = payload.get("data")
    if not isinstance(data, dict):
        raise AdapterError(f"feishu API payload has no data object: keys={sorted(payload)[:6]}")
    job_list = data.get("job_post_list")
    if not isinstance(job_list, list):
        raise AdapterError(f"feishu API data has no job_post_list array: keys={sorted(data)[:8]}")
    count = data.get("count")
    total = int(count) if isinstance(count, int) else len(job_list)
    return job_list, total


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
    """recruit_type 字段 → family。

    API 形状: {"id":"201","name":"正式","parent":{"name":"校招"}}。
    "正式"+parent 校招 → campus; "实习" → intern; "全职"/"外包" → social。
    兼容旧字符串形状(纯 "intern"/"social"/"campus")。
    """
    from .official_refresh import guess_family

    if isinstance(recruit_type, dict):
        name = _string(recruit_type.get("name"))
        parent = recruit_type.get("parent")
        parent_name = _string(parent.get("name")) if isinstance(parent, dict) else ""
        if "实习" in name:
            return "intern"
        if "校招" in parent_name or "校招" in name:
            return "campus"
        if name in ("全职", "外包", "正式"):
            return "social"
    kind = _string(recruit_type).lower()
    if "intern" in kind or "实习" in kind:
        return "intern"
    if kind in {"social", "campus"}:
        return kind
    return guess_family(title)


def normalize_city(name: Any) -> str:
    """ATS 城市名归一:去掉空值/笔误(禾赛 "北揽" → "北京")。"""
    city = _string(name)
    if not city:
        return ""
    return CITY_ALIASES.get(city, city)


def job_city(job: dict[str, Any]) -> str:
    """主城市:city_list 第一项(列表按相关性排序,首个即主办公地)。"""
    for city in job.get("city_list") or []:
        name = normalize_city(city.get("name") if isinstance(city, dict) else city)
        if name:
            return name
    return ""


def job_addresses(job: dict[str, Any]) -> list[dict[str, str]]:
    """job_post_info.address_list → [{city, address, district}]。

    ATS 录入的精确办公地址(区+路+门牌),如 得物「黄兴路221号互联宝地T7栋一楼」。
    这是 geocoding v3(5000 次/天)落点的关键——城市名只有城市中心点,ATS 地址
    可以落到具体办公楼 (2026-08-19 发现,list 响应即含 address_list)。
    """
    jpi = job.get("job_post_info") or {}
    out: list[dict[str, str]] = []
    for a in jpi.get("address_list") or []:
        if not isinstance(a, dict):
            continue
        name = _string(a.get("name"))
        if not name or name in ("上海", "北京", "广州", "深圳", "杭州", "成都", "武汉"):
            continue  # 纯城市名地址(无门牌)跳过,别把城市中心当办公点
        city = normalize_city(((a.get("city") or {}).get("name")))
        district = _string((a.get("district") or {}).get("name"))
        out.append({"city": city, "address": name, "district": district})
    return out


def city_site_id(slug: str, city: str) -> str:
    """按城市建 site id: {slug}-site-{pinyin}(确定性派生)。

    别名归一 → 去「省/市/区」后缀与空白 → CITY_PINYIN 查表;仍未收录的城市
    保留中文原样(无第三方拼音库依赖,同城市永远同 id,与 radar 的 site id
    约定同形,如 {slug}-site-郑州)。'unknown' 只在城市名为空时兜底,不作为掩码。
    """
    city = CITY_ALIASES.get(city, city)
    bare = re.sub(r"\s+", "", city)
    bare = re.sub(r"[省市区]$", "", bare)
    pinyin = (
        CITY_PINYIN.get(bare)
        or CITY_PINYIN.get(city)
        or re.sub(r"[^0-9A-Za-z一-鿿]+", "", bare).lower()
        or "unknown"
    )
    return f"{slug}-site-{pinyin}"


def site_id_for_job(company: dict[str, Any], job: dict[str, Any]) -> str:
    """岗位落点:job 城市匹配到公司现有 site 用其 id;否则按城市约定 id。

    Company sites 的 id 约定 {slug}-site-{pinyin}(radar drops 同款),job 城市
    名优先复用已 curated 的 site(保坐标/地址),新城市则用 city_site_id。
    """
    city = job_city(job)
    if city:
        for site in company.get("sites", []):
            if site.get("id", "").endswith(f"-site-{CITY_PINYIN.get(city, city)}") or city in (site.get("city") or ""):
                return site["id"]
    sites = company.get("sites") or []
    return sites[0]["id"] if sites else f"{company['slug']}-site"


def job_to_position(job: dict[str, Any], site_id: str, retrieved_at: str, host: str = "", website_path: str = "") -> dict[str, Any]:
    """Map one feishu API job onto the SourcePosition shape (recruitment-source.ts).

    externalId 必须是 portal-* 前缀才被 isAuthenticPositionId 视为真实岗位
    (旧实现用 feishu-* 前缀,import 时被过滤,图上永远不出现 —— 2026-08-19 教训)。
    """
    if not isinstance(job, dict):
        raise AdapterError(f"feishu job row must be an object: {type(job).__name__}")
    job_id = _string(job.get("id"))
    title = _string(job.get("title"))
    if not job_id or not title:
        raise AdapterError(f"feishu job row missing id/title: keys={sorted(job)[:8]}")
    description = clean_jd(job.get("description"))
    requirement = clean_jd(job.get("requirement"))
    jd = f"{description}\n\n岗位要求:\n{requirement}".strip()
    family = family_for(job.get("recruit_type"), title)
    base = f"https://{host}" if host else ""
    site_prefix = f"/{website_path}" if website_path else ""
    position: dict[str, Any] = {
        "externalId": f"portal-feishu-{job_id}",
        "source": "feishu-ats",
        "title": title[:120],
        "siteId": site_id,
        "family": family,
        "taxonomy": {"family": family},
        "status": "open",
        "applySource": "official",
        "applyUrl": f"{base}{site_prefix}/position/{job_id}/detail",
        "retrievedAt": retrieved_at,
    }
    if jd:
        position["description"] = jd
    return position


def jobs_to_positions(
    jobs: list[dict[str, Any]],
    company: dict[str, Any],
    retrieved_at: str,
    host: str = "",
    website_path: str = "",
    diagnostics: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Map crawled jobs onto the company's sites (per-job city → site).

    Malformed rows are retained as diagnostics when the optional list is
    provided. Callers writing a snapshot must treat any such diagnostic as a
    partial result rather than silently reconciling the valid subset.
    """
    positions = []
    for index, job in enumerate(jobs):
        try:
            if not isinstance(job, dict):
                raise AdapterError(f"feishu job row must be an object: {type(job).__name__}")
            positions.append(job_to_position(job, site_id_for_job(company, job), retrieved_at, host=host, website_path=website_path))
        except AdapterError as exc:
            if diagnostics is not None:
                diagnostics.append({"index": index, "error": str(exc)})
    return positions


def fetch_page(fetcher, host: str, offset: int, limit: int = DEFAULT_PAGE_SIZE, website_path: str = "") -> tuple[list[dict[str, Any]], int]:
    """Fetch one POST page; return (jobs, total_count).

    The caller must explicitly opt in to the live adapter.  In particular, a
    405 response is never retried with a browser User-Agent: that would cross
    the source's stated crawler access boundary.
    """
    url = build_search_url(host, offset=offset, limit=limit, website_path=website_path)
    body = json.dumps(build_search_body(offset=offset, limit=limit))
    headers = {
        # Keep the honest importer UA supplied by PoliteFetcher.  Do not add a
        # browser UA here to bypass a source-side crawler gate (VULN-20260901-01).
        "Content-Type": "application/json",
        "portal-channel": "saas-career",
        "portal-platform": "pc",
        "accept": "application/json, text/plain, */*",
    }
    if website_path:
        headers["website-path"] = website_path
    result = fetcher.fetch(url, method="POST", body=body, headers=headers)
    if result.blocked_by:
        raise AdapterError(f"blocked: {result.blocked_by}")
    if result.status >= 400:
        raise AdapterError(f"http {result.status}")
    try:
        payload = json.loads(result.body)
    except json.JSONDecodeError:
        raise AdapterError("non-JSON response body")
    return parse_page(payload)


def fetch_all_jobs(
    fetcher,
    host: str,
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_jobs: int = MAX_JOBS,
    website_path: str = "",
    allow_live_refresh: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Fetch every page of the tenant's job list via limit+offset.

    Live Feishu refresh is frozen by default pending explicit source
    authorization.  Tests may pass ``allow_live_refresh=True`` with an
    injected fake fetcher; production callers must make the same explicit
    authorization decision before enabling network access.  A frozen call
    returns an incomplete diagnostic without touching the network.

    Returns (jobs, page_errors). Malformed pages abort pagination but surface
    as errors (never crash the batch). Any non-empty errors make the result
    incomplete and callers must not reconcile or write it as a full snapshot.
    """
    if not isinstance(page_size, int) or isinstance(page_size, bool) or page_size < 1 or page_size > MAX_PAGE_SIZE:
        raise ValueError(f"page_size must be an integer between 1 and {MAX_PAGE_SIZE}")
    if not isinstance(max_jobs, int) or isinstance(max_jobs, bool) or max_jobs < 1:
        raise ValueError("max_jobs must be a positive integer")
    max_jobs = min(max_jobs, MAX_JOBS)
    if not allow_live_refresh:
        return [], [{
            "url": f"https://{host}{SEARCH_JOB_PATH}",
            "error": "live Feishu refresh is frozen pending explicit source authorization",
        }]

    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    offset = 0
    total = None
    while offset < (total if total is not None else max_jobs):
        remaining = max_jobs - len(jobs)
        if remaining <= 0:
            break
        limit = min(page_size, remaining)
        url = build_search_url(host, offset=offset, limit=limit, website_path=website_path)
        try:
            page_jobs, total = fetch_page(fetcher, host, offset, limit=limit, website_path=website_path)
        except AdapterError as exc:
            errors.append({"url": url, "error": str(exc)})
            break
        if not page_jobs and total > offset:
            errors.append({"url": url, "error": "empty page before reported total"})
            break
        jobs.extend(page_jobs[:remaining])
        page_exceeded_cap = len(page_jobs) > remaining
        if len(jobs) >= max_jobs:
            if page_exceeded_cap or total > offset + len(page_jobs):
                errors.append({"url": url, "error": f"reached max_jobs={max_jobs}"})
            break
        if total <= offset + len(page_jobs):
            break
        next_offset = offset + limit
        if next_offset <= offset:
            errors.append({"url": url, "error": "pagination offset did not advance"})
            break
        offset = next_offset
    return jobs, errors
