// ============================================================
// 岗位提醒匹配（纯函数）
//
// Profile 里的通知开关只决定「拟发」渠道。本阶段写入账户收件箱，
// 不调用阿里云短信 / 邮件供应商。status=queued 表示记下了渠道。
// ============================================================

import type { CareerPreferences, CareerStrength, NotificationPreferences } from './account.ts';
import { isRecruitmentPOI, type POI, type Position } from './types.ts';

export type AlertChannel = 'email' | 'sms' | 'inbox';

export interface JobAlertMatch {
  positionId: string;
  companyPoiId: string;
  title: string;
  companyName: string;
  applyUrl?: string;
  kind: 'job';
  channels: AlertChannel[];
}

const STRENGTH_HINTS: Record<CareerStrength, string[]> = {
  algorithm: ['算法', 'algorithm', '机器学习', 'ml'],
  frontend: ['前端', 'frontend', 'react', 'vue', 'css'],
  backend: ['后端', 'backend', 'java', 'go', 'server'],
  product: ['产品', 'product', 'pm'],
  design: ['设计', 'design', 'ui', 'ux'],
  data: ['数据', 'data', '分析', 'sql'],
};

export function intendedJobChannels(prefs: NotificationPreferences): AlertChannel[] {
  const channels: AlertChannel[] = ['inbox'];
  if (prefs.emailJobs) channels.push('email');
  if (prefs.smsJobs) channels.push('sms');
  return channels;
}

export function jobChannelsEnabled(prefs: NotificationPreferences): boolean {
  return prefs.emailJobs || prefs.smsJobs;
}

function positionFamily(position: Position): string {
  return position.taxonomy?.family ?? position.type;
}

function haystack(position: Position, industries: string[]): string {
  return [
    position.title,
    position.department ?? '',
    ...(position.skills ?? []),
    ...(position.majors ?? []),
    ...industries,
  ]
    .join(' ')
    .toLowerCase();
}

export function positionMatchesCareer(position: Position, industries: string[], career: CareerPreferences): boolean {
  if (career.status === 'not-looking') return false;
  if (!career.families.includes(positionFamily(position) as CareerPreferences['families'][number])) {
    return false;
  }
  if (career.industries.length && !career.industries.some((id) => industries.includes(id))) {
    return false;
  }
  if (!career.strengths.length) return true;
  const text = haystack(position, industries);
  return career.strengths.some((strength) => STRENGTH_HINTS[strength].some((hint) => text.includes(hint)));
}

export function matchJobAlerts(
  pois: POI[],
  career: CareerPreferences,
  notifications: NotificationPreferences,
): JobAlertMatch[] {
  if (!jobChannelsEnabled(notifications)) return [];
  const channels = intendedJobChannels(notifications);
  const matches: JobAlertMatch[] = [];

  for (const poi of pois) {
    if (!isRecruitmentPOI(poi)) continue;
    for (const position of poi.positions) {
      if (position.status !== 'open') continue;
      if (!positionMatchesCareer(position, poi.company.industries, career)) continue;
      matches.push({
        positionId: position.id,
        companyPoiId: poi.id,
        title: position.title,
        companyName: poi.company.name,
        applyUrl: position.apply?.url ?? poi.company.careerUrl,
        kind: 'job',
        channels,
      });
    }
  }

  return matches;
}
