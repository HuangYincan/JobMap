// 手动 / CSV 投递行的稳定 id。同一用户「公司+岗位」归一后哈希相同 → UNIQUE(user_id, position_id) 幂等。
import { createHash } from 'node:crypto';
import { MANUAL_APPLICATION_PREFIX, normalizeApplicationKey } from './application-csv.ts';

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function manualPositionId(companyName: string, title: string): string {
  return `${MANUAL_APPLICATION_PREFIX}${shortHash(`${normalizeApplicationKey(companyName)}\0${normalizeApplicationKey(title)}`)}`;
}

export function manualCompanyPoiId(companyName: string): string {
  return `${MANUAL_APPLICATION_PREFIX}co:${shortHash(normalizeApplicationKey(companyName))}`;
}

export function assignApplicationIds(input: {
  positionId?: string;
  companyPoiId?: string;
  title: string;
  companyName: string;
}): { positionId: string; companyPoiId: string } {
  const positionId = (input.positionId || '').trim();
  const companyPoiId = (input.companyPoiId || '').trim();
  if (positionId && companyPoiId) return { positionId, companyPoiId };
  return {
    positionId: positionId || manualPositionId(input.companyName, input.title),
    companyPoiId: companyPoiId || manualCompanyPoiId(input.companyName),
  };
}
