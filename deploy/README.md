# Domain Map production deployment

This directory contains the versioned production packaging for the Next.js
application at `https://jobmap.nvc.ac`. The application, API, and in-process
Agent run as one Node 22 Docker replica. PostGIS is a separate container on a
private Docker network; the existing system Cloudflare Tunnel remains the only
public ingress.

## Release flow

A protected `main` promotion is the production release boundary:

```text
main push
  -> CI workflow succeeds
  -> Production deploy workflow builds linux/amd64 images
  -> images are pushed to GHCR and resolved to immutable digests
  -> GitHub-hosted runner uploads this non-secret packaging over SSH
  -> restricted VPS wrapper pulls, backs up, migrates, and health-checks
  -> public modes + Work API smoke checks pass
```

A push to `dev` or a pull request never deploys. `workflow_dispatch` is kept
for the first rollout, a retry, and an explicitly selected commit that is
already an ancestor of `main`. The workflow uses `concurrency: production`, so
an in-progress production rollout is never cancelled by a newer commit.

The workflow does **not** run `git pull` on the VPS. It transfers only the
Compose file and backup script needed by the host, while the application and
migration images are built in GitHub Actions:

- `ghcr.io/huangyincan/jobmap-app:<commit-sha>`
- `ghcr.io/huangyincan/jobmap-migrate:<commit-sha>`

The host ultimately stores full `@sha256:...` references in
`/etc/domain-map/compose.env`. `latest` is not used.

## Files

- `domain-map.Dockerfile`: Node 22 multi-stage app image. Browser-visible
  `NEXT_PUBLIC_*` values are build arguments; server secrets are not copied.
- `migrate.Dockerfile`: PostGIS-based one-shot migration image with `psql` and
  `shasum`; it runs both `db/scripts/apply.sh` and `db/scripts/preflight.sh`.
- `compose.prod.yml`: PostGIS, app, and migration services. It does not
  publish a database port and uses immutable image variables.
- `domain-map-deploy.sh`: root-owned host wrapper with only `apply`, `rollback`,
  and `status` operations.
- `install-domain-map-deploy.sh`: one-time VPS provisioning helper for the
  dedicated SSH user, wrapper, systemd units, and incoming release directory.
- `domain-map.service`: systemd supervision for the Compose database/app.
- `domain-map-backup.{service,timer,sh}`: daily custom-format `pg_dump` with
  seven-day retention.
- `.github/workflows/deploy-production.yml`: GHCR build and SSH deployment.

## One-time VPS setup

Use the existing administrative access only for this provisioning step. Do
not put the private key in the repository or in a release bundle.

1. Generate a dedicated SSH key pair locally. Put the public key in a
   temporary root-only file.
2. Copy this directory to a temporary VPS directory without copying any
   `.env` file or runtime secret.
3. On the VPS, as root, run:

   ```bash
   bash deploy/install-domain-map-deploy.sh /path/to/domainmap-deploy.pub
   ```

   The helper installs the wrapper as `/usr/local/sbin/domain-map-deploy`,
   installs the backup/systemd files, creates `domainmap-deploy`, gives it no
   Docker group membership, and grants only passwordless sudo for the wrapper.
4. Create `/etc/domain-map/registry.env` as root with mode `0600` if the GHCR
   packages remain private:

   ```text
   GHCR_USERNAME=<read-only-package-user>
   GHCR_TOKEN=<read-only-package-token>
   ```

   The token needs package read access only. The wrapper consumes it through
   stdin to `docker login`; it is never a command-line argument or log line.
5. Verify that the GitHub Actions runner's `VPS_KNOWN_HOSTS` value contains the
   complete, pinned host-key line(s) for the SSH endpoint. Do not use
   `StrictHostKeyChecking=no`.

The host directories are created as follows:

```text
/opt/domain-map/current       -> /opt/domain-map/releases/<commit-sha>
/opt/domain-map/previous      -> previous application release
/opt/domain-map/incoming/     writable only by domainmap-deploy
/opt/domain-map/releases/     root-owned release metadata and packaging
```

The existing database volume and the other VPS services are not removed or
recreated. The app remains bound to `127.0.0.1:3002`; PostgreSQL remains
unpublished on the host.

