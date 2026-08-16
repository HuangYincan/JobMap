# Extract job-like links and JSON-LD JobPosting rows from public HTML.
# Heuristic only — official career SPAs often render empty without JS.

from __future__ import annotations

import json
import re
from html import unescape
from urllib.parse import urljoin

JOB_WORDS_ZH = ("招聘", "校招", "社招", "实习", "岗位", "职位", "工程师", "开发", "加入")
# English tokens use word boundaries so "campus" matches but a nav CTA "Join X" does not.
JOB_WORDS_EN = re.compile(
    r"\b(career|job|campus|intern|position|vacanc|recruit|talent)\b", re.I
)
NOISE_WORDS = (
    "流程", "攻略", "问答", "是什么", "福利介绍", "关于我们", "login", "登录", "首页",
    "了解", "合作伙伴", "投资者", "新闻", "产品",
)
NAV_CTAS = re.compile(r"^\s*(join|加入我们|联系我们|加入我们\s*$)", re.I)
_BAD_HREF = ("javascript:", "mailto:", "tel:", "#", "about:", "vbscript:")
MAX_TITLE = 48

_HREF = re.compile(r'''<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>''', re.I | re.S)
_JSONLD = re.compile(r'''<script[^>]+type=["']application/ld\+json["'][^>]*>(.*?)</script>''', re.I | re.S)
_TAG = re.compile(r"<[^>]+>")


def _text(raw: str) -> str:
    return re.sub(r"\s+", " ", unescape(_TAG.sub(" ", raw))).strip()


def looks_like_job(title: str) -> bool:
    if not title or len(title) > MAX_TITLE:
        return False
    if NAV_CTAS.match(title):
        return False
    blob = title.lower()
    if any(word in blob for word in NOISE_WORDS):
        return False
    if any(zh in title for zh in JOB_WORDS_ZH):
        return True
    return bool(JOB_WORDS_EN.search(blob))


def looks_like_job_href(href: str) -> bool:
    href = (href or "").strip()
    if not href or href.startswith(_BAD_HREF):
        return False
    return True


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
        if not looks_like_job_href(href):
            continue
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
