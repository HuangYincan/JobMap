// Shixiseng file-drop adapter. Curated JSON only — no live crawl.
// Empty / missing dir → [] for the legacy list() contract; listDetailed() marks
// those inputs incomplete. Override with SHIXISENG_DIR.

import { defaultDropDir, fileDropAdapter } from './file-drop.ts';
import type { RecruitmentAdapter } from '../recruitment-source.ts';

export const SHIXISENG_DIR = process.env.SHIXISENG_DIR || defaultDropDir('shixiseng');

export function shixisengAdapter(dir = SHIXISENG_DIR): RecruitmentAdapter {
  return fileDropAdapter('shixiseng', dir, { optionalNoop: true });
}

export const fileShixisengAdapter = shixisengAdapter();
