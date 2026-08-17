# Map a published xiaozhao-radar jobs.json snapshot onto SourceCompany-shaped dicts.
# Shape only — do not copy their fetch/stealth/Tencent-docs code.
#
# The snapshot is a freshness signal: which companies are running campus / intern
# recruitment now, with a direct apply link. Titles are often category aggregates;
# those rows are marked aggregate: true for LLM validation / curation, never
# silently expanded into multiple positions.

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .acquire import is_blocked_host

PARSER_VERSION = "2.0.0"
ATTRIBUTION = "xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping"

# Default target cities; the CLI --cities flag overrides. Canonical order is
# only a fallback — per-row site order follows the company's own city text.
CITY_TARGETS = ("北京", "上海", "广州", "深圳", "成都", "武汉", "杭州")
CITY_KEY = {
    "北京": "beijing",
    "上海": "shanghai",
    "广州": "guangzhou",
    "深圳": "shenzhen",
    "成都": "chengdu",
    "武汉": "wuhan",
    "杭州": "hangzhou",
}
CITY_FULL = {
    "北京": "北京市",
    "上海": "上海市",
    "广州": "广州市",
    "深圳": "深圳市",
    "成都": "成都市",
    "武汉": "武汉市",
    "杭州": "杭州市",
}
CITY_PROVINCE = {
    "北京": "北京市",
    "上海": "上海市",
    "广州": "广东省",
    "深圳": "广东省",
    "成都": "四川省",
    "武汉": "湖北省",
    "杭州": "浙江省",
}

# Anchors match normalized radar names onto our curated official-career slugs.
# Longer anchors first so "网易游戏雷火" wins over "网易".
RADAR_ANCHORS: tuple[tuple[str, str], ...] = (
    ("网易游戏", "netease-hangzhou"),
    ("字节跳动", "bytedance-hangzhou"),
    ("蚂蚁集团", "antgroup-hangzhou"),
    ("阿里巴巴", "alibaba-xixi"),
    ("泰格医药", "tigermed-hangzhou"),
    ("群核科技", "manycore-hangzhou"),
    ("之江实验室", "zhejiang-lab"),
    ("零跑汽车", "leapmotor-hangzhou"),
    ("新华三", "h3c-hangzhou"),
    ("同花顺", "hithink-hangzhou"),
    ("网易", "netease-hangzhou"),
    ("滴滴", "didi-hangzhou"),
)

_TRAILING_WORDS = (
    "校招", "招聘", "计划", "人才", "专项", "提前批", "暑期实习", "内推",
    "秋招", "春招", "实习", "毕业生", "岗位", "招聘公告", "项目",
)

# --- aggregate-title detection ------------------------------------------------
# Radar titles routinely bundle many roles into one row ("技术、设计、数据、运营、
# 产品等七大类", "软件类 算法类 硬件类"). Such rows get aggregate: true so the
# LLM validation pass and human curation treat them as bundles, never as a single
# position. Heuristics calibrated against the 2026-08-11 snapshot (1404 rows):
# ~87% of titles are aggregate by these rules; the rest are specific roles.

_PAREN_RE = re.compile(r"[（(][^）)]*[)）]")
_SEP_RE = re.compile(r"[/、，,；;｜|·\s]+")
_AGG_STRONG_RE = re.compile(r"大类|多类|各类|多岗位|多方向|全覆盖|赛道")


def paren_city_matches(title: str, cities: tuple[str, ...] = CITY_TARGETS) -> list[str]:
    """Distinct target cities mentioned inside parentheticals, in title order."""
    out: list[str] = []
    for group in _PAREN_RE.findall(title or ""):
        for city in cities:
            if city in group and city not in out:
                out.append(city)
    return out


def _cjk_tokens(title: str) -> list[str]:
    stripped = _PAREN_RE.sub("", title)
    return [tok for tok in _SEP_RE.split(stripped) if re.search(r"[一-鿿]", tok)]


