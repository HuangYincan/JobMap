# CLI: map a radar snapshot, or politely fetch official career HTML.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .acquire import AcquisitionError, PoliteFetcher
from .official_refresh import refresh_company_from_html, write_company
from .radar_jobs import load_radar_jobs, radar_fixture


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
                    refreshed = refresh_company_from_html(company, result.body, url, retrieved_at=result.fetched_at)
                    added = len(refreshed.get("positions", [])) - len(company.get("positions", []))
                    if args.write and added > 0:
                        write_company(path, refreshed)
                    summary.append({"slug": company.get("slug"), "status": result.status, "added": max(added, 0), "wrote": bool(args.write and added > 0)})
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

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
