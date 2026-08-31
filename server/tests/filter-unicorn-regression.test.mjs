import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearModeCache, readModeCache, syncModeCache, writeModeCache } from '../src/lib/mode-cache.ts';
import { planExploreSearch } from '../src/lib/search.ts';

// ============================================================
// 2026-08-22 ws1「筛选莫名勾选独角兽」回归(jsdom 可测层:
// 本仓库无 jsdom 运行时,沿用「源码契约 + 语义镜像」模式)
//
// 主因(缓存残留):load 写缓存用闭包 filters 快照,取消勾选(非 category
// 筛选变更)不重载 → 缓存残留 scale:['unicorn'],F5/重开复活。
// 次因(切模式闭包):handlePickRecent → openExploreSearch 同栈调用时闭包
// 还是旧模式 filters,标签合并把旧模式筛选带进新模式。
// ============================================================

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function installMemoryStorage() {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

const recruitmentPoi = {
  id: 'c1',
  kind: 'recruitment',
  name: '阿里巴巴',
  mode: 'work',
  source: 'seed',
  location: { lng: 120.02, lat: 30.28 },
  company: { name: '阿里巴巴', industries: [], scale: 'bigtech' },
  positions: [],
};

const viewport = {
  center: { lng: 120.15, lat: 30.27 },
  zoom: 13,
  bounds: { west: 119.9, south: 30.1, east: 120.4, north: 30.45 },
};

function workEntry(filters) {
  return {
    mode: 'work',
    catalog: [recruitmentPoi],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters,
    sort: 'distance',
  };
}

// ---- 主因:缓存残留(load 后取消勾选 → F5/重开不复活)----

test('主因:取消勾选后缓存不再残留 unicorn(load 写入 → setFilters 取消 → 重写 → 还原不含 unicorn)', () => {
  installMemoryStorage();
  // 1. 某次 load 时 filters 含 unicorn(如点 #独角兽 建议,query 清空触发 load),
  //    连同过滤后 catalog 写进缓存(旧行为:闭包快照)
  writeModeCache({ ...workEntry({ scale: ['unicorn'] }), viewport });
  assert.deepEqual(readModeCache('work').filters, { scale: ['unicorn'] });

  // 2. 用户面板取消勾选独角兽 → setFilters({}) 无重载 → syncModeCache 以
  //    「写缓存时刻的最新 filters + 当前池」重写
  syncModeCache({ ...workEntry({}), viewport });

  // 3. F5/重开还原路径(useModeCacheRestore 读缓存 → setFilters(cached.filters)):
  //    缓存不再含 unicorn → 面板不复活
  const cached = readModeCache('work');
  assert.ok(cached);
  assert.deepEqual(cached.filters, {});
  assert.equal('scale' in cached.filters, false, 'restore 不再带 scale:["unicorn"]');
  assert.deepEqual(JSON.parse(JSON.stringify(cached.filters)), {});
});

test('主因:连续多次取消勾选,缓存始终跟随最新 filters', () => {
  installMemoryStorage();
  writeModeCache({ ...workEntry({ scale: ['unicorn'], industry: ['ai'] }), viewport });
  syncModeCache({ ...workEntry({ industry: ['ai'] }), viewport });
  syncModeCache({ ...workEntry({}), viewport });
  assert.deepEqual(readModeCache('work').filters, {});
});

test('主因:地图未就绪(无视野快照)时 syncModeCache 跳过,不覆盖现有缓存/快照', () => {
  installMemoryStorage();
  writeModeCache({ ...workEntry({ scale: ['unicorn'] }), viewport });
  syncModeCache({ ...workEntry({}), viewport: null });
  // viewport 为 null → 不写:旧缓存(含旧 filters 与快照)保持原样
  const cached = readModeCache('work');
  assert.deepEqual(cached.filters, { scale: ['unicorn'] });
  assert.deepEqual(cached.viewport, viewport);
});

test('主因:写缓存时刻的最新 filters 语义(load 在飞时用户改筛选,写缓存不得用闭包旧快照)', () => {
  installMemoryStorage();
  // load 启动时刻闭包 filters = unicorn,但写缓存时刻用户已取消(viewStateRef 最新)
  writeModeCache({ ...workEntry({ scale: ['unicorn'] }), viewport });
  syncModeCache({ ...workEntry({}), viewport });
  const cached = readModeCache('work');
  assert.deepEqual(cached.filters, {});
  assert.equal('scale' in cached.filters, false);
});

// ---- 次因:切模式后点历史条目,merge 用切换后 filters(旧模式 scale 不进新模式)----

test('次因:切到新模式(无筛选)后点历史 #独角兽 → 只应用独角兽,不带旧模式筛选', () => {
  // 旧模式(work)闭包 filters 含 scale:['unicorn']+industry:['ai'];
  // 切到 domain 后 handleModeChange 已把 viewStateRef 同步为 domain 状态(无筛选)
  const target = planExploreSearch({ query: '', filters: {} }, '#独角兽');
  assert.deepEqual(target, { query: '', filters: { scale: ['unicorn'] } });
  // 断言:结果里没有旧模式的其他筛选泄漏
  assert.equal('industry' in target.filters, false);
  assert.deepEqual(Object.keys(target.filters), ['scale']);
});

test('次因:新模式已有自己的筛选,标签合并进新模式基准(不覆盖)', () => {
  const target = planExploreSearch({ query: '', filters: { industry: ['ai'] } }, '#独角兽');
  assert.deepEqual(target.filters, { scale: ['unicorn'], industry: ['ai'] });
});

test('次因:纯关键词(非标签)只换 query,filters 不动', () => {
  const target = planExploreSearch({ query: '阿里', filters: { scale: ['unicorn'] } }, '算法');
  assert.deepEqual(target, { query: '算法', filters: { scale: ['unicorn'] } });
});

test('次因:同模式点历史 #独角兽 语义保持(applyTagSuggestion 既有语义,不 strip)', () => {
  // 点历史 #独角兽 条目 → 应用独角兽筛选:与「在当前模式点标签建议」一致
  const target = planExploreSearch({ query: '', filters: { industry: ['ai'] } }, '#独角兽');
  assert.deepEqual(target.filters, { scale: ['unicorn'], industry: ['ai'] });
  assert.equal(target.query, '', '标签命中后 query 清空(与原语义一致)');
});

// ---- 源码契约:map-shell 接线(viewStateRef 模式 + 同步重写)----

test('契约:主加载写缓存用写缓存时刻的最新 filters(最终落库,onBatch 中途不写)', () => {
  const shell = src('components/map-shell.tsx');
  // 中途批次(onBatch)不写缓存(poi-click-vanish,2026-08-26):逐页写会把残缺池
  // 落进 sessionStorage;缓存只在最终结果落库时写一次。写库时刻的 filters 用
  // viewStateRef(最新,非闭包快照——ws1 独角兽残留修复口径保留)。
  const onBatchAt = shell.indexOf('const onBatch = (batch: POI[]) => {');
  assert.ok(onBatchAt !== -1, 'onBatch 锚点存在');
  const onBatchEnd = shell.indexOf('\n        };', onBatchAt);
  assert.doesNotMatch(shell.slice(onBatchAt, onBatchEnd), /writeModeCache\(/, 'onBatch 中途批次不写缓存');
  const matches = shell.match(/filters: viewStateRef\.current\.filters,/g) ?? [];
  assert.ok(matches.length >= 1, `最终落库写缓存用 viewStateRef 最新 filters,实际 ${matches.length} 处`);
});

test('契约:filters 变更 → syncModeCache 同步重写缓存(deps 只留 [filters])', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /syncModeCache\(\{/);
  assert.match(shell, /}, \[filters\]\);/);
  // 不依赖 mode:避免 profile defaultMode 的 setMode 直改路径把旧模式状态写进新模式缓存
  assert.doesNotMatch(shell, /syncModeCache\(\{[\s\S]{0,400}?\}, \[mode, filters\]\);/);
  const modeCache = src('lib/mode-cache.ts');
  assert.match(modeCache, /export function syncModeCache/);
  assert.match(modeCache, /if \(!input\.viewport\) return;/);
});

