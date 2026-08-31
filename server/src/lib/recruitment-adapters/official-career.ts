// Official-career adapter: drop curated JSON next to the seed.
// One file = one company (or an array). No crawl. Empty dir → [].

import {
  defaultDropDir,
  fileDropAdapter,
  listSourceCompanyFiles,
  parseSourceCompanyPayload,
} from './file-drop.ts';
import type { RecruitmentAdapter, SourceCompany } from '../recruitment-source.ts';

export const OFFICIAL_CAREER_DIR = process.env.OFFICIAL_CAREER_DIR || defaultDropDir('official-career');

export const parseOfficialCareerPayload = parseSourceCompanyPayload;
export const listOfficialCareerFiles = (dir = OFFICIAL_CAREER_DIR): Promise<SourceCompany[]> =>
  listSourceCompanyFiles(dir);

export function officialCareerAdapter(dir = OFFICIAL_CAREER_DIR): RecruitmentAdapter {
  return fileDropAdapter('official-career', dir);
}

export const fileOfficialCareerAdapter = officialCareerAdapter();