## GitHub production environment

Create a protected GitHub Environment named `production`. Configure required
reviewers if desired, then add these **Secrets**:

```text
VPS_HOST
VPS_PORT
VPS_USER                 # domainmap-deploy, not root
VPS_SSH_KEY              # dedicated private key
VPS_KNOWN_HOSTS          # pinned known_hosts lines
NEXT_PUBLIC_AMAP_KEY
NEXT_PUBLIC_AMAP_SECURITY_CODE
NEXT_PUBLIC_TENCENT_JSAPI_KEY
NEXT_PUBLIC_BAIDU_AK
```

The four `NEXT_PUBLIC_*` values are browser-visible build configuration. They
may instead be stored as Environment Variables; the workflow accepts either
`vars.NAME` or `secrets.NAME`. Do not add `DATABASE_URL`, `SESSION_SECRET`,
LLM keys, OAuth secrets, mail credentials, or the GHCR pull token to GitHub.

Runtime-only values stay on the VPS, root-owned with mode `0600`:

- `/etc/domain-map/db.env`: Postgres credentials and internal `DATABASE_URL`.
- `/etc/domain-map/app.env`: `NODE_ENV`, stable `SESSION_SECRET`, Agent/LLM,
  server-side map, OAuth, mail/SMS values, and
  `PUBLIC_ORIGIN=https://jobmap.nvc.ac`.
- `/etc/domain-map/compose.env`: current release SHA and full GHCR image
  digests.
- `/etc/domain-map/registry.env`: optional read-only GHCR credentials.

## Automatic apply and rollback

The host wrapper serializes operations with `/run/lock/domain-map-deploy.lock`
and accepts only lowercase 40-character commit SHAs and approved GHCR
`sha256` digests. An apply performs these steps:

1. Validate host-only configuration and the incoming non-secret packaging.
2. Copy the Compose/backup files into a root-owned release directory.
3. Log in to GHCR and pull both exact image digests.
4. Start/verify the existing PostGIS container.
5. Create a non-empty custom-format dump and its SHA-256 sidecar before any
   migration.
6. Run the migration image, which applies pending migrations and runs the
   checksum preflight.
7. Atomically switch `current` and `compose.env`, then recreate only the app
   with `docker compose up -d --no-build app`.
8. Poll `/api/health/ready`, `/api/modes`, and a DB-backed Work request.

If image pull, migration, or preflight fails, the existing app selection and
volume are retained. If the new app fails its health gate after a successful
migration, the wrapper restores the previous application release/image. It
reports that the database schema was **not** rolled back. Migrations are
forward-only; schema recovery requires a verified dump restored into a
separate database or volume. Never run `docker compose down -v` and never
execute guessed reverse SQL.

For an intentional application rollback on the VPS:

```bash
sudo /usr/local/sbin/domain-map-deploy rollback
# or select a retained release explicitly:
sudo /usr/local/sbin/domain-map-deploy rollback <40-character-commit-sha>
```

This changes the application image only. It does not reverse database schema.
`status` prints the current/previous release and Compose service status without
printing environment values:

```bash
sudo /usr/local/sbin/domain-map-deploy status
```

## Backups and maintenance

The backup timer runs daily and keeps seven days of custom-format dumps under
`/srv/domain-map/backups`. The backup script shares a lock with pre-release
backups and writes a SHA-256 sidecar. Periodically verify a dump by restoring
it into an isolated temporary database; never test restoration over the live
volume.

Seed import and geocoding remain deliberate maintenance operations. A normal
application release does not run `npm run import:seed:apply`, and no crawler or
job-alert worker is implied by this deployment. The Agent remains an in-process
SSE route at `/api/agent/chat`.

## Cloudflare and existing services

The existing system-level Cloudflare Tunnel remains unchanged. Keep this rule
before its terminal 404 rule:

```yaml
- hostname: jobmap.nvc.ac
  service: http://127.0.0.1:3002
```

Do not add Caddy, bind public port 443, run a second `cloudflared`, or modify
routes for `nvc.ac`, `www.nvc.ac`, `api.nvc.ac`, `docs-agent.nvc.ac`, or
`umami.nvc.ac`. The deployment workflow does not edit Cloudflare configuration.
