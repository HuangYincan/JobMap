# xiaozhao-radar jobs.json

> **Status:** reviewed for snapshot import; live fetch of the GitHub file is allowed. Their crawl stack is not adopted.
> **Reviewed:** 2026-08-17
> **Owner:** product / data

## Purpose

Map the published Apache-2.0 `jobs.json` snapshot into Domain Map `SourceCompany` JSON so Hangzhou-relevant campus / intern rows can join the official-career drop directory.

## Fields used

`c` company, `p` title, `l` location, `ind`/`t` industry, `d` deadline, `u` apply URL, `w` batch. We derive `slug`, `family`, and a stable `radar-{sha1}` external id.

## Access method

HTTPS GET of the **published file**:
`https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json`

Do **not** call Tencent Docs `opendoc`, Firecrawl, AnySearch, BrowserAct stealth-extract, OpenCLI login, or their `proxy.js`.

## Authorization / license / ToS

- License: Apache-2.0 ([xiaozhao-radar LICENSE](https://github.com/jiabaobei/xiaozhao-radar/blob/main/LICENSE)).
- Attribution: `xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping`.
- We reimplement the field map; we do not copy their Python/JS acquisition code.

## robots / rate / retention

- GitHub raw is a public file; no HTML crawl of their SPA is required.
- Keep one snapshot on disk if fetched; do not schedule tighter than weekly.
- PII: none expected (company / role / public apply URL).
- Retention: public catalog until replaced. Kill switch: delete mapped JSON + stop the `radar` CLI.

## Quality

- Drop rows whose apply URL host is a blocked aggregator (Boss / 牛客 / 小红书 / 实习僧 / 51job…).
- Default `hangzhou_only=true` so the map catalog stays Hangzhou-first.
- Mapped fixture must pass `validate_local_fixture`.
