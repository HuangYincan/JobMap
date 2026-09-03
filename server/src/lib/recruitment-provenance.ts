// Recruitment source registry shared by planning, authenticity, and persistence.
// Keep source policy in one place so a new source cannot become "authentic" by
// adding another scattered external-id prefix check.

export type AuthenticityPolicy = 'none' | 'id-prefix' | 'source';

export interface RecruitmentSourceMetadata {
  originUri: string;
  authorizationBasis: string;
  accessMethod: string;
  attribution: string;
  retention: string;
  deletion: string;
  /** How positions from this source become eligible for the live catalog. */
  authenticity: AuthenticityPolicy;
}

export const SOURCE_META: Record<string, RecruitmentSourceMetadata> = {
  seed: {
    // 2026-08-26 起 seed 示例数据已归档 tech/backup/seed-data(不再作为导入源);
    // 此处保留 provenance 供历史行(早期 import:seed 写入的 source_id='seed')追溯。
    originUri: 'local:WORK_SEED (archived 2026-08-26)',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated seed',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'none',
  },
  'official-career': {
    originUri: 'local:server/data/recruitment/official-career/',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated official career pages',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    // This source contains both curated portal rows and historical scaffold
    // rows. Only the explicit portal-* identity is authentic for this source.
    authenticity: 'id-prefix',
  },
  'feishu-ats': {
    originUri: 'https://*.jobs.feishu.cn',
    authorizationBasis: 'public-api',
    accessMethod: 'polite-json-api',
    attribution: 'Feishu ATS public job search API; Domain Map field mapping',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'source',
  },
  'xiaozhao-radar': {
    originUri: 'https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json',
    authorizationBasis: 'apache-2.0',
    accessMethod: 'public-file',
    attribution: 'xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'source',
  },
  // Adapter kind and persisted drop source are normally xiaozhao-radar, but
  // retain this alias for hand-authored plans and future adapter normalization.
  radar: {
    originUri: 'https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json',
    authorizationBasis: 'apache-2.0',
    accessMethod: 'public-file',
    attribution: 'xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'source',
  },
  'qqdoc-official': {
    originUri: 'Tencent Docs public share (27届秋招信息汇总, docs.qq.com)',
    authorizationBasis: 'public-share',
    accessMethod: 'manual-curation',
    attribution: 'Tencent Docs public share curated by user + boss extraction',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'none',
  },
  'qqdoc-jobs': {
    originUri: 'Tencent Docs public share (27届秋招信息汇总, docs.qq.com) + apply-link ATS/official pages',
    authorizationBasis: 'public-share + public-api',
    accessMethod: 'manual-curation + polite-etl',
    attribution: 'Tencent Docs public share curated by user + boss extraction; jobs fetched politely from apply links',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'source',
  },
  boss: {
    originUri: 'local:server/data/recruitment/boss/',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated Boss source drop',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'none',
  },
  nowcoder: {
    originUri: 'local:server/data/recruitment/nowcoder/',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated Nowcoder source drop',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'none',
  },
  shixiseng: {
    originUri: 'local:server/data/recruitment/shixiseng/',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated Shixiseng source drop',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'none',
  },
  'embodied-jobs': {
    originUri: 'https://raw.githubusercontent.com/Octoday-Hub/Embodied-AI/main/topics/02-jobs.md',
    authorizationBasis: 'published-github-file',
    accessMethod: 'public-file',
    attribution: 'Octoday-Hub/Embodied-AI contributors (community-maintained list; no LICENSE file); Domain Map field mapping',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
    authenticity: 'source',
  },
};

export function sourceMetadataFor(source: string | undefined): RecruitmentSourceMetadata {
  return SOURCE_META[source?.trim() || 'seed'] ?? SOURCE_META.seed;
}

export function sourceAuthenticityPolicy(source: string | undefined): AuthenticityPolicy {
  return sourceMetadataFor(source).authenticity;
}
