#!/usr/bin/env node
// Plan the seed recruitment import. Pass --apply to upsert when DATABASE_URL is set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRecruitmentImport, planSeedImport } from '../src/lib/recruitment-import.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

// --- env (server/.env.local, without printing the key) ---------------------
function loadEnv() {
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

const apply = process.argv.includes('--apply');
const plan = await planSeedImport();
const sites = plan.companies.reduce((n, c) => n + c.sites.length, 0);
const positions = plan.companies.reduce((n, c) => n + c.positions.length, 0);
const result = apply ? await applyRecruitmentImport(plan) : null;
console.log(
  JSON.stringify(
    {
      companies: plan.companies.length,
      sites,
      positions,
      dropped: plan.dropped,
      complete: plan.complete !== false,
      diagnostics: plan.diagnostics ?? [],
      issues: plan.issues,
      apply: result,
    },
    null,
    2,
  ),
);
if (plan.dropped > 0) process.exitCode = 1;
