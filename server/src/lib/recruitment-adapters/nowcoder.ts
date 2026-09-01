// Nowcoder file-drop adapter. Curated JSON only — no live crawl.
// Empty / missing dir → [] for the legacy list() contract; listDetailed() marks
// those inputs incomplete. Override with NOWCODER_DIR.

import { defaultDropDir, fileDropAdapter } from './file-drop.ts';
import type { RecruitmentAdapter } from '../recruitment-source.ts';

export const NOWCODER_DIR = process.env.NOWCODER_DIR || defaultDropDir('nowcoder');

export function nowcoderAdapter(dir = NOWCODER_DIR): RecruitmentAdapter {
  return fileDropAdapter('nowcoder', dir);
}

export const fileNowcoderAdapter = nowcoderAdapter();
