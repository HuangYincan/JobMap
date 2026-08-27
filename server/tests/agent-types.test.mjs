import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction } from '../src/lib/agent/action-schema.ts';

test('validateAction: flyTo 合法(含 zoom)', () => {
  const a = validateAction({ type: 'flyTo', payload: { center: { lng: 120.1536, lat: 30.2875 }, zoom: 12 } });
  assert.deepEqual(a, { type: 'flyTo', payload: { center: { lng: 120.1536, lat: 30.2875 }, zoom: 12 } });
});

test('validateAction: flyTo 无 zoom 也合法(规范化为无 zoom 键)', () => {
  const a = validateAction({ type: 'flyTo', payload: { center: { lng: -0.12, lat: -45.6 } } });
  assert.deepEqual(a, { type: 'flyTo', payload: { center: { lng: -0.12, lat: -45.6 } } });
});

test('validateAction: flyTo zoom 钳制到项目/引擎共同范围[3,20](极端/负值/边界稳定)', () => {
  const center = { lng: 120, lat: 30 };
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: -1 } }).payload.zoom, 3);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: 0 } }).payload.zoom, 3);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: 3 } }).payload.zoom, 3);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: 20 } }).payload.zoom, 20);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: 21 } }).payload.zoom, 20);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: 1e6 } }).payload.zoom, 20);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: Number.NaN } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center, zoom: Number.POSITIVE_INFINITY } }), null);
});

test('validateAction: 越界/非法坐标一律 null', () => {
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: 181, lat: 30 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: 120, lat: 91 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: -181, lat: 0 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: 120, lat: -91 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: NaN, lat: 30 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: Infinity, lat: 30 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: '120', lat: 30 } } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: null } }), null);
  assert.equal(validateAction({ type: 'flyTo', payload: { center: { lng: 120, lat: 30 }, zoom: '12' } }), null);
});

test('validateAction: select id/mode 边界', () => {
  const ok = validateAction({ type: 'select', payload: { id: 'cmp_123', mode: 'work' } });
  assert.deepEqual(ok, { type: 'select', payload: { id: 'cmp_123', mode: 'work' } });
  assert.equal(validateAction({ type: 'select', payload: { id: '' } }), null);
  assert.equal(validateAction({ type: 'select', payload: { id: 'x'.repeat(129) } }), null);
  assert.equal(validateAction({ type: 'select', payload: { id: 'abc', mode: 'm'.repeat(33) } }), null);
  // mode 非 string → null
  assert.equal(validateAction({ type: 'select', payload: { id: 'abc', mode: 42 } }), null);
});

test('validateAction: addMarkers points 边界(≤50,每项 lng/lat finite,label ≤50)', () => {
  const one = validateAction({ type: 'addMarkers', payload: { points: [{ lng: 120.1, lat: 30.2, label: 'A' }] } });
  assert.deepEqual(one, { type: 'addMarkers', payload: { points: [{ lng: 120.1, lat: 30.2, label: 'A' }] } });
  const fifty = validateAction({
    type: 'addMarkers',
    payload: { points: Array.from({ length: 50 }, (_, i) => ({ lng: 120 + i, lat: 30 })) },
  });
  assert.equal(fifty?.type, 'addMarkers');
  assert.equal(fifty?.payload?.points?.length, 50);
  assert.equal(validateAction({ type: 'addMarkers', payload: { points: [] } }), null);
  assert.equal(
    validateAction({ type: 'addMarkers', payload: { points: Array.from({ length: 51 }, () => ({ lng: 120, lat: 30 })) } }),
    null,
  );
  assert.equal(validateAction({ type: 'addMarkers', payload: { points: [{ lng: 120, lat: 91 }] } }), null);
  assert.equal(validateAction({ type: 'addMarkers', payload: { points: [{ lng: NaN, lat: 30 }] } }), null);
  assert.equal(validateAction({ type: 'addMarkers', payload: { points: [{ lng: 120, lat: 30, label: 'l'.repeat(51) }] } }), null);
});

test('validateAction: drawCircle radius 10..50000', () => {
  assert.deepEqual(
    validateAction({ type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 10 } }),
    { type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 10 } },
  );
  assert.deepEqual(
    validateAction({ type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 50000, label: '圈' } }),
    { type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 50000, label: '圈' } },
  );
  assert.equal(validateAction({ type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 9 } }), null);
  assert.equal(validateAction({ type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: 50001 } }), null);
  assert.equal(validateAction({ type: 'drawCircle', payload: { center: { lng: 120, lat: 30 }, radiusMeters: '1000' } }), null);
});

test('validateAction: openDetail / search 边界', () => {
  assert.deepEqual(validateAction({ type: 'openDetail', payload: { id: 'job_9' } }), {
    type: 'openDetail',
    payload: { id: 'job_9' },
  });
  assert.equal(validateAction({ type: 'openDetail', payload: { id: '' } }), null);
  assert.equal(validateAction({ type: 'openDetail', payload: { id: 'x'.repeat(129) } }), null);
  assert.deepEqual(validateAction({ type: 'search', payload: { query: '杭州 前端' } }), {
    type: 'search',
    payload: { query: '杭州 前端' },
  });
  assert.equal(validateAction({ type: 'search', payload: { query: '' } }), null);
  assert.equal(validateAction({ type: 'search', payload: { query: 'q'.repeat(101) } }), null);
});

test('validateAction: 未知 type / 非对象 / 缺 payload 一律 null', () => {
  assert.equal(validateAction({ type: 'weird', payload: {} }), null);
  assert.equal(validateAction({ type: 'flyTo' }), null);
  assert.equal(validateAction(null), null);
  assert.equal(validateAction('flyTo'), null);
  assert.equal(validateAction(42), null);
  assert.equal(validateAction([]), null);
});

test('validateAction: 容忍 payload 多余字段(只校验约束字段)', () => {
  const a = validateAction({ type: 'flyTo', payload: { center: { lng: 120, lat: 30 }, zoom: 10, why: '因为近' } });
  assert.deepEqual(a, { type: 'flyTo', payload: { center: { lng: 120, lat: 30 }, zoom: 10 } });
});
