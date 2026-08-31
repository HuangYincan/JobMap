# Official career HTML refresh

> **Status:** reviewed for polite GET of curated `careerUrl` pages already in `server/data/recruitment/official-career/`.
> **Reviewed:** 2026-08-17
> **Owner:** product / data

## Purpose

When a career page ships HTML or JSON-LD `JobPosting`, extract extra titles and append them to that company's drop file. SPA shells that render empty without JS produce zero rows — that is success, not a reason to launch a headless browser.

## Access method

`urllib` GET with `DomainMapImporter/0.1` UA. Check `/robots.txt` first. Minimum 2s between requests. No login, cookies, CAPTCHA solving, stealth, or fingerprint evasion.

## Authorization / robots

- Only hosts already listed as `careerUrl` on curated companies.
- Missing robots.txt → allow. Matching `Disallow` → skip that URL.
- Blocked regardless of robots: referral paths and URLs carrying a `token` or
  `share_token`; these are attributed share links, not stable public career pages.
- Blocked regardless of robots: `zhipin.com`, `nowcoder.com`, `xiaohongshu.com`, `shixiseng.com`, `51job.com`, `zhaopin.com`, `liepin.com`, `lagou.com`, `docs.qq.com`.

### Verified robots parser behavior

The importer’s local parser follows the RFC 9309 group-selection behavior covered by `crawler/tests/test_acquisition.py` and the fixtures in `crawler/tests/fixtures/robots/`:

- It combines rules from every group matching the same most-specific product token. A matching named UA group takes precedence over all `User-agent: *` groups; when no named group matches, rules from every wildcard group are combined.
- After group selection, the longest matching path rule wins. If `Allow` and `Disallow` rules have the same longest path, `Allow` wins. A path with no matching rule, including a bare `Disallow:`, is allowed.

## Rate / retention / kill switch

- Default interval 2s; `--limit` for first runs.
- Extracted positions carry `retrievedAt` and `applySource: official`.
- Kill switch: run without `--write`, or delete appended `web-*` external ids.

## Why this is not a general crawler

Most listed career sites are SPAs (ByteDance / Alibaba / NetEase return almost no job HTML). We do not add Playwright or a third-party scrape API to “make them work.” Those need a per-ATS public JSON review later.
