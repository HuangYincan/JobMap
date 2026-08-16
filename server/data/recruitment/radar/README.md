# Radar drops

Mapped from the published [xiaozhao-radar](https://github.com/jiabaobei/xiaozhao-radar) `jobs.json` (Apache-2.0). Snapshot 2026-08-11, 1404 rows.

- URL: `https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json`
- SHA-256: `db4a537978be3b3134df1cbfb907804e918a3a5384c89c153bdc817ae5907b0d`
- Mapper: `crawler/app/domain_map_importer/radar_jobs.py` (parser v1.3.0), run with `hangzhou_only` — 98 companies / 125 jobs.
- Regenerate: `make refresh-radar` (downloads + remaps + **self-validates**: crawler tests + import-plan dry-run must stay clean).

Trust level is **lower than `official-career/`**: sites carry city text, not coordinates. Matched slugs merge onto existing curated pins; new companies stay off the offline map until geocoded (`npm run geocode:sites`).
