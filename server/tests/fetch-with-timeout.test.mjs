import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  isAbortError,
} from '../src/lib/fetch-with-timeout.ts';
import { geocodeAddressRest } from '../src/lib/site-geocode.ts';

function hangingFetch() {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
}

test('fetchWithTimeout aborts a hanging fetch after the configured timeout', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());

  const p = fetchWithTimeout('https://example.test', undefined, hangingFetch(), 1000);
  mock.timers.tick(1000);
  await assert.rejects(p, (err) => {
    assert.equal(isAbortError(err), true);
    assert.equal(err.name, 'AbortError');
    return true;
  });
});

test('fetchWithTimeout propagates an external abort without waiting for the deadline', async () => {
  const controller = new AbortController();
  let aborted = false;
  const p = fetchWithTimeout(
    'https://example.test',
    { signal: controller.signal },
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal.reason);
        });
      }),
    60_000,
  );
  controller.abort(new Error('user stopped'));
  await assert.rejects(p, (err) => err.message === 'user stopped');
  assert.equal(aborted, true);
});

test('geocodeAddressRest times out and degrades to reason timeout', async (t) => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    mock.timers.reset();
    if (prev === undefined) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  });

  const resultP = geocodeAddressRest('西湖', '杭州', hangingFetch());
  mock.timers.tick(DEFAULT_FETCH_TIMEOUT_MS);
  const result = await resultP;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
});
