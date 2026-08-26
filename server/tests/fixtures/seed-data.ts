// 测试 fixture + 归档副本：旧 seed 示例数据（2026-08-26 起运行时不再引用）。
// 数据源：tech/backup/seed-data/*.json（唯一归档地）。JSON.stringify 导出会丢弃
// `undefined` 字段，测试读取属性时视为 undefined，与旧对象语义一致。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DomainPOI, RecruitmentPOI } from '../../src/lib/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(join(here, rel), 'utf8')) as unknown;

export const DOMAIN_SEED = readJson('../../../tech/backup/seed-data/domain-seed.json') as DomainPOI[];
export const WORK_SEED = readJson('../../../tech/backup/seed-data/work-seed.json') as RecruitmentPOI[];
/** 旧运行时别名：INTERNSHIP_SEED === WORK_SEED（保留供测试断言）。 */
export const INTERNSHIP_SEED = WORK_SEED;
