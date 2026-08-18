# Phase 1 Source Review Register

> **Status:** candidate-only; no acquisition authorization granted.

| Source | Review status | Acquisition allowed? | Required evidence |
|---|---|---|---|
| `xiaozhao-radar` `jobs.json` | Reviewed 2026-08-17 | Published GitHub file only | `tech/roles/data/etl/xiaozhao-radar.md` |
| Official career HTML (`careerUrl`) | Reviewed 2026-08-17 | Polite GET + robots | `tech/roles/data/etl/official-career.md` |
| Hangzhou POI CSV (offline export) | Reviewed 2026-08-17 | **Authorized by owner for import** (demo: Hangzhou) | `tech/roles/data/etl/hangzhou-poi.md`; table `hz_pois` (migration 013) |
| Moka ATS career pages (mokahr.com) | Candidate | No live acquisition yet | Per-org public JSON discovery, terms/robots review (`etl/moka-ats.md` when started) |
| Feishu jobs ATS (`*.jobs.feishu.cn`) | Reviewed 2026-08-19 | Adapter implemented; polite GET JSON API + robots | `tech/roles/data/etl/feishu-ats.md` (live shape validation pending pilot) |
| Hotjob (wecruit / hr.sensetime.com) | Candidate 2026-08-19 | Not yet — API endpoint needs live probe | `tech/roles/data/etl/hotjob-ats.md` |
| Zhiye (Beisen italent `*.zhiye.com`) | Candidate 2026-08-19 | Not yet — API endpoint needs live probe | `tech/roles/data/etl/zhiye-ats.md` |
| BOSS Direct Hire | Not approved | No | Written authorization and separate security/legal review |
| Nowcoder / Shixiseng | Not approved | No | Same as BOSS — commercial ToS, login walls |
| Xiaohongshu | Not approved | No | Written authorization and separate security/legal review |

Phase 1 only accepts synthetic/local fixtures. This register must be updated with evidence before any source-specific adapter is enabled.
