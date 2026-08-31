# Domain Map production packaging

This directory is the production packaging for the Next.js application at
`jobmap.nvc.ac`. The current application release is built with Node 22 and
runs as one Docker replica on loopback `127.0.0.1:3002`.

## Files

- `domain-map.Dockerfile`: Next.js build/runtime image. `NEXT_PUBLIC_*` map
  values are build arguments because Next.js inlines them into the browser.
- `migrate.Dockerfile`: PostGIS-based migration image with `psql` and `shasum`.
- `compose.prod.yml`: private PostGIS network plus the app and one-shot
  migration profile. It does not publish a database port.
- `domain-map.service`: systemd wrapper for the Compose app and database.
- `domain-map-backup.{service,timer,sh}`: daily custom-format `pg_dump` with
  seven-day retention.

## Host-only files

Create these files on the VPS; they must not be copied into a release or Git:

- `/etc/domain-map/compose.env` — `DOMAIN_MAP_RELEASE_TAG` plus the public
  `NEXT_PUBLIC_*` build values.
- `/etc/domain-map/db.env` — `POSTGRES_USER`, `POSTGRES_PASSWORD`,
  `POSTGRES_DB`, and the internal `DATABASE_URL`.
- `/etc/domain-map/app.env` — `NODE_ENV`, `SESSION_SECRET`, Agent/LLM values,
  optional map REST keys, OAuth, email, and SMS values.

Make all three root-owned with mode `0600`. The database password must be
random and different from the development `postgres/postgres` defaults.
`SESSION_SECRET` must be random and at least 32 characters; preserve it across
releases or existing sessions become invalid.

The exact browser map variable is
`NEXT_PUBLIC_AMAP_SECURITY_CODE`, not `SECURITY_CODE`. Restrict browser map
keys to `jobmap.nvc.ac` in the relevant provider console.

## Release operations

Run these from `/opt/domain-map/current` after transferring an immutable
release directory and setting `DOMAIN_MAP_RELEASE_TAG`:

```bash
docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml config --quiet

docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml build app migrate

docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml up -d db

docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml run --rm migrate

docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml run --rm migrate \
  bash -lc 'db/scripts/preflight.sh'

docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml run --rm app npm run import:seed
# Review that the plan reports zero issues and zero dropped rows first.
docker compose --project-name domain-map-prod \
  --env-file /etc/domain-map/compose.env \
  --file deploy/compose.prod.yml run --rm app npm run import:seed:apply
systemctl enable --now domain-map.service
systemctl enable --now domain-map-backup.timer
```

Do not run `docker compose down -v` on the production project. There are no
reverse migrations; schema recovery requires a verified dump in a separate
volume/database. Keep the prior release and image tag for application rollback.

## Cloudflare

The existing system-level tunnel remains the only public ingress. Add this
rule before its terminal 404 rule, then validate and restart the existing
`cloudflared.service`:

```yaml
- hostname: jobmap.nvc.ac
  service: http://127.0.0.1:3002
```

Do not add Caddy, bind port 443, or run a second cloudflared process. Preserve
the existing `nvc.ac`, `www.nvc.ac`, `api.nvc.ac`, `docs-agent.nvc.ac`, and
`umami.nvc.ac` routes.

## Known limits

The Agent is in-process at `/api/agent/chat` and needs either the complete
`AGENT_LLM_*` trio or the fallback `LLM_*` trio. It is not a durable worker.
Public cache/rate-limit state and navigation artifacts are process-local, so
run one app replica. Crawler imports and job-alert delivery remain manual or
queue-only; they are not silently represented as background workers.
