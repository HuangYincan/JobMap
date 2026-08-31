import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultApplicationStatuses } from '../src/lib/application-pipeline.ts';
import {
  parseApplicationCsv,
  parseAppliedAt,
  serializeApplicationCsv,
  serializeApplicationCsvTemplate,
  isHttpApplyUrl,
  APPLICATION_CSV_IMPORT_MAX,
} from '../src/lib/application-csv.ts';
import { assignApplicationIds, manualPositionId } from '../src/lib/application-ids.ts';
import { parseApplicationWrite } from '../src/lib/application-write.ts';

test('parseApplicationCsv reads zh and en headers and skips bad rows', () => {
  const zh = parseApplicationCsv(
    '\uFEFF公司,岗位,阶段,投递链接,投递时间\n字节跳动,前端开发工程师,已投递,https://jobs.bytedance.com/example,2026-08-31\n,缺岗位,已投递,,\n阿里巴巴,Java,面试中,,2026-08-20\n',
  );
  assert.equal(zh.rows.length, 2);
  assert.equal(zh.skipped.length, 1);
  assert.equal(zh.skipped[0].reason, 'missing_fields');
  assert.equal(zh.rows[0].companyName, '字节跳动');
  assert.equal(zh.rows[0].title, '前端开发工程师');
  assert.equal(zh.rows[0].status, '已投递');
  assert.equal(zh.rows[0].applyUrl, 'https://jobs.bytedance.com/example');
  assert.equal(zh.rows[1].companyName, '阿里巴巴');
  assert.equal(zh.rows[1].applyUrl, undefined);

  const dup = parseApplicationCsv('公司,岗位,阶段\n字节,前端,已投递\n字节,前端,面试中\n');
  assert.equal(dup.rows.length, 1);
  assert.equal(dup.rows[0].status, '面试中');

  const en = parseApplicationCsv(
    'company,title,status,apply_url,applied_at\nByteDance,Frontend,applied,not-a-url,2026-08-31\n',
  );
  assert.equal(en.rows.length, 1);
  assert.equal(en.rows[0].applyUrl, undefined);
  assert.equal(en.rows[0].status, 'applied');
});

test('parseApplicationCsv keeps quoted commas and caps import size', () => {
  const quoted = parseApplicationCsv('公司,岗位\n"字节,跳动",前端\n');
  assert.equal(quoted.rows[0].companyName, '字节,跳动');
  const lines = ['公司,岗位', ...Array.from({ length: APPLICATION_CSV_IMPORT_MAX + 2 }, (_, i) => `公司${i},岗位${i}`)];
  const capped = parseApplicationCsv(lines.join('\n'));
  assert.equal(capped.rows.length, APPLICATION_CSV_IMPORT_MAX);
  assert.equal(capped.skipped.length, 2);
  assert.ok(capped.skipped.every((item) => item.reason === 'too_many'));
});

test('serializeApplicationCsv round-trips headers and dates', () => {
  const csv = serializeApplicationCsv(
    [{
      id: '1',
      positionId: 'p',
      companyPoiId: 'c',
      title: '前端',
      companyName: '字节跳动',
      applyUrl: 'https://jobs.bytedance.com/example',
      status: 'applied',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    }],
    { statuses: defaultApplicationStatuses(), lang: 'zh' },
  );
  assert.ok(csv.startsWith('\uFEFF'));
  const parsed = parseApplicationCsv(csv);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].companyName, '字节跳动');
  assert.equal(parsed.rows[0].title, '前端');
  assert.equal(parsed.rows[0].status, '已投递');
  assert.match(serializeApplicationCsvTemplate('zh'), /字节跳动/);
  assert.match(serializeApplicationCsvTemplate('en'), /ByteDance/);
});

test('parseAppliedAt and http url guards', () => {
  assert.equal(parseAppliedAt('2026-08-31')?.slice(0, 10), '2026-08-31');
  assert.equal(parseAppliedAt('nope'), undefined);
  assert.equal(parseAppliedAt('2099-01-01'), undefined);
  assert.equal(isHttpApplyUrl('https://example.com/a'), true);
  assert.equal(isHttpApplyUrl('javascript:alert(1)'), false);
});

test('manual application ids are stable for the same company and title', () => {
  assert.equal(manualPositionId('字节跳动', '前端'), manualPositionId(' 字节跳动 ', '前端'));
  assert.equal(manualPositionId('ByteDance', 'FE'), manualPositionId('bytedance', 'fe'));
  const ids = assignApplicationIds({ title: '前端', companyName: '字节跳动' });
  assert.match(ids.positionId, /^manual:[0-9a-f]{24}$/);
  assert.match(ids.companyPoiId, /^manual:co:[0-9a-f]{24}$/);
  const catalog = assignApplicationIds({
    positionId: 'radar-1',
    companyPoiId: 'co-1',
    title: '前端',
    companyName: '字节跳动',
  });
  assert.equal(catalog.positionId, 'radar-1');
  assert.equal(catalog.companyPoiId, 'co-1');
});

test('parseApplicationWrite generates ids and rejects bad URLs unless omitted', () => {
  const catalog = defaultApplicationStatuses();
  const manual = parseApplicationWrite({ title: '前端', companyName: '字节' }, catalog);
  assert.equal(manual.ok, true);
  if (manual.ok) {
    assert.match(manual.value.positionId, /^manual:/);
    assert.equal(manual.value.status, 'applied');
  }
  const bad = parseApplicationWrite(
    { title: '前端', companyName: '字节', applyUrl: 'ftp://x' },
    catalog,
    { invalidUrl: 'reject' },
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'INVALID_APPLY_URL');
  const omitted = parseApplicationWrite(
    { title: '前端', companyName: '字节', applyUrl: 'ftp://x', status: '面试中' },
    catalog,
    { invalidUrl: 'omit' },
  );
  assert.equal(omitted.ok, true);
  if (omitted.ok) {
    assert.equal(omitted.value.applyUrl, undefined);
    assert.equal(omitted.value.status, 'interview');
  }
});
