// ============================================================
// 收藏模式列表卡片化 + 历史点击冲突门控回归测试(ws-1 saved-layer-card,2026-08-22)
//
// 用户指示(2026-08-22):① 收藏图层(互斥模式)下 Explore 列表 item 用普通模式
// 的 POICard 玻璃卡片(替代 SavedList 简单行);② 修复「收藏模式 vs 历史记录
// 点击历史查询点」冲突。
//
// 覆盖(jsdom 可测层:本仓库无 jsdom 运行时,沿用「源码契约 + 语义镜像」模式,
// 与 saved-layer-mutex/saved-layer-sync 同构):
// - POICard onRemove:源码契约(可选 prop / 条件渲染 / aria-label / 冒泡隔离)
//   + i18n 键(zh/en) + 语义镜像(点击 stopPropagation → onRemove(poi));
// - 数据桥接(savedPlacesToListPois):纯函数实跑——活数据优先 / 快照兜底 /
//   无坐标丢弃 / origin 补全快照 distance;
// - handlePickRecent 门控:源码契约(门控位于原链路之前 + deps 含门控依赖)
//   + 语义镜像(收藏开 = 先 hide 再原链路;关 = 零门控直走)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERNSHIP_SEED } from './fixtures/seed-data.ts';
import { savedPlacesToListPois } from '../src/lib/saved-overlay.ts';
import { haversineDistance } from '../src/lib/types.ts';
import { t } from '../src/lib/i18n.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
assert.ok(alibaba, 'seed fixture alibaba-xixi must exist');

/** 语义镜像:POICard 移除按钮点击——stopPropagation 后调用 onRemove(poi)。 */
function mirrorRemoveClick(e, onRemove, poi) {
  e.stopPropagation();
  onRemove(poi);
}

// ---- ① POICard onRemove(不传不渲染;传了渲染 + 点击移除 + 不冒泡)----

test('POICard:onRemove 为可选 prop(不传则完全不渲染,零影响普通模式)', () => {
  const card = src('components/poi-card.tsx');
  assert.match(card, /onRemove\?: \(poi: POI\) => void/);
  // 条件渲染:按钮只存在于 onRemove 分支内,不传时 header 无按钮
  const headerCount = (card.match(/onRemove && <RemoveSavedButton/g) ?? []).length;
  assert.equal(headerCount, 2, 'domain + recruitment 两个 header 都要条件渲染移除按钮');
  // POIList 侧:onRemove 可选 prop + 透传默认 undefined → 普通模式卡片零变化
  const list = src('components/poi-list.tsx');
  assert.match(list, /onRemove\?: \(poi: POI\) => void/);
  assert.match(list, /onRemove=\{onRemove\}/);
});

