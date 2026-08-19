# CLI: map a radar snapshot, or politely fetch official career HTML.

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .acquire import AcquisitionError, PoliteFetcher
from .ats_feishu import CITY_PINYIN, AdapterError, city_site_id, fetch_all_jobs, job_city, jobs_to_positions
from .official_refresh import refresh_company_from_source, write_company
from .radar_jobs import load_radar_jobs, radar_fixture


# 已实测解锁的 feishu ATS 租户(2026-08-19):
# website_path = 该租户「校园招聘」站点 id(带该头取校招池,缺省取社招池)。
FEISHU_TENANTS: list[dict] = [
    {
        "host": "poizon.jobs.feishu.cn",
        "website_path": "578078",
        "slug": "得物",
        "name": "得物",
        "industries": ["internet", "ecommerce"],
        "scale": "unicorn",
        "tier": 7,
        "category": "64",
        "careerUrl": "https://poizon.jobs.feishu.cn/s/f4Izn_GufWs",
        "radarBase": "得物",
    },
    {
        "host": "agirobot.jobs.feishu.cn",
        "website_path": "946993",
        "slug": "智元机器人",
        "name": "智元机器人",
        "industries": ["ai", "robotics"],
        "scale": "unicorn",
        "tier": 7,
        "category": "39",
        "careerUrl": "https://agirobot.jobs.feishu.cn/946993/",
        "radarBase": "智元机器人",
    },
    {
        "host": "kwh0jtf778.jobs.feishu.cn",
        "website_path": "073183",
        "slug": "禾赛科技",
        "name": "禾赛科技",
        "industries": ["ai", "hardware"],
        "scale": "unicorn",
        "tier": 7,
        "category": "39",
        "careerUrl": "https://kwh0jtf778.jobs.feishu.cn/073183/m/",
        "radarBase": "禾赛科技",
    },
]