def is_aggregate_title(title: str) -> bool:
    """True when a title bundles multiple roles / is not a specific job.

    Signals: 等/大类/多类/各类/赛道/全覆盖/多岗位, 2+ 类-words, multi-line text,
    2+ distinct city parens (concatenated mega-rows), or 2+ role tokens.
    """
    t = title or ""
    if "等" in t:
        return True
    if _AGG_STRONG_RE.search(t):
        return True
    if t.count("类") >= 2:
        return True
    if "\n" in t:
        return True
    if len(set(paren_city_matches(t))) >= 2:
        return True
    return len(_cjk_tokens(t)) >= 2


def slugify(name: str) -> str:
    compact = re.sub(r"[^0-9A-Za-z一-鿿]+", "-", name.strip()).strip("-").lower()
    return compact or "company"


def normalize_company_name(raw: str) -> str:
    name = (raw or "").strip()
    if not name:
        return ""
    # 去掉全角/半角引号内的项目名：“理想+” / (互娱) / "special"
    name = re.sub(r"[“”『』][^“”『』]*[“”『』]", "", name)
    name = re.sub(r"[（(].*?[)）]", "", name)
    name = re.sub(r"['\"][^'\"]*['\"]", "", name)
    # 去掉“—/–/-/间隔号”后的招聘项目名：阿里巴巴—阿里顶尖人才计划 → 阿里巴巴
    name = re.split(r"[—–‑−・·]", name)[0].strip()
    # 去掉开头异常字符（“！网易”）
    name = re.sub(r"^[！!]+", "", name).strip()
    # 反复去掉尾部营销/批次词
    changed = True
    while changed and name:
        changed = False
        for word in _TRAILING_WORDS:
            if name.endswith(word):
                name = name[: -len(word)].strip()
                changed = True
                break
    return name.rstrip("+＋%％ “”\"'").strip()


def anchor_slug(normalized: str) -> str | None:
    for anchor, slug in RADAR_ANCHORS:
        if anchor in normalized or normalized in anchor:
            return slug
    return None


def guess_family(title: str, batch: str) -> str:
    blob = f"{title} {batch}".lower()
    if "实习" in blob or "intern" in blob:
        return "intern"
    if "社招" in blob:
        return "social"
    return "campus"


def guess_industry(label: str) -> str:
    mapping = {
        "互联网科技": "internet",
        "互联网": "internet",
        "银行金融": "finance",
        "医药医疗": "pharma",
        "汽车制造": "auto",
        "装备重工": "manufacturing",
        "快消零售": "consumer",
        "通信运营商": "telecom",
        "能源电力": "energy",
    }
    return mapping.get(label, "other")


def target_cities_in(location: str, cities: tuple[str, ...] = CITY_TARGETS) -> list[str]:
    """Target cities mentioned in a location text, in appearance order."""
    loc = location or ""
    found = [(loc.index(city), city) for city in cities if city in loc]
    found.sort()
    return [city for _, city in found]


def parse_deadline(raw: str | None) -> str | None:
    """Accept YYYY[-/ .]MM[-/ .]DD (delimiters optional); anything else → None.

    Radar deadlines are human text ("招满即止", "2026 10 15") and the DB
    positions.deadline is a date column, so non-dates must not be forwarded.
    """
    if not raw:
        return None
    text = raw.strip()
    m = re.match(r"^(\d{4})\s*[-/.]?\s*(\d{1,2})\s*[-/.]?\s*(\d{1,2})$", text)
    if not m:
        return None
    year, month, day = (int(g) for g in m.groups())
    try:
        return datetime(year, month, day).strftime("%Y-%m-%d")
    except ValueError:
        return None


def load_radar_jobs(payload: Mapping[str, Any] | str | Path) -> dict[str, Any]:
    if isinstance(payload, (str, Path)) and Path(payload).exists():
        data = json.loads(Path(payload).read_text(encoding="utf-8"))
    elif isinstance(payload, str):
        data = json.loads(payload)
    else:
        data = dict(payload)
    jobs = data.get("jobs")
    if not isinstance(jobs, list):
        raise ValueError("jobs.json must contain a jobs array")
    return data


