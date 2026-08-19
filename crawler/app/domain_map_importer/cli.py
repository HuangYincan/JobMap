# CLI: map a radar snapshot, or politely fetch official career HTML.

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from .acquire import AcquisitionError, PoliteFetcher
from .ats_feishu import CITY_PINYIN, AdapterError, city_site_id, fetch_all_jobs, job_addresses, job_city, jobs_to_positions
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
    # ---- 2026-08-19 批量解锁(21 家,沪杭优先)----
    # website_path = careerUrl 数字路径段(如 /581609/ → 581609);短链(/s/…)无
    # token 直接 GET 看重定向,重定向 URL 含数字路径段才取(如 MiniMax /379481/)。
    # 解析不出则留空(只爬默认/社招池);带分享 token 的链接一律不请求。
    {
        "host": "lilithgames.jobs.feishu.cn",
        "slug": "莉莉丝游戏",
        "name": "莉莉丝游戏",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 6,
        "category": "64",
        "careerUrl": "https://lilithgames.jobs.feishu.cn/s/QRsYm_4BJbU",
        "radarBase": "莉莉丝游戏",
    },
    {
        "host": "boke.jobs.feishu.cn",
        "website_path": "581609",
        "slug": "波克",
        "name": "波克",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 8,
        "category": "64",
        "careerUrl": "https://boke.jobs.feishu.cn/581609/?keywords=&category=&location=&project=&type=&job_hot_flag=&current=1&limit=10&functionCategory=&tag=7615065632384928036&sessionid=",
        "radarBase": "波克",
    },
    {
        "host": "arashivision.jobs.feishu.cn",
        "slug": "影石Insta360",
        "name": "影石Insta360",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 7,
        "category": "39",
        "careerUrl": "https://arashivision.jobs.feishu.cn/s/7gvYofWYSzQ",
        "radarBase": "影石Insta360",
    },
    {
        "host": "anker-in.jobs.feishu.cn",
        "slug": "安克创新",
        "name": "安克创新",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 7,
        "category": "39",
        "careerUrl": "https://anker-in.jobs.feishu.cn/s/ME9gNKDOVd0",
        "radarBase": "安克创新",
    },
    {
        "host": "bambulab.jobs.feishu.cn",
        "slug": "拓竹科技",
        "name": "拓竹科技",
        "industries": ["manufacturing"],
        "scale": "enterprise",
        "tier": 8,
        "category": "39",
        "careerUrl": "https://bambulab.jobs.feishu.cn/s/gezHtYuCXKw",
        "radarBase": "拓竹科技",
    },
    {
        "host": "k11pnjpvz1.jobs.feishu.cn",
        "website_path": "352020",
        "slug": "元气森林",
        "name": "元气森林",
        "industries": ["consumer"],
        "scale": "enterprise",
        "tier": 7,
        "category": "15",
        "careerUrl": "https://k11pnjpvz1.jobs.feishu.cn/352020/?sessionid=",
        "radarBase": "元气森林",
    },
    {
        "host": "momenta.jobs.feishu.cn",
        "slug": "Momenta",
        "name": "Momenta",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 7,
        "category": "65",
        "careerUrl": "https://momenta.jobs.feishu.cn/s/KIU_aWZmYqA",
        "radarBase": "Momenta",
    },
    {
        "host": "nio.jobs.feishu.cn",
        "slug": "蔚来",
        "name": "蔚来",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 4,
        "category": "36",
        "careerUrl": "https://nio.jobs.feishu.cn/campus/?keywords=&category=&location=&project=7383991896182343963&type=&job_hot_flag=&current=1&limit=10&functionCategory=&tag=&spread=9W5KU9X",
        "radarBase": "蔚来",
    },
    {
        "host": "xiaopeng.jobs.feishu.cn",
        "website_path": "307999",
        "slug": "小鹏集团",
        "name": "小鹏集团",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 5,
        "category": "36",
        "careerUrl": "https://xiaopeng.jobs.feishu.cn/307999",
        "radarBase": "小鹏集团",
    },
    {
        "host": "vrfi1sk8a0.jobs.feishu.cn",
        "website_path": "379481",
        "slug": "MiniMax",
        "name": "MiniMax",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 5,
        "category": "65",
        "careerUrl": "https://vrfi1sk8a0.jobs.feishu.cn/s/UmWyycpF8kQ",
        "radarBase": "MiniMax",
    },
    {
        "host": "duxiaoman.jobs.feishu.cn",
        "website_path": "051736",
        "slug": "度小满",
        "name": "度小满",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 7,
        "category": "69",
        "careerUrl": "https://duxiaoman.jobs.feishu.cn/051736/position/7649303782597691694/detail",
        "radarBase": "度小满",
    },
    {
        "host": "leadrive.jobs.feishu.cn",
        "website_path": "391532",
        "slug": "臻驱科技",
        "name": "臻驱科技",
        "industries": ["manufacturing"],
        "scale": "enterprise",
        "tier": 9,
        "category": "36",
        "careerUrl": "https://leadrive.jobs.feishu.cn/391532/?spread=AMJWGFQ",
        "radarBase": "臻驱科技",
    },
    {
        "host": "tarsrobot.jobs.feishu.cn",
        "website_path": "021343",
        "slug": "它石智航",
        "name": "它石智航",
        "industries": ["manufacturing"],
        "scale": "enterprise",
        "tier": 9,
        "category": "39",
        "careerUrl": "https://tarsrobot.jobs.feishu.cn/021343/?keywords=&category=&location=&project=7654421147169179950&type=&job_hot_flag=&current=1&limit=10&functionCategory=&tag=&sessionid=",
        "radarBase": "它石智航",
    },
    {
        "host": "gamealestudio.jobs.feishu.cn",
        "website_path": "007955",
        "slug": "游戏精酿",
        "name": "游戏精酿",
        "industries": ["internet"],
        "scale": "enterprise",
        "tier": 12,
        "category": "64",
        "careerUrl": "https://gamealestudio.jobs.feishu.cn/007955?sessionid=",
        "radarBase": "游戏精酿",
    },
    {
        "host": "radrocktech.jobs.feishu.cn",
        "website_path": "531403",
        "slug": "锐石创芯",
        "name": "锐石创芯",
        "industries": ["manufacturing"],
        "scale": "enterprise",
        "tier": 11,
        "category": "39",
        "careerUrl": "https://radrocktech.jobs.feishu.cn/531403/position/list?spread=Q13728Z",
        "radarBase": "锐石创芯",
    },
    {
        "host": "kargobot.jobs.feishu.cn",
        "website_path": "267069",
        "slug": "卡尔动力",
        "name": "卡尔动力",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 8,
        "category": "65",
        "careerUrl": "https://kargobot.jobs.feishu.cn/267069",
        "radarBase": "卡尔动力",
    },
    {
        "host": "lightwheel.jobs.feishu.cn",
        "slug": "光轮智能",
        "name": "光轮智能",
        "industries": ["manufacturing"],
        "scale": "enterprise",
        "tier": 8,
        "category": "65",
        "careerUrl": "https://lightwheel.jobs.feishu.cn/referral/position/share/?token=MjsxNzc4MjIxNzcxMDU1Ozc1Mzk3OTI0MDM5NjQ4NTQyOTE7NzYzNzM5OTM3OTIzNDM0MzE3ODsx",
        "radarBase": "光轮智能",
    },
    {
        "host": "ponyai.jobs.feishu.cn",
        "slug": "小马智行",
        "name": "小马智行",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 7,
        "category": "54",
        "careerUrl": "https://ponyai.jobs.feishu.cn/s/LJKJM4oIZc4",
        "radarBase": "小马智行",
    },
    {
        "host": "qcraft.jobs.feishu.cn",
        "slug": "轻舟智航",
        "name": "轻舟智航",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 8,
        "category": "65",
        "careerUrl": "https://qcraft.jobs.feishu.cn/index/?keywords=%E5%AE%9E%E4%B9%A0&category=&location=&project=&type=&job_hot_flag=&current=1&limit=10&functionCategory=&tag=",
        "radarBase": "轻舟智航",
    },
    {
        "host": "n0kwkp76gi.jobs.feishu.cn",
        "slug": "国科长三角资本",
        "name": "国科长三角资本",
        "industries": ["other"],
        "scale": "enterprise",
        "tier": 9,
        "category": "67",
        "careerUrl": "https://n0kwkp76gi.jobs.feishu.cn/campus/position/list?spread=R17V84A",
        "radarBase": "国科长三角资本",
    },
    {
        "host": "r3c0qt6yjw.jobs.feishu.cn",
        "slug": "新石器",
        "name": "新石器",
        "industries": ["auto"],
        "scale": "enterprise",
        "tier": 8,
        "category": "39",
        "careerUrl": "https://r3c0qt6yjw.jobs.feishu.cn/campus/position/list?keywords=&category=&location=&project=7647438600203880747&type=&job_hot_flag=&current=1&limit=10&functionCategory=&tag=",
        "radarBase": "新石器",
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
    tenants = args.tenants
    if args.only:
        only = set(args.only.split(","))
        tenants = [t for t in tenants if t["slug"] in only or t["host"].split(".")[0] in only]
    for tenant in tenants:
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
        # 翻页漂移兜底: 爬取期间岗位池变化, offset 窗口滑动可能让同一岗位
        # 出现在两页 → 按 id 去重(保留首个), 否则 plan 报 duplicate externalId
        # (2026-08-19: 蔚来 2223 岗池实测出现)。
        all_jobs = list({j["id"]: j for j in all_jobs}.values())
        # 为岗位城市补齐站点(保留 base 的 curated 站点)。
        # ATS address_list 提供精确办公地址(区+路+门牌)→ 城市文本站点用它
        # 填充 address,geocode 时走 geocoding v3(5000 次/天)落到具体办公楼。
        address_by_city: dict[str, str] = {}
        for job in all_jobs:
            for entry in job_addresses(job):
                if entry["city"]:
                    address_by_city[entry["city"]] = entry["address"]
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
            ats_address = address_by_city.get(city, "")
            company["sites"].append({
                "id": site_id,
                "name": company["name"],
                "city": city_name,
                "location": {"address": ats_address or city_name},
            })
            known.add(site_id)
        # 城市文本的既有站点(无坐标)也用 ATS 地址补精确办公地;多城市文本
        # ("北京/上海/广州/杭州")与已有具体地址的站点不动。
        for site in company["sites"]:
            if site.get("location", {}).get("lng"):
                continue  # curated 站点(已有坐标)不动
            site_city = site.get("city", "").removesuffix("市")
            current_addr = (site.get("location") or {}).get("address", "").strip()
            if not site_city:
                continue
            ats_address = address_by_city.get(site_city, "")
            if not ats_address:
                continue
            if current_addr in ("", site_city, f"{site_city}市"):
                site.setdefault("location", {})["address"] = ats_address
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
    feishu.add_argument("--only", default="", help="Comma-separated slugs/hosts to crawl (default: all)")
    feishu.add_argument("--write", action="store_true", help="Write drops (dry-run default)")
    feishu.set_defaults(func=cmd_feishu, tenants=FEISHU_TENANTS)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
