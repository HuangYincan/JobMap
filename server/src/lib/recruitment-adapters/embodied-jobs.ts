// Embodied-AI jobs file-drop adapter: published GitHub snapshot
// (Octoday-Hub/Embodied-AI topics/02-jobs.md — 社区维护的具身智能岗位聚合列表,
// 2026-08-21 快照 538 机会) mapped to SourceCompany.
// Drops are already SourceCompany-shaped (WS-1 generates them); lower trust
// than official-career: sites carry city text, not coordinates.
// Empty / missing dir → []. Override with EMBODIED_JOBS_DIR.

import { defaultDropDir, fileDropAdapter } from './file-drop.ts';
import type { RecruitmentAdapter } from '../recruitment-source.ts';

export const EMBODIED_JOBS_DIR = process.env.EMBODIED_JOBS_DIR || defaultDropDir('embodied-jobs');

export function embodiedJobsAdapter(dir = EMBODIED_JOBS_DIR): RecruitmentAdapter {
  return fileDropAdapter('embodied-jobs', dir);
}

export const fileEmbodiedJobsAdapter = embodiedJobsAdapter();
