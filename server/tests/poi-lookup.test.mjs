import test from 'node:test';
import assert from 'node:assert/strict';
import { findPoiByCatalogOrPositionId } from '../src/lib/poi-lookup.ts';

function company(id, positions) {
  return {
    id,
    kind: 'recruitment',
    name: id,
    mode: 'work',
    source: 'api',
    location: { lng: 113.95, lat: 22.56 },
    company: { name: id, industries: [], scale: 'startup', tier: 3 },
    positions,
  };
}

test('findPoiByCatalogOrPositionId: 公司 id 命中', () => {
  const poi = company('anker:sz', [{ id: 'portal-feishu-1', title: '全栈', type: 'social', status: 'open' }]);
  const hit = findPoiByCatalogOrPositionId('anker:sz', [poi]);
  assert.equal(hit?.poi.id, 'anker:sz');
  assert.equal(hit?.position, undefined);
});

test('findPoiByCatalogOrPositionId: 岗位 id 回落到所属公司', () => {
  const poi = company('anker:sz', [{ id: 'portal-feishu-1', title: '全栈', type: 'social', status: 'open' }]);
  const hit = findPoiByCatalogOrPositionId('portal-feishu-1', [], [poi]);
  assert.equal(hit?.poi.id, 'anker:sz');
  assert.equal(hit?.position?.title, '全栈');
});

test('findPoiByCatalogOrPositionId: 空/未命中', () => {
  assert.equal(findPoiByCatalogOrPositionId('  ', [company('x', [])]), undefined);
  assert.equal(findPoiByCatalogOrPositionId('missing', [company('anker:sz', [])]), undefined);
});
