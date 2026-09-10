# Recruitment drops (public stubs)

JSON source data is **not** in this public repository. Clone the private
[`HuangYincan/JobMap-data`](https://github.com/HuangYincan/JobMap-data) checkout
as a sibling of JobMap, or set `JOBMAP_DATA_DIR` to that directory.

```text
../JobMap/            # this public repo
../JobMap-data/       # private drops (recruitment/radar, official-career, …)
```

Adapters resolve `recruitment/` in this order: `JOBMAP_DATA_DIR` → sibling
`JobMap-data` → these in-repo folders (README-only on public clones).

Do not commit `*.json` drops here. See each subdirectory README for the
adapter contract; optional sources (`boss`, `nowcoder`, `shixiseng`) stay
no-ops until JSON is supplied in the private checkout.
