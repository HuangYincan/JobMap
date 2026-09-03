# Shixiseng file drops

Curated JSON only; no live crawl and no login/CAPTCHA bypass. Same `SourceCompany` shape as `official-career/`. The directory is optional: missing, empty, or README-only input is reported as a diagnostic no-op and never reconciles old `shixiseng` rows. If JSON is supplied, it is a snapshot: malformed/unreadable/invalid input blocks the all-source apply, while a valid `[]` is an authoritative zero-row snapshot. Source-less nested rows inherit `shixiseng`; this optional source is registered as non-authentic and is not shown as a public Work position until its source policy changes.

Do not put secrets here. Override with `SHIXISENG_DIR`.
