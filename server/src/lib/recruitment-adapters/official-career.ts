// Official-career adapter: drop curated JSON next to the seed.
// One file = one company (or an array). No crawl. The legacy list() returns []
// for an absent/empty dir, while listDetailed() marks that input incomplete.

import {
  defaultDropDir,
  fileDropAdapter,
  listSourceCompanyFiles,
  listSourceCompanyFilesDetailed,
  parseSourceCompanyPayload,
} from './file-drop.ts';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';

export const OFFICIAL_CAREER_DIR = process.env.OFFICIAL_CAREER_DIR || defaultDropDir('official-career');

export const parseOfficialCareerPayload = parseSourceCompanyPayload;
export const listOfficialCareerFiles = (dir = OFFICIAL_CAREER_DIR): Promise<SourceCompany[]> =>
  listSourceCompanyFiles(dir, undefined, { sourceCode: 'official-career' });
export const listOfficialCareerFilesDetailed = (dir = OFFICIAL_CAREER_DIR) =>
  listSourceCompanyFilesDetailed(dir, undefined, { sourceCode: 'official-career' });

export function officialCareerAdapter(dir = OFFICIAL_CAREER_DIR): RecruitmentAdapter {
  return fileDropAdapter('official-career', dir);
}

export const fileOfficialCareerAdapter = officialCareerAdapter();
