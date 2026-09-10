// Resolve the private recruitment drop root.
// JSON drops live in HuangYincan/JobMap-data, not in the public JobMap tree.
// Never log .env.local or JOBMAP_DATA_DIR.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(SERVER_DIR, '..');

function readJobMapDataDirFromEnvFile(): string | undefined {
  const envFile = join(SERVER_DIR, '.env.local');
  try {
    if (!existsSync(envFile)) return undefined;
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = line.match(/^JOBMAP_DATA_DIR=(.*)$/);
      if (!match) continue;
      const value = match[1].replace(/^['"]|['"]$/g, '').trim();
      if (value) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function directoryHasJsonDrops(dir: string): boolean {
  try {
    if (existsSync(join(dir, 'geocode-overrides.json'))) return true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('.')) {
        return true;
      }
      if (!entry.isDirectory()) continue;
      try {
        const names = readdirSync(join(dir, entry.name));
        if (names.some((name) => name.endsWith('.json') && !name.startsWith('.'))) return true;
      } catch {
        // unreadable subdir
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** Directory that contains `recruitment/` (JobMap-data root or `server/data`). */
export function jobMapDataDir(): string {
  const fromEnv = process.env.JOBMAP_DATA_DIR?.trim() || readJobMapDataDirFromEnvFile();
  if (fromEnv) return resolve(fromEnv);

  const inRepo = join(SERVER_DIR, 'data');
  const sibling = join(REPO_ROOT, '..', 'JobMap-data');
  if (directoryHasJsonDrops(join(sibling, 'recruitment'))) return sibling;
  if (directoryHasJsonDrops(join(inRepo, 'recruitment'))) return inRepo;
  if (existsSync(join(sibling, 'recruitment'))) return sibling;
  return inRepo;
}

export function recruitmentDataRoot(): string {
  return join(jobMapDataDir(), 'recruitment');
}

export function defaultDropDir(folder: string): string {
  return join(recruitmentDataRoot(), folder);
}

export function geocodeOverridesPath(): string {
  return join(recruitmentDataRoot(), 'geocode-overrides.json');
}

/** True when mapped JSON drops are present (private checkout or local overlay). */
export function recruitmentCorpusAvailable(): boolean {
  const radar = join(recruitmentDataRoot(), 'radar');
  try {
    return existsSync(radar) && readdirSync(radar).some((name) => name.endsWith('.json') && !name.startsWith('.'));
  } catch {
    return false;
  }
}
