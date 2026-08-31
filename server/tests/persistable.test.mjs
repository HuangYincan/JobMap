import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPersistableMode,
  isPersistablePoi,
  isPersistableSavedSnapshot,
  PERSISTABLE_MODES,
} from '../src/lib/persistable.ts';
import { suggestionToDomainPoi } from '../src/lib/amap-api.ts';

test('work and internship are persistable; domain and reserved school modes are not', () => {
  assert.equal(isPersistableMode('work'), true);
  assert.equal(isPersistableMode('internship'), true);
  assert.equal(isPersistableMode('domain'), false);
  assert.equal(isPersistableMode('college'), false);
  assert.equal(isPersistableMode('overseas'), false);
  assert.equal(isPersistableMode(null), false);
  assert.ok(PERSISTABLE_MODES.has('work'));
  assert.equal(PERSISTABLE_MODES.has('college'), false);
});

test('only recruitment catalog POIs persist', () => {
  assert.equal(
    isPersistablePoi({ mode: 'work', kind: 'recruitment', source: 'seed' }),
    true,
  );
  assert.equal(
    isPersistablePoi({ mode: 'work', kind: 'recruitment', source: 'api' }),
    true,
  );
  assert.equal(
    isPersistablePoi({ mode: 'work', kind: 'recruitment', source: 'amap' }),
    false,
  );
  assert.equal(
    isPersistablePoi({ mode: 'domain', kind: 'domain', source: 'amap' }),
    false,
  );
  assert.equal(
    isPersistablePoi({ mode: 'college', kind: 'recruitment', source: 'seed' }),
    false,
  );
  assert.equal(isPersistablePoi(null), false);
});

test('saved snapshots require persistable mode and recruitment kind', () => {
  assert.equal(isPersistableSavedSnapshot({ mode: 'work', kind: 'recruitment' }), true);
  assert.equal(isPersistableSavedSnapshot({ mode: 'domain', kind: 'domain' }), false);
  assert.equal(isPersistableSavedSnapshot({ mode: 'work', kind: 'domain' }), false);
});

test('suggestionToDomainPoi builds a session AMap card and skips incomplete tips', () => {
  const poi = suggestionToDomainPoi({
    id: 'B000A8UIN8',
    name: '西湖',
    location: { lng: 120.15, lat: 30.25 },
    type: '风景名胜;公园',
    address: '杭州市西湖区',
  });
  assert.ok(poi);
  assert.equal(poi.kind, 'domain');
  assert.equal(poi.source, 'amap');
  assert.equal(poi.id, 'B000A8UIN8');
  assert.equal(poi.category, '风景名胜');
  assert.equal(isPersistablePoi(poi), false);
  assert.equal(suggestionToDomainPoi({ name: '无坐标' }), null);
});