test('POICard:移除按钮 aria-label 走 i18n(zh/en),点击 stopPropagation + onRemove(poi)', () => {
  const card = src('components/poi-card.tsx');
  assert.match(card, /aria-label=\{t\("removeSaved", lang\)\}/);
  assert.match(card, /title=\{t\("removeSaved", lang\)\}/);
  assert.match(card, /e\.stopPropagation\(\);\s*\n\s*onRemove\(poi\);/);
  // 键盘不冒泡到卡片(article 的 Enter/Space 会同时触发选中)
  assert.match(card, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test('i18n:removeSaved 键 zh/en 齐备', () => {
  assert.equal(t('removeSaved', 'zh'), '取消收藏');
  assert.equal(t('removeSaved', 'en'), 'Remove');
});

test('语义镜像:移除按钮点击只移除、不触发卡片选中(先 stopPropagation)', () => {
  const calls = [];
  const fakeEvent = { stopPropagation() { calls.push('stop'); } };
  const poi = { id: 'alibaba-xixi', name: '阿里巴巴' };
  mirrorRemoveClick(fakeEvent, (p) => calls.push(`remove:${p.id}`), poi);
  assert.deepEqual(calls, ['stop', 'remove:alibaba-xixi'], '点击 → 先隔离冒泡,再调用 onRemove(poi)');
});

// ---- ② 收藏模式列表数据桥接(活数据优先 / 快照兜底)----

test('桥接:活数据优先——catalog 命中返回完整卡片(seed 活数据)', () => {
  const pois = savedPlacesToListPois(
    [
      {
        id: 's1',
        poiId: alibaba.id,
        name: '阿里巴巴西溪',
        mode: 'work',
        kind: 'recruitment',
        lng: 120.02,
        lat: 30.28,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    INTERNSHIP_SEED,
  );
  assert.equal(pois.length, 1);
  assert.equal(pois[0].id, alibaba.id);
  assert.equal(pois[0].kind, 'recruitment');
  assert.equal(pois[0].name, '阿里巴巴', '活数据覆盖快照名');
  assert.ok(pois[0].positions.length > 0, '活数据岗位完整(卡片显示岗位数)');
});

test('桥接:快照兜底——catalog 未命中且有坐标 → recruitment/domain 形态卡片', () => {
  const pois = savedPlacesToListPois(
    [
      {
        id: 's2',
        poiId: 'cold-company',
        name: '冷门公司',
        mode: 'work',
        kind: 'recruitment',
        address: '滨江区',
        lng: 120.2,
        lat: 30.2,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      {
        id: 's3',
        poiId: 'hz-cafe',
        name: '某咖啡',
        mode: 'domain',
        kind: 'domain',
        address: '西湖区',
        lng: 120.16,
        lat: 30.25,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
  );
  assert.equal(pois.length, 2);
  assert.equal(pois[0].kind, 'recruitment', '工作收藏兜底必须是 recruitment 形态(非 domain)');
  assert.equal(pois[1].kind, 'domain');
  assert.equal(pois[1].location.lng, 120.16);
});

test('桥接:无坐标且无活数据 → 丢弃(卡片必须有点位)', () => {
  const pois = savedPlacesToListPois(
    [
      {
        id: 's4',
        poiId: 'no-coords',
        name: '没坐标',
        mode: 'domain',
        kind: 'domain',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
  );
  assert.deepEqual(pois, []);
});

test('桥接:origin 补全快照/活数据 distance 但不污染共享 catalog', () => {
  const origin = { lng: 120.1, lat: 30.2 };
  const pois = savedPlacesToListPois(
    [
      {
        id: 's5',
        poiId: 'cold-company',
        name: '冷门公司',
        mode: 'work',
        kind: 'recruitment',
        lng: 120.2,
        lat: 30.2,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      {
        id: 's6',
        poiId: alibaba.id,
        name: '阿里',
        mode: 'work',
        kind: 'recruitment',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    INTERNSHIP_SEED,
    origin,
  );
  const snapshot = pois.find((p) => p.id === 'cold-company');
  assert.ok(snapshot, '快照兜底存在');
  const expected = haversineDistance({ lng: 120.2, lat: 30.2 }, origin);
  assert.equal(snapshot.distance, expected, '快照 distance 按 haversine 补全');
  const live = pois.find((p) => p.id === alibaba.id);
  assert.ok(live, '活数据存在');
  assert.equal(alibaba.distance, undefined, 'catalog POI 不被原地改写');
  assert.equal(
    live.distance,
    haversineDistance(alibaba.location, origin),
    '返回的活数据卡片 distance 按 haversine 补全',
  );
  assert.notEqual(live, alibaba, '补距离时返回新对象');
});

// ---- ③ handlePickRecent 收藏门控(方案 A:先关图层再走原链路)----

test('源码契约:handlePickRecent 开头门控——收藏开先 hideSavedOverlay 再原链路', () => {
  const shell = src('components/map-shell.tsx');
  const at = shell.indexOf('const handlePickRecent = useCallback');
  assert.ok(at !== -1, 'handlePickRecent anchor exists');
  const gateAt = shell.indexOf('if (savedLayerEnabled) hideSavedOverlay();', at);
  const replayAt = shell.indexOf('const replay = replayRecentSearch(mode, entry);', at);
  assert.ok(gateAt !== -1, '门控行存在');
  assert.ok(replayAt !== -1 && gateAt < replayAt, '门控必须位于原链路(回放)之前');
  // deps 补齐门控依赖(savedLayerEnabled 派生 + hide 稳定回调)
  assert.match(shell, /\[mode, handleModeChange, openExploreSearch, catalog, pois, savedLayerEnabled, hideSavedOverlay\]/);
});

test('语义镜像:收藏开 = 先 hide 再走原链路;关 = 零门控直走', () => {
  const calls = [];
  const gate = (enabled, hide, proceed) => {
    if (enabled) hide();
    proceed();
  };
  // 开:显式离开收藏视图 → 先关图层,再回放搜索
  gate(true, () => calls.push('hide'), () => calls.push('replay'));
  assert.deepEqual(calls, ['hide', 'replay'], '收藏开启时:先关图层再走原链路(顺序固定)');
  // 关:收藏未开 → 不触碰图层状态,直走原链路
  calls.length = 0;
  gate(false, () => calls.push('hide'), () => calls.push('replay'));
  assert.deepEqual(calls, ['replay'], '收藏关闭时:零门控,原链路行为不变');
});