test('契约:openExploreSearch 以 viewStateRef(最新状态)为 merge 基准,不再闭包 [query, filters]', () => {
  const shell = src('components/map-shell.tsx');
  const region = shell.slice(shell.indexOf('const openExploreSearch'), shell.indexOf('const openExploreSearch') + 1200);
  assert.match(region, /const live = viewStateRef\.current;/);
  assert.match(region, /planExploreSearch\(\{ query: live\.query, filters: live\.filters \}/);
  assert.match(region, /}, \[\]\);/);
  // 旧的闭包 merge 写法必须消失
  assert.doesNotMatch(region, /applyTagSuggestion\(\{ query, filters \}, nextQuery\)/);
  const search = src('lib/search.ts');
  assert.match(search, /export function planExploreSearch/);
});

test('契约:handleModeChange 切模式后立即同步 viewStateRef 为目标模式状态(两分支)', () => {
  const shell = src('components/map-shell.tsx');
  // 渲染期同步(1 处,viewStateRef.current = {...}) + 缓存分支 + 无缓存分支
  const matches = shell.match(/viewStateRef\.current = \{/g) ?? [];
  assert.ok(matches.length >= 3, `渲染期 + handleModeChange 两分支都同步 ref,实际 ${matches.length} 处`);
});

test('契约:handlePickRecent 先切模式(handleModeChange 同步 ref)再 openExploreSearch(读 ref)', () => {
  const shell = src('components/map-shell.tsx');
  const iMode = shell.indexOf('handleModeChange(replay.mode)');
  const iOpen = shell.indexOf('openExploreSearch(replay.query)');
  assert.ok(iMode >= 0 && iOpen >= 0, '两条链路都在');
  assert.ok(iMode < iOpen, '切模式在 openExploreSearch 之前 → 后者读到的是目标模式 ref 状态');
});
