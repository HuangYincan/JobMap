import type { ApplicationStatusDef } from './application-pipeline.ts';
import { resolveWatchStatus } from './application-pipeline.ts';
import {
  APPLICATION_APPLY_URL_MAX,
  APPLICATION_COMPANY_NAME_MAX,
  APPLICATION_ID_MAX,
  APPLICATION_TITLE_MAX,
  isHttpApplyUrl,
  parseAppliedAt,
} from './application-csv.ts';
import { assignApplicationIds } from './application-ids.ts';
import type { Language } from './i18n.ts';

export type ApplicationWriteBody = {
  positionId?: string;
  companyPoiId?: string;
  title?: string;
  companyName?: string;
  applyUrl?: string;
  status?: string;
  appliedAt?: string;
};

export type ApplicationWriteValue = {
  positionId: string;
  companyPoiId: string;
  title: string;
  companyName: string;
  applyUrl?: string;
  status: string;
  createdAt?: string;
};

export function parseApplicationWrite(
  body: ApplicationWriteBody,
  catalog: ApplicationStatusDef[],
  options: { lang?: Language; invalidUrl?: 'reject' | 'omit' } = {},
): { ok: true; value: ApplicationWriteValue } | { ok: false; code: string; message: string } {
  if (body.positionId !== undefined && typeof body.positionId !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'positionId must be a string' };
  }
  if (body.companyPoiId !== undefined && typeof body.companyPoiId !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'companyPoiId must be a string' };
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'title must be a string' };
  }
  if (body.companyName !== undefined && typeof body.companyName !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'companyName must be a string' };
  }
  if (body.applyUrl !== undefined && typeof body.applyUrl !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'applyUrl must be a string' };
  }
  if (body.status !== undefined && typeof body.status !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'status must be a string' };
  }
  if (body.appliedAt !== undefined && typeof body.appliedAt !== 'string') {
    return { ok: false, code: 'BAD_REQUEST', message: 'appliedAt must be a string' };
  }
  const title = (body.title || '').trim();
  const companyName = (body.companyName || '').trim();
  if (!title || !companyName) {
    return { ok: false, code: 'BAD_REQUEST', message: 'title and company required' };
  }
  const positionId = (body.positionId || '').trim();
  const companyPoiId = (body.companyPoiId || '').trim();
  if (
    title.length > APPLICATION_TITLE_MAX
    || companyName.length > APPLICATION_COMPANY_NAME_MAX
    || positionId.length > APPLICATION_ID_MAX
    || companyPoiId.length > APPLICATION_ID_MAX
  ) {
    return {
      ok: false,
      code: 'APPLICATION_FIELD_TOO_LONG',
      message: 'one or more application fields exceed their length limit',
    };
  }
  let applyUrl = (body.applyUrl || '').trim();
  if (applyUrl) {
    if (applyUrl.length > APPLICATION_APPLY_URL_MAX || !isHttpApplyUrl(applyUrl)) {
      if (options.invalidUrl === 'omit') applyUrl = '';
      else {
        return {
          ok: false,
          code: 'INVALID_APPLY_URL',
          message: 'applyUrl must be an http(s) URL of at most 2048 chars',
        };
      }
    }
  }
  const ids = assignApplicationIds({ positionId, companyPoiId, title, companyName });
  const createdAt = body.appliedAt ? parseAppliedAt(String(body.appliedAt)) : undefined;
  return {
    ok: true,
    value: {
      ...ids,
      title,
      companyName,
      applyUrl: applyUrl || undefined,
      status: resolveWatchStatus(body.status, catalog, options.lang),
      createdAt,
    },
  };
}
