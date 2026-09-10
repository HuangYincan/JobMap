# Radar drops

Mapped JSON lives in the private JobMap-data repository (`recruitment/radar/`).
This public folder is README-only.

Source: published [xiaozhao-radar](https://github.com/jiabaobei/xiaozhao-radar) `jobs.json` (Apache-2.0).

- URL: `https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json`
- Mapper: `crawler/app/domain_map_importer/radar_jobs.py`
- Regenerate into the private checkout: `make refresh-radar` (needs `JOBMAP_DATA_DIR` or a sibling `JobMap-data` clone). Record the snapshot SHA-256 in the private radar README.

Trust level is **lower than `official-career/`**: sites carry city text, not coordinates. Override with `RADAR_DIR` or `JOBMAP_DATA_DIR`.