def map_radar_job(
    row: Mapping[str, Any],
    *,
    target_cities: tuple[str, ...] | None = None,
    retrieved_at: str | None = None,
) -> dict[str, Any] | None:
    """Map one radar row onto a SourceCompany-shaped dict with per-city sites.

    Sites are split from the row's city text (e.g. "上海/广州/杭州") into
    `${slug}-site-${cityKey}` sites carrying site.city / site.province and the
    raw city text as location.address (geocode uses the city field, not the
    text). A position whose title names exactly one target city in parens is
    attached to that city's site; otherwise it lands on the main site (the
    first city the company's text mentions).
    """
    cities = tuple(target_cities) if target_cities else CITY_TARGETS
    company = str(row.get("c") or "").strip()
    title = str(row.get("p") or "").strip()
    url = str(row.get("u") or "").strip()
    if not company or not title or not url:
        return None
    if is_blocked_host(url):
        return None
    location = str(row.get("l") or "").strip()
    matched = target_cities_in(location, cities)
    if not matched:
        return None
    industry = guess_industry(str(row.get("ind") or row.get("t") or ""))
    family = guess_family(title, str(row.get("w") or ""))
    normalized = normalize_company_name(company)
    if not normalized:
        return None
    slug = anchor_slug(normalized) or slugify(normalized)
    sites = [
        {
            "id": f"{slug}-site-{CITY_KEY[city]}",
            "name": company,
            "city": CITY_FULL[city],
            "province": CITY_PROVINCE[city],
            "location": {"address": location},
        }
        for city in matched
    ]
    main_site_id = sites[0]["id"]
    paren_cities = paren_city_matches(title, cities)
    site_id = (
        f"{slug}-site-{CITY_KEY[paren_cities[0]]}"
        if len(paren_cities) == 1 and paren_cities[0] in matched
        else main_site_id
    )
    digest = hashlib.sha1(f"{company}|{title}|{location}".encode("utf-8")).hexdigest()[:12]
    position: dict[str, Any] = {
        "externalId": f"radar-{digest}",
        "title": title[:120],
        "siteId": site_id,
        "family": family,
        "taxonomy": {"family": family},
        "deadline": parse_deadline(str(row.get("d") or "")),
        "status": "open",
        "applySource": "official",
        "applyUrl": url,
        "retrievedAt": retrieved_at or None,
    }
    if is_aggregate_title(title):
        position["aggregate"] = True
    return {
        "slug": slug,
        "name": normalized,
        "tier": 12,
        "category": "other",
        "industries": [industry],
        "scale": "enterprise",
        "careerUrl": url,
        "sites": sites,
        "positions": [position],
    }


def merge_radar_companies(
    rows: list[Mapping[str, Any]],
    *,
    target_cities: tuple[str, ...] | None = None,
    retrieved_at: str | None = None,
) -> list[dict[str, Any]]:
    by_slug: dict[str, dict[str, Any]] = {}
    for row in rows:
        mapped = map_radar_job(row, target_cities=target_cities, retrieved_at=retrieved_at)
        if not mapped:
            continue
        existing = by_slug.get(mapped["slug"])
        if not existing:
            by_slug[mapped["slug"]] = mapped
            continue
        known_sites = {site["id"] for site in existing["sites"]}
        for site in mapped["sites"]:
            if site["id"] not in known_sites:
                existing["sites"].append(site)
                known_sites.add(site["id"])
        seen = {pos["externalId"] for pos in existing["positions"]}
        for pos in mapped["positions"]:
            if pos["externalId"] not in seen:
                existing["positions"].append(pos)
                seen.add(pos["externalId"])
        if mapped.get("careerUrl") and not existing.get("careerUrl"):
            existing["careerUrl"] = mapped["careerUrl"]
    return list(by_slug.values())


def radar_fixture(payload: Mapping[str, Any], *, target_cities: tuple[str, ...] | None = None) -> dict[str, Any]:
    snapshot = str(payload.get("updated") or "")
    companies = merge_radar_companies(payload.get("jobs") or [], target_cities=target_cities, retrieved_at=snapshot)
    records = []
    for company in companies:
        for pos in company["positions"]:
            records.append({"external_id": pos["externalId"], "attributes": {"company": company["name"], "title": pos["title"]}})
    return {
        "source": {
            "code": "xiaozhao-radar",
            "original_url": "https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json",
            "license_basis": "Apache-2.0",
            "attribution": ATTRIBUTION,
            "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "parser_version": PARSER_VERSION,
            "retention_class": "public",
        },
        "records": records,
        "companies": companies,
    }
