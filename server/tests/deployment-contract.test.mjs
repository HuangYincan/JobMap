import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

test('production workflow publishes only after successful main CI', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no/);
  assert.doesNotMatch(workflow, /docker compose down -v/);
  assert.doesNotMatch(workflow, /git pull/);
});

test('production Compose requires immutable GHCR images and never publishes Postgres', () => {
  const compose = read('deploy/compose.prod.yml');
  assert.match(compose, /DOMAIN_MAP_APP_IMAGE/);
  assert.match(compose, /DOMAIN_MAP_MIGRATE_IMAGE/);
  assert.doesNotMatch(compose, /build:/);
  assert.doesNotMatch(compose, /5432:/);
  assert.match(compose, /api\/health\/ready/);
});

test('VPS wrapper validates digests and protects the database volume', () => {
  const wrapper = read('deploy/domain-map-deploy.sh');
  assert.match(wrapper, /sha256:\[0-9a-f\]\{64\}/);
  assert.match(wrapper, /domain-map-deploy\.lock/);
  const backup = read('deploy/domain-map-backup.sh');
  assert.match(wrapper, /domain-map-backup\.sh/);
  assert.match(backup, /pg_dump/);
  assert.match(wrapper, /migrate >/);
  assert.match(read('deploy/migrate.Dockerfile'), /db\/scripts\/preflight\.sh/);
  assert.match(wrapper, /schema was not rolled back/);
  assert.doesNotMatch(wrapper, /docker compose down -v/);
  assert.doesNotMatch(wrapper, /DROP DATABASE/);
});
