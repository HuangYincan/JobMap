// Radar file-drop adapter: published xiaozhao-radar snapshot mapped to SourceCompany.
// Lower trust than official-career: sites carry city text, not coordinates.
// Empty / missing dir → []. Override with RADAR_DIR.

import { defaultDropDir, fileDropAdapter } from './file-drop.ts';
import type { RecruitmentAdapter } from '../recruitment-source.ts';

export const RADAR_DIR = process.env.RADAR_DIR || defaultDropDir('radar');

export function radarAdapter(dir = RADAR_DIR): RecruitmentAdapter {
  return fileDropAdapter('radar', dir);
}

export const fileRadarAdapter = radarAdapter();
