import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_ANNOTATE_MAX,
  emptyWorkHintBuckets,
  hintsForJobMapActions,
  ingestWorkMapHints,
  mergeMapHints,
  sanitizeMapHints,
  synthesizeJobMapActions,
} from '../src/lib/agent/map-hints.ts';

const ANKER = {
  lng: 113.953431,
  lat: 22.569079,
  label: '安克创新 · 全栈设计师',
  mapId: 'anker:sz',
  positionId: 'portal-feishu-1',
};
const INSTA = {
  lng: 113.879897,
  lat: 22.55191,
  label: '影石 · DataAgent 全栈',
  mapId: 'insta360:sz',
  positionId: 'portal-feishu-2',
};

test('sanitizeMapHints: 丢掉非法坐标,截断 label/id', () => {
  assert.deepEqual(sanitizeMapHints(undefined), []);
  assert.deepEqual(sanitizeMapHints([{ lng: 200, lat: 30 }]), []);
  assert.deepEqual(sanitizeMapHints([{ lng: 120, lat: Number.NaN }]), []);
  const [ok] = sanitizeMapHints([
    { lng: 113.95, lat: 22.56, label: 'x'.repeat(80), mapId: 'm'.repeat(200), positionId: 'p'.repeat(200) },
  ]);
  assert.equal(ok.label.length, 50);
  assert.equal(ok.mapId.length, 128);
  assert.equal(ok.positionId.length, 128);
});

test('mergeMapHints: 同 mapId 去重,保留先到', () => {
  const merged = mergeMapHints([ANKER], [{ ...ANKER, label: '重复岗', positionId: 'other' }, INSTA]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].label, ANKER.label);
  assert.equal(merged[1].mapId, INSTA.mapId);
});

test('ingestWorkMapHints: 搜索整页替换,详情追加;空搜索清空上一页', () => {
  let buckets = emptyWorkHintBuckets();
  buckets = ingestWorkMapHints(buckets, 'work__searchPositions', [ANKER, INSTA]);
  assert.equal(buckets.search.length, 2);
  buckets = ingestWorkMapHints(buckets, 'work__searchPositions', []);
  assert.equal(buckets.search.length, 0);
  buckets = ingestWorkMapHints(buckets, 'work__searchPositions', [ANKER, INSTA]);
  buckets = ingestWorkMapHints(buckets, 'work__getPositionDetail', [ANKER]);
  buckets = ingestWorkMapHints(buckets, 'work__getPositionDetail', [INSTA]);
  assert.deepEqual(
    hintsForJobMapActions(buckets).map((h) => h.mapId),
    ['anker:sz', 'insta360:sz'],
  );
});

test('hintsForJobMapActions: 有详情则用详情,否则用最近一次搜索页', () => {
  let buckets = ingestWorkMapHints(emptyWorkHintBuckets(), 'work__searchPositions', [ANKER, INSTA]);
  assert.equal(hintsForJobMapActions(buckets).length, 2);
  buckets = ingestWorkMapHints(buckets, 'work__getPositionDetail', [ANKER]);
  assert.deepEqual(hintsForJobMapActions(buckets).map((h) => h.mapId), ['anker:sz']);
});

test('synthesizeJobMapActions: LLM 漏动作时补 addMarkers + flyTo + select(mapId)', () => {
  const actions = synthesizeJobMapActions([], [ANKER, INSTA]);
  assert.equal(actions.length, 3);
  assert.equal(actions[0].type, 'addMarkers');
  assert.equal(actions[0].payload.points.length, 2);
  assert.equal(actions[0].payload.points[0].label, ANKER.label);
  assert.equal(actions[1].type, 'flyTo');
  assert.ok(actions[1].payload.center.lng > 113 && actions[1].payload.center.lng < 114);
  assert.ok(actions[1].payload.zoom >= 12 && actions[1].payload.zoom <= 14);
  assert.deepEqual(actions[2], { type: 'select', payload: { id: 'anker:sz', mode: 'card' } });
});

test('synthesizeJobMapActions: LLM 已发 flyTo/addMarkers 则只补缺口;过多点不自动落', () => {
  const fly = { type: 'flyTo', payload: { center: { lng: 114, lat: 22.5 }, zoom: 12 } };
  const filled = synthesizeJobMapActions([fly], [ANKER]);
  assert.equal(filled.some((a) => a.type === 'flyTo'), false);
  assert.equal(filled.some((a) => a.type === 'addMarkers'), true);
  assert.equal(filled.some((a) => a.type === 'select'), true);

  const many = Array.from({ length: AUTO_ANNOTATE_MAX + 1 }, (_, i) => ({
    lng: 114 + i * 0.01,
    lat: 22.5,
    mapId: `co:${i}`,
  }));
  assert.deepEqual(synthesizeJobMapActions([], many), []);
});
