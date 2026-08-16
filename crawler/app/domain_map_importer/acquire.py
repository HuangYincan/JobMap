# Polite HTTP fetch for approved official career pages.
# No login, no JS browser, no CAPTCHA, no rate-limit evasion.

from __future__ import annotations

import codecs
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

USER_AGENT = "DomainMapImporter/0.1 (+https://github.com/acccan/domain-map; recruitment catalog refresh)"
DEFAULT_TIMEOUT_S = 12
DEFAULT_MIN_INTERVAL_S = 2.0

# Aggregators / boards this repo will not fetch automatically.
BLOCKED_HOST_SUFFIXES = (
    "zhipin.com",
    "boss.com",
    "nowcoder.com",
    "xiaohongshu.com",
    "xhslink.com",
    "sxsimg.com",
    "shixiseng.com",
    "51job.com",
    "zhaopin.com",
    "liepin.com",
    "lagou.com",
    "docs.qq.com",
)


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int
    body: str
    fetched_at: str
    blocked_by: str | None = None


class AcquisitionError(ValueError):
    """Raised when a URL is not eligible for automated fetch."""


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def is_blocked_host(url: str) -> bool:
    host = host_of(url)
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in BLOCKED_HOST_SUFFIXES)


def parse_robots(robots_txt: str, path: str, user_agent: str = USER_AGENT) -> bool:
    """Return True when the path is allowed for this UA. Missing file → allow."""
    ua = user_agent.split("/")[0].lower()
    groups: list[tuple[list[str], list[tuple[str, str]]]] = []
    current_agents: list[str] = []
    current_rules: list[tuple[str, str]] = []

    def flush() -> None:
        nonlocal current_agents, current_rules
        if current_agents:
            groups.append((current_agents, current_rules))
        current_agents, current_rules = [], []

    for raw in robots_txt.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key == "user-agent":
            if current_rules:
                flush()
            current_agents.append(value.lower())
        elif key in {"allow", "disallow"}:
            if not current_agents:
                current_agents = ["*"]
            current_rules.append((key, value))
    flush()

    matched: list[tuple[str, str]] = []
    for agents, rules in groups:
        if ua in agents or "*" in agents:
            matched.extend(rules)
    if not matched:
        return True

    applicable = [(kind, rule) for kind, rule in matched if rule and path.startswith(rule)]
    if not applicable:
        # Bare Disallow: (empty) means allow all.
        return True
    kind, _ = max(applicable, key=lambda item: len(item[1]))
    return kind == "allow"


def _http_get(url: str, timeout: int = DEFAULT_TIMEOUT_S) -> tuple[int, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            charset = response.headers.get_content_charset()
            try:
                if charset:
                    codecs.lookup(charset)
            except (LookupError, TypeError):
                charset = None  # some sites ship a misspelled charset (e.g. "uft-8")
            return response.status, raw.decode(charset or "utf-8", errors="replace")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return exc.code, body
    except (OSError, URLError, TimeoutError):
        # Transient network / SSL errors are a soft skip, not a fatal crash.
        return 0, ""


def robots_allows(url: str, fetch_robots) -> bool:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        status, text = fetch_robots(robots_url)
    except (OSError, URLError, TimeoutError, ValueError):
        return True
    if status >= 400:
        return True
    return parse_robots(text, parsed.path or "/")


class PoliteFetcher:
    def __init__(self, *, min_interval_s: float = DEFAULT_MIN_INTERVAL_S, sleep=time.sleep, get=_http_get):
        self.min_interval_s = min_interval_s
        self._sleep = sleep
        self._get = get
        self._last = 0.0

    def _pace(self) -> None:
        wait = self.min_interval_s - (time.monotonic() - self._last)
        if wait > 0:
            self._sleep(wait)

    def fetch(self, url: str) -> FetchResult:
        if not url.startswith(("https://", "http://")):
            raise AcquisitionError("only http(s) URLs are allowed")
        if is_blocked_host(url):
            raise AcquisitionError(f"blocked host: {host_of(url)}")
        if not robots_allows(url, self._get):
            return FetchResult(
                url=url,
                status=0,
                body="",
                fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                blocked_by="robots.txt",
            )
        self._pace()
        try:
            status, body = self._get(url)
        except (OSError, URLError, TimeoutError):
            status, body = 0, ""
        self._last = time.monotonic()
        return FetchResult(
            url=url,
            status=status,
            body=body,
            fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
