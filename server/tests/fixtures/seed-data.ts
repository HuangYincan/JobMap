// Frozen test catalog (copied from the old in-repo seed). Runtime Work reads are
// DB-only and do not load these files.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DomainPOI, RecruitmentPOI } from '../../src/lib/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(join(here, rel), 'utf8')) as unknown;

export const DOMAIN_SEED = readJson('./domain-seed.json') as DomainPOI[];
export const WORK_SEED = readJson('./work-seed.json') as RecruitmentPOI[];
/** 旧运行时别名：INTERNSHIP_SEED === WORK_SEED（保留供测试断言）。 */
export const INTERNSHIP_SEED = WORK_SEED;
