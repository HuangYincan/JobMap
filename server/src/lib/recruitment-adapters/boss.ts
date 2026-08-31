// Boss file-drop adapter. Curated JSON only — no live crawl.
// Empty / missing dir → []. Override with BOSS_DIR.

import { defaultDropDir, fileDropAdapter } from './file-drop.ts';
import type { RecruitmentAdapter } from '../recruitment-source.ts';

export const BOSS_DIR = process.env.BOSS_DIR || defaultDropDir('boss');

export function bossAdapter(dir = BOSS_DIR): RecruitmentAdapter {
  return fileDropAdapter('boss', dir);
}

export const fileBossAdapter = bossAdapter();
