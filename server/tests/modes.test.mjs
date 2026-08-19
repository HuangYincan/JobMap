// MODES 死代码回归防护（quality-scan #8/#9）：
// - MODES 不再登记 internship 条目（internship → work 由 canonicalMode 保证）
// - api.ts 不再导出 fetchPOIs / fetchModes 死函数
import test from 'node:test';
import assert from 'node:assert/strict';

import * as api from '../src/lib/api.ts';
import {
  ACTIVE_MODES,
  ALL_MODES,
  MODES,
  canonicalMode,
  getMode,
} from '../src/lib/modes.ts';

test('MODES: 无 internship 条目,其余条目与顺序保持', () => {
  assert.equal('internship' in MODES, false, 'MODES.internship 已删除');
  assert.deepEqual(Object.keys(MODES), ['domain', 'work', 'college', 'overseas']);
});

test('canonicalMode: internship → work,其余原样', () => {
  assert.equal(canonicalMode('internship'), 'work');
  assert.equal(canonicalMode('work'), 'work');
  assert.equal(canonicalMode('domain'), 'domain');
  assert.equal(canonicalMode('college'), 'college');
  assert.equal(canonicalMode('overseas'), 'overseas');
});

test('getMode: internship 落到 work 配置(不读 MODES.internship)', () => {
  assert.equal(getMode('internship').id, 'work');
  assert.deepEqual(getMode('internship'), getMode('work'));
});

test('ACTIVE_MODES / ALL_MODES: 不含 internship,索引 MODES 恒有效', () => {
  for (const id of [...ACTIVE_MODES, ...ALL_MODES]) {
    assert.ok(id in MODES, `${id} 应在 MODES 中`);
    assert.equal(MODES[id].id, id);
  }
  assert.ok(!ACTIVE_MODES.includes('internship'));
  assert.ok(!ALL_MODES.includes('internship'));
});

test('api.ts: fetchPOIs / fetchModes 死导出已删除,存活导出仍在', () => {
  assert.equal(typeof api.fetchPOIs, 'undefined', 'fetchPOIs 已删');
  assert.equal(typeof api.fetchModes, 'undefined', 'fetchModes 已删');
  assert.equal(typeof api.fetchPOIDetail, 'function');
  assert.equal(typeof api.fetchSearchSuggest, 'function');
});
