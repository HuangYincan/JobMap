# Map a published xiaozhao-radar jobs.json snapshot onto SourceCompany-shaped dicts.
# Shape only — do not copy their fetch/stealth/Tencent-docs code.
#
# The snapshot is a freshness signal: which companies are running campus / intern
# recruitment now, with a direct apply link. Titles are often category aggregates.

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .acquire import is_blocked_host

PARSER_VERSION = "1.2.0"
ATTRIBUTION = "xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping"

_HANGZHOU = ("杭州", "余杭", "西湖", "滨江", "萧山", "拱墅", "上城", "临平")

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


def mentions_hangzhou(location: str) -> bool:
    return any(token in (location or "") for token in _HANGZHOU)


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


def map_radar_job(row: Mapping[str, Any], *, retrieved_at: str | None = None) -> dict[str, Any] | None:
    company = str(row.get("c") or "").strip()
    title = str(row.get("p") or "").strip()
    url = str(row.get("u") or "").strip()
    if not company or not title or not url:
        return None
    if is_blocked_host(url):
        return None
    location = str(row.get("l") or "").strip()
    industry = guess_industry(str(row.get("ind") or row.get("t") or ""))
    family = guess_family(title, str(row.get("w") or ""))
    normalized = normalize_company_name(company)
    if not normalized:
        return None
    slug = anchor_slug(normalized) or slugify(normalized)
    site_id = f"{slug}-site"
    digest = hashlib.sha1(f"{company}|{title}|{location}".encode("utf-8")).hexdigest()[:12]
    return {
        "slug": slug,
        "name": normalized,
        "industries": [industry],
        "scale": "enterprise",
        "careerUrl": url,
        "sites": [
            {
                "id": site_id,
                "name": company,
                **({"location": {"address": location}} if location else {}),
            }
        ],
        "positions": [
            {
                "externalId": f"radar-{digest}",
                "title": title[:120],
                "siteId": site_id,
                "family": family,
                "taxonomy": {"family": family},
                "deadline": str(row.get("d") or "").strip() or None,
                "status": "open",
                "applySource": "official",
                "applyUrl": url,
                "retrievedAt": retrieved_at or None,
            }
        ],
        "_hangzhou": mentions_hangzhou(location),
    }


def merge_radar_companies(rows: list[Mapping[str, Any]], *, hangzhou_only: bool = True, retrieved_at: str | None = None) -> list[dict[str, Any]]:
    by_slug: dict[str, dict[str, Any]] = {}
    for row in rows:
        mapped = map_radar_job(row, retrieved_at=retrieved_at)
        if not mapped:
            continue
        if hangzhou_only and not mapped["_hangzhou"]:
            continue
        mapped.pop("_hangzhou", None)
        existing = by_slug.get(mapped["slug"])
        if not existing:
            by_slug[mapped["slug"]] = mapped
            continue
        seen = {pos["externalId"] for pos in existing["positions"]}
        for pos in mapped["positions"]:
            if pos["externalId"] not in seen:
                existing["positions"].append(pos)
                seen.add(pos["externalId"])
        if mapped.get("careerUrl") and not existing.get("careerUrl"):
            existing["careerUrl"] = mapped["careerUrl"]
    return list(by_slug.values())


def radar_fixture(payload: Mapping[str, Any], *, hangzhou_only: bool = True) -> dict[str, Any]:
    snapshot = str(payload.get("updated") or "")
    companies = merge_radar_companies(payload.get("jobs") or [], hangzhou_only=hangzhou_only, retrieved_at=snapshot)
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