def cmd_feishu(args: argparse.Namespace) -> int:
    """Crawl feishu ATS tenants → real official-career drops (portal-* positions).

    Preserves the radar drop's curated sites (id/address/coords), adds sites for
    cities found in jobs but missing from the base, and maps every job to its
    city site. Crawls the campus pool (website_path header) + the default
    social pool, deduped by job id.
    """
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    radar_dir = Path(args.radar_dir)
    fetcher = PoliteFetcher(min_interval_s=args.interval)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary = []
    for tenant in args.tenants:
        host = tenant["host"]
        slug = tenant["slug"]
        base = None
        if radar_dir and (radar_dir / f"{tenant.get('radarBase', slug)}.json").exists():
            base = json.loads((radar_dir / f"{tenant.get('radarBase', slug)}.json").read_text(encoding="utf-8"))
        company = {
            "slug": slug,
            "name": tenant["name"],
            "industries": tenant["industries"],
            "scale": tenant["scale"],
            "tier": tenant.get("tier", 7),
            "category": tenant.get("category", "64"),
            "careerUrl": tenant["careerUrl"],
            "sites": (base or {}).get("sites", []),
            "positions": [],
        }
        pools = [("campus", tenant.get("website_path", "")), ("social", "")]
        all_jobs: list[dict] = []
        pool_counts: dict[str, int] = {}
        api_errors: list[dict] = []
        for label, website_path in pools:
            try:
                jobs, errors = fetch_all_jobs(fetcher, host, website_path=website_path, max_jobs=args.max_jobs)
            except AdapterError as exc:
                errors = [{"pool": label, "error": str(exc)}]
                jobs = []
            api_errors.extend(errors)
            pool_counts[label] = len(jobs)
            seen = {j["id"] for j in all_jobs}
            all_jobs.extend(j for j in jobs if j["id"] not in seen)
        # 为岗位城市补齐站点(保留 base 的 curated 站点)。
        known = {s["id"] for s in company["sites"]}
        for job in all_jobs:
            city = job_city(job)
            if not city:
                continue
            site_id = city_site_id(slug, city)
            if site_id in known:
                continue
            # 已知中国城市补「市」(与 radar 约定一致);海外/未知名城市用原名。
            city_name = f"{city}市" if city in CITY_PINYIN else city
            company["sites"].append({
                "id": site_id,
                "name": company["name"],
                "city": city_name,
                "location": {"address": city_name},
            })
            known.add(site_id)
        company["positions"] = jobs_to_positions(all_jobs, company, stamp, host=host, website_path=tenant.get("website_path", ""))
        entry = {"slug": slug, "jobs": len(all_jobs), "campus": pool_counts.get("campus", 0), "social": pool_counts.get("social", 0), "sites": len(company["sites"])}
        if api_errors:
            entry["api_errors"] = api_errors
        if args.write:
            (out_dir / f"{slug}.json").write_text(json.dumps(company, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            entry["wrote"] = True
        summary.append(entry)
    print(json.dumps({"companies": len(summary), "results": summary}, ensure_ascii=False))
    return 0


def cmd_radar(args: argparse.Namespace) -> int:
    payload = load_radar_jobs(args.input)
    cities = tuple(c.strip() for c in args.cities.split(",") if c.strip()) or None
    fixture = radar_fixture(payload, target_cities=cities)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "_radar-fixture.json").write_text(json.dumps(fixture["source"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    written = 0
    aggregate = 0
    for company in fixture["companies"]:
        path = out_dir / f"{company['slug']}.json"
        path.write_text(json.dumps(company, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written += 1
        aggregate += sum(1 for pos in company["positions"] if pos.get("aggregate"))
    print(json.dumps({"companies": written, "records": len(fixture["records"]), "aggregate": aggregate, "out": str(out_dir)}, ensure_ascii=False))
    return 0


def cmd_official(args: argparse.Namespace) -> int:
    folder = Path(args.dir)
    files = sorted(p for p in folder.glob("*.json") if p.name != "_radar-fixture.json")
    if args.limit:
        files = files[: args.limit]
    fetcher = PoliteFetcher(min_interval_s=args.interval)
    summary = []
    progress = Path(args.progress) if args.progress else None
    for index, path in enumerate(files):
        company = json.loads(path.read_text(encoding="utf-8"))
        url = company.get("careerUrl")
        if not url:
            summary.append({"slug": company.get("slug"), "skipped": "no-careerUrl"})
        else:
            try:
                result = fetcher.fetch(url)
            except AcquisitionError as exc:
                summary.append({"slug": company.get("slug"), "skipped": str(exc)})
            else:
                if result.blocked_by:
                    summary.append({"slug": company.get("slug"), "skipped": result.blocked_by})
                elif result.status >= 400:
                    summary.append({"slug": company.get("slug"), "status": result.status})
                else:
                    refreshed, meta = refresh_company_from_source(company, fetcher, result.body, url, retrieved_at=result.fetched_at)
                    added = len(refreshed.get("positions", [])) - len(company.get("positions", []))
                    if args.write and added > 0:
                        write_company(path, refreshed)
                    entry = {"slug": company.get("slug"), "status": result.status, "added": max(added, 0), "wrote": bool(args.write and added > 0), "source": meta.get("source")}
                    if meta.get("api_errors"):
                        entry["api_errors"] = meta["api_errors"]
                    summary.append(entry)
        if progress is not None and (index + 1) % 5 == 0:
            _write_progress(progress, files, summary)
    if progress is not None:
        _write_progress(progress, files, summary)
    print(json.dumps({"pages": len(summary), "results": summary}, ensure_ascii=False))
    return 0


def _write_progress(progress: Path, files: list[Path], summary: list[dict]) -> None:
    progress.write_text(json.dumps({"done": len(summary), "total": len(files), "results": summary}, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="domain-map-importer")
    sub = parser.add_subparsers(dest="cmd", required=True)

    radar = sub.add_parser("radar", help="Map a published xiaozhao-radar jobs.json onto SourceCompany files")
    radar.add_argument("--input", required=True, help="Path to jobs.json")
    radar.add_argument("--out-dir", required=True, help="Directory for mapped JSON")
    radar.add_argument("--cities", default="", help="Target cities, comma-separated (default: 北京,上海,广州,深圳,成都,武汉,杭州)")
    radar.set_defaults(func=cmd_radar)

    official = sub.add_parser("official", help="Politely GET official careerUrl HTML and extract jobs")
    official.add_argument("--dir", required=True, help="official-career JSON directory")
    official.add_argument("--limit", type=int, default=0, help="Max companies (0 = all)")
    official.add_argument("--interval", type=float, default=2.0, help="Seconds between requests")
    official.add_argument("--write", action="store_true", help="Write extra positions back into the JSON files")
    official.add_argument("--progress", default="", help="Incremental JSON progress path (resilient to interruption)")
    official.set_defaults(func=cmd_official)

    feishu = sub.add_parser("feishu", help="Crawl feishu ATS tenants (real job posts API) into official-career drops")
    feishu.add_argument("--out-dir", required=True, help="official-career JSON directory")
    feishu.add_argument("--radar-dir", default="", help="radar JSON directory (inherits curated sites/addresses)")
    feishu.add_argument("--interval", type=float, default=2.0, help="Seconds between requests")
    feishu.add_argument("--max-jobs", type=int, default=2000, help="Safety cap per tenant per pool")
    feishu.add_argument("--write", action="store_true", help="Write drops (dry-run default)")
    feishu.set_defaults(func=cmd_feishu, tenants=FEISHU_TENANTS)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
