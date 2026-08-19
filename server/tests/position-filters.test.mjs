// position-filters.ts 单元测试 — 公司详情岗位列表的局部筛选逻辑
// 运行:cd server && node --test tests/position-filters.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_POSITION_FILTERS,
  filterPositions,
  hasActivePositionFilters,
  positionFamily,
  positionMatchesQuery,
} from '../src/lib/position-filters.ts';

function pos(overrides = {}) {
  return {
    id: 'p1',
    title: '后端开发工程师',
    type: 'social',
    status: 'open',
    ...overrides,
  };
}

// 10 种标题按职能分桶:i%10 决定职能, i%3 决定类型(实习/校招/社招)
const TITLE_PATTERNS = [
  '后端开发工程师', // 0 tech
  '产品经理', // 1 product
  '新媒体运营', // 2 ops
  '视觉设计师', // 3 design
  '算法工程师', // 4 tech
  '前端开发工程师', // 5 tech
  '社区运营', // 6 ops
  'UI设计师', // 7 design
  '测试开发工程师', // 8 tech
  '数据产品经理', // 9 product
];
const FAMILIES = ['social', 'campus', 'intern'];

/** 得物式大列表:669 个在招岗位(10 种标题 × 3 类岗位类型交错) */
function buildBigList() {
  const positions = [];
  for (let i = 0; i < 669; i++) {
    positions.push(
      pos({
        id: `p${i}`,
        title: TITLE_PATTERNS[i % TITLE_PATTERNS.length],
        type: FAMILIES[i % FAMILIES.length],
        department: '电商事业部',
      }),
    );
  }
  return positions;
}

test('filterPositions: 空筛选原样返回全部(不重排不改数量)', () => {
  const list = buildBigList();
  const out = filterPositions(list, EMPTY_POSITION_FILTERS);
  assert.equal(out.length, 669);
  assert.deepEqual(out.map((p) => p.id), list.map((p) => p.id));
});

test('hasActivePositionFilters: 全空 / 纯空白查询视为无筛选', () => {
  assert.equal(hasActivePositionFilters(EMPTY_POSITION_FILTERS), false);
  assert.equal(hasActivePositionFilters({ roles: [], families: [], query: '   ' }), false);
  assert.equal(hasActivePositionFilters({ roles: ['tech'], families: [], query: '' }), true);
  assert.equal(hasActivePositionFilters({ roles: [], families: ['intern'], query: '' }), true);
  assert.equal(hasActivePositionFilters({ roles: [], families: [], query: '算法' }), true);
});

test('positionMatchesQuery: 大小写不敏感 substring, 空输入不过滤', () => {
  assert.equal(positionMatchesQuery(pos({ title: 'Backend Engineer', department: 'Tech' }), 'backend'), true);
  assert.equal(positionMatchesQuery(pos({ title: 'Backend Engineer' }), 'ENGINEER'), true);
  assert.equal(positionMatchesQuery(pos({ title: '产品经理', department: '智慧零售事业部' }), '零售'), true);
  assert.equal(positionMatchesQuery(pos({ title: '产品经理' }), '后端'), false);
  assert.equal(positionMatchesQuery(pos({ title: '产品经理' }), ''), true);
  assert.equal(positionMatchesQuery(pos({ title: '产品经理' }), '   '), true);
});

test('positionFamily: taxonomy.family 优先, 缺省回退 type', () => {
  assert.equal(positionFamily(pos()), 'social');
  assert.equal(positionFamily(pos({ taxonomy: { family: 'intern' } })), 'intern');
  assert.equal(positionFamily(pos({ type: 'campus', taxonomy: { family: 'social' } })), 'social');
});

test('filterPositions: 职能组内 OR(669 列表, 268 技术)', () => {
  const list = buildBigList();
  const tech = filterPositions(list, { roles: ['tech'], families: [], query: '' });
  assert.equal(tech.length, 268);
  const techOps = filterPositions(list, { roles: ['tech', 'ops'], families: [], query: '' });
  assert.equal(techOps.length, 268 + 134);
});

test('filterPositions: 类型组内 OR, taxonomy 缺失回退 type(669 列表每类 223)', () => {
  const list = buildBigList();
  const social = filterPositions(list, { roles: [], families: ['social'], query: '' });
  assert.equal(social.length, 223);
  const socialCampus = filterPositions(list, { roles: [], families: ['social', 'campus'], query: '' });
  assert.equal(socialCampus.length, 446);
});

test('filterPositions: 职能 ∩ 类型 ∩ 关键词 AND 组合', () => {
  const list = buildBigList();
  const techSocial = filterPositions(list, { roles: ['tech'], families: ['social'], query: '' });
  assert.equal(techSocial.length, 89);
  const techSocialAlgo = filterPositions(list, {
    roles: ['tech'],
    families: ['social'],
    query: '算法',
  });
  assert.equal(techSocialAlgo.length, 22);
  // 不可能组合 → 空结果(空态场景)
  const none = filterPositions(list, { roles: ['design'], families: ['intern'], query: '后端' });
  assert.equal(none.length, 0);
});

test('filterPositions: 关键词可单独命中部门字段', () => {
  const list = [pos({ id: 'a', title: '产品经理', department: '智慧零售事业部' })];
  const out = filterPositions(list, { roles: [], families: [], query: '零售' });
  assert.deepEqual(out.map((p) => p.id), ['a']);
});
