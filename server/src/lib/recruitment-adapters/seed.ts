// Seed adapter：先精选数据，后接官网 / Boss 等源。

import { poiToSourceCompany, type RecruitmentAdapter } from '../recruitment-source.ts';
import { WORK_SEED } from '../seed-data.ts';

export const seedRecruitmentAdapter: RecruitmentAdapter = {
  kind: 'seed',
  async list() {
    return WORK_SEED.map(poiToSourceCompany);
  },
};
