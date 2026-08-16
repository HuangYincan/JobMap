# Extract job-like links and JSON-LD JobPosting rows from public HTML.
# Heuristic only — official career SPAs often render empty without JS.

from __future__ import annotations

import json
import re
from html import unescape
from urllib.parse import urljoin

JOB_WORDS = (
    "招聘", "校招", "社招", "实习", "岗位", "职位", "campus", "intern",
    "career", "join", "position", "job",
)
NOISE_WORDS = (
    "流程", "攻略", "问答", "是什么", "福利介绍", "关于我们", "login", "登录",
)

_HREF = re.compile(r'''<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>''', re.I | re.S)
_JSONLD = re.compile(r'''<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>''', re.I | re.S)
_TAG = re.compile(r"<[^>]+>")


def _text(raw: str) -> str:
    return re.sub(r"\s+", " ", unescape(_TAG.sub(" ", raw))).strip()


def looks_like_job(title: str) -> bool:
    blob = title.lower()
    if not title or len(title) > 80:
        return False
    if any(word in blob for word in NOISE_WORDS):
        return False
    return any(word in blob for word in JOB_WORDS) or "工程师" in title or "intern" in blob


def extract_jsonld_jobs(html: str, page_url: str) -> list[dict[str, str]]:
    jobs: list[dict[str, str]] = []
    for match in _JSONLD.finditer(html):
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        nodes = payload if isinstance(payload, list) else [payload]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            graph = node.get("@graph")
            if isinstance(graph, list):
                nodes.extend(item for item in graph if isinstance(item, dict))
            types = node.get("@type")
            type_list = types if isinstance(types, list) else [types]
            if "JobPosting" not in type_list:
                continue
            title = str(node.get("title") or "").strip()
            url = str(node.get("url") or page_url).strip()
            if title:
                jobs.append({"title": title, "url": url, "kind": "jsonld"})
    return jobs


def extract_job_links(html: str, page_url: str) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    jobs: list[dict[str, str]] = []
    for href, inner in _HREF.findall(html):
        title = _text(inner)
        if not looks_like_job(title):
            continue
        url = urljoin(page_url, href)
        key = (title, url)
        if key in seen:
            continue
        seen.add(key)
        jobs.append({"title": title, "url": url, "kind": "link"})
    return jobs


def extract_jobs(html: str, page_url: str) -> list[dict[str, str]]:
    jsonld = extract_jsonld_jobs(html, page_url)
    if jsonld:
        return jsonld
    return extract_job_links(html, page_url)
