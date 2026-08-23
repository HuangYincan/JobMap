# Polite HTTP fetch for approved official career pages.
# No login, no JS browser, no CAPTCHA, no rate-limit evasion.

from __future__ import annotations

import codecs
import http.client
import ipaddress
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, HTTPSHandler, HTTPHandler, ProxyHandler, Request, build_opener

USER_AGENT = "DomainMapImporter/0.1 (+https://github.com/acccan/domain-map; recruitment catalog refresh)"
DEFAULT_TIMEOUT_S = 12
DEFAULT_MIN_INTERVAL_S = 2.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024

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


def _is_public_ip(raw_address: str) -> bool:
    """Treat loopback/private/link-local/mapped-private addresses as unsafe."""
    try:
        address = ipaddress.ip_address(raw_address)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_global


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def is_blocked_host(url: str) -> bool:
    host = host_of(url)
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in BLOCKED_HOST_SUFFIXES)


_INTERNAL_HOST_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
)


def _is_non_public_literal_host(host: str) -> bool:
    """Reject loopback/private/link-local literals and conventional internal names."""
    if host == "localhost" or host.endswith(_INTERNAL_HOST_SUFFIXES):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return not _is_public_ip(address)


def is_allowed_redirect(url: str) -> bool:
    """Keep automatic redirects public and inside the same eligibility rules."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme in {"http", "https"}
        and bool(host)
        and not is_blocked_host(url)
        and not _is_non_public_literal_host(host)
        and not _has_share_token(url)
    )


def _has_share_token(url: str) -> bool:
    """Referral/share tokens are personal attribution, not public page URLs."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return True
    if "/referral/" in parsed.path.lower():
        return True
    return any(
        key.lower() in {"token", "share_token"}
        for key, _value in parse_qsl(parsed.query, keep_blank_values=True)
    )


def is_allowed_redirect_from(previous_url: str, url: str) -> bool:
    """Reject TLS downgrades while retaining the normal public-host checks."""
    if urlparse(previous_url).scheme.lower() != "https":
        return is_allowed_redirect(url)
    return urlparse(url).scheme.lower() == "https" and is_allowed_redirect(url)


class SafeRedirectHandler(HTTPRedirectHandler):
    """Reject unsafe redirects, blocked hosts, and HTTPS downgrades."""

    def __init__(self, *, allow_redirect=is_allowed_redirect_from) -> None:
        super().__init__()
        self._allow_redirect = allow_redirect

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        previous_url = req.full_url
        if not self._allow_redirect(previous_url, newurl):
            raise AcquisitionError(f"unsafe redirect: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class PrivateAddressError(OSError):
    """Raised after a resolver selects an address outside the public Internet."""


def _require_public_peer(sock) -> None:
    address = ipaddress.ip_address(sock.getpeername()[0])
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if not address.is_global:
        raise PrivateAddressError(f"refusing non-public resolved address: {address}")


class _SafeHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        try:
            super().connect()
            _require_public_peer(self.sock)
        except Exception:
            self.close()
            raise


class _SafeHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Establish only TCP first. Validating after HTTPSConnection.connect()
        # would complete the TLS handshake with a rebound private endpoint.
        try:
            http.client.HTTPConnection.connect(self)
            _require_public_peer(self.sock)
            server_hostname = self._tunnel_host or self.host
            self.sock = self._context.wrap_socket(
                self.sock,
                server_hostname=server_hostname,
            )
        except Exception:
            self.close()
            raise


class PublicHTTPHandler(HTTPHandler):
    def http_open(self, req):
        return self.do_open(_SafeHTTPConnection, req)


class PublicHTTPSHandler(HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_SafeHTTPSConnection, req, context=self._context)


urlopen = build_opener(
    ProxyHandler({}),
    SafeRedirectHandler(),
    PublicHTTPHandler(),
    PublicHTTPSHandler(),
).open


def parse_robots(robots_txt: str, path: str, user_agent: str = USER_AGENT) -> bool:
    """Return True when the path is allowed for this UA. Missing file → allow.

    RFC 9309: the most specific matching UA group wins (a group naming our UA
    beats ``User-agent: *``); within that group the longest-matching path rule
    wins, with ``Allow`` breaking ties over ``Disallow``.
    """
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
        if not line or ":" not in line:
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

    # Most specific UA group wins; RFC 9309 §2.2.1: when several groups match the
    # same UA, the last one in the file applies. The anonymous "*" group is only
    # the fallback when no group names our UA.
    selected: list[tuple[str, str]] | None = None
    for agents, rules in groups:
        if ua in agents:
            selected = rules
    if selected is None:
        for agents, rules in groups:
            if "*" in agents:
                selected = rules
    if selected is None:
        return True

    applicable = [(kind, rule) for kind, rule in selected if rule and path.startswith(rule)]
    if not applicable:
        # No rule matched (including a bare "Disallow:") → allowed.
        return True
    longest = max(len(rule) for _kind, rule in applicable)
    tie = [kind for kind, rule in applicable if len(rule) == longest]
    return "allow" in tie


def _read_limited(response) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_RESPONSE_BYTES:
            raise OSError(f"response exceeds {MAX_RESPONSE_BYTES} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


def _http_fetch(url: str, method: str = "GET", body: str | None = None, headers: dict[str, str] | None = None, timeout: int = DEFAULT_TIMEOUT_S) -> tuple[int, str]:
    request_headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}
    data = None
    if method == "POST":
        request_headers["Content-Type"] = "application/json"
        data = (body or "").encode("utf-8")
    if headers:
        request_headers.update(headers)
    request = Request(url, data=data, method=method, headers=request_headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = _read_limited(response)
            charset = response.headers.get_content_charset()
            try:
                if charset:
                    codecs.lookup(charset)
            except (LookupError, TypeError):
                charset = None  # some sites ship a misspelled charset (e.g. "uft-8")
            return response.status, raw.decode(charset or "utf-8", errors="replace")
    except HTTPError as exc:
        body = _read_limited(exc.fp).decode("utf-8", errors="replace") if exc.fp else ""
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
    def __init__(self, *, min_interval_s: float = DEFAULT_MIN_INTERVAL_S, sleep=time.sleep, get=_http_fetch):
        self.min_interval_s = min_interval_s
        self._sleep = sleep
        self._get = get
        self._last = 0.0

    def _pace(self) -> None:
        wait = self.min_interval_s - (time.monotonic() - self._last)
        if wait > 0:
            self._sleep(wait)

    def fetch(self, url: str, method: str = "GET", body: str | None = None, headers: dict[str, str] | None = None) -> FetchResult:
        if not url.startswith(("https://", "http://")):
            raise AcquisitionError("only http(s) URLs are allowed")
        if is_blocked_host(url):
            raise AcquisitionError(f"blocked host: {host_of(url)}")
        if _has_share_token(url):
            raise AcquisitionError("referral/share token URLs are not fetched")
        if not is_allowed_redirect(url):
            raise AcquisitionError(f"non-public fetch target: {host_of(url)}")
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
            status, response_body = self._get(url, method=method, body=body, headers=headers)
        except (OSError, URLError, TimeoutError):
            status, response_body = 0, ""
        self._last = time.monotonic()
        return FetchResult(
            url=url,
            status=status,
            body=response_body,
            fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
