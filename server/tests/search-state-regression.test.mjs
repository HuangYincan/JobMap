import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * useSearchState 的无 jsdom 语义镜像：每次 query/mode/readiness 变化都会
 * 取消旧 token；只有当前 token 可以提交结果。实际 hook 另由源码契约断言。
 */
function createSuggestionHarness({ local, engine, delayMs = 0 }) {
  let active = null;
  let landed = [];

  function schedule(state) {
    if (active) active.cancelled = true;
    const token = { cancelled: false };
    active = token;
    const timer = setTimeout(async () => {
      const localSuggestions = await local(state.query, state.mode);
      if (token.cancelled) return;
      if (state.mode !== 'domain' || localSuggestions.length > 0) {
        landed.push({ mode: state.mode, query: state.query, suggestions: localSuggestions });
        return;
      }
      if (!state.engineReady || !state.engineId) return;
      const engineSuggestions = await engine(state.engineId, state.query);
      if (token.cancelled) return;
      landed.push({ mode: state.mode, query: state.query, suggestions: engineSuggestions });
    }, delayMs);
    return () => {
      token.cancelled = true;
      clearTimeout(timer);
    };
  }

  return {
    schedule,
    landed: () => landed,
  };
}

test('domain query typed before engine ready is retried on stable readiness identity', async () => {
  const engineCalls = [];
  const harness = createSuggestionHarness({
    local: async () => [],
    engine: async (engineId, query) => {
      engineCalls.push({ engineId, query });
      return [{ id: 'west-lake', name: '西湖' }];
    },
  });

  harness.schedule({ query: '西湖', mode: 'domain', engineReady: false, engineId: null });
  await wait(5);
  assert.deepEqual(harness.landed(), [], 'not-ready lookup must wait for the engine retry');

  harness.schedule({ query: '西湖', mode: 'domain', engineReady: true, engineId: 'amap' });
  await wait(5);
  assert.deepEqual(engineCalls, [{ engineId: 'amap', query: '西湖' }]);
  assert.deepEqual(harness.landed().map((item) => item.suggestions[0].name), ['西湖']);
});

test('query/mode changes cancel old suggestion requests and cannot cross-land results', async () => {
  let releaseOld;
  const oldLocal = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const harness = createSuggestionHarness({
    local: async (query, mode) => {
      if (query === '旧词') return oldLocal;
      return [{ id: `${mode}-new`, name: `${mode}-new` }];
    },
    engine: async () => [{ id: 'engine-old', name: 'engine-old' }],
  });

  harness.schedule({ query: '旧词', mode: 'domain', engineReady: true, engineId: 'amap' });
  await wait(2);
  harness.schedule({ query: '新词', mode: 'work', engineReady: true, engineId: 'amap' });
  await wait(5);
  releaseOld([]);
  await wait(5);

  assert.deepEqual(harness.landed(), [{
    mode: 'work',
    query: '新词',
    suggestions: [{ id: 'work-new', name: 'work-new' }],
  }]);
});

test('readiness retry contract keeps debounce/cancellation and mode boundaries', () => {
  const hook = src('hooks/use-search-state.ts');
  const shell = src('components/map-shell.tsx');

  assert.match(hook, /engineReady\?: boolean;/);
  assert.match(hook, /const searchReadyKey = mode === "domain" && engineReady \? engine\?\.id \?\? null : null;/);
  assert.match(hook, /\}, \[query, mode, searchReadyKey\]\);/);
  assert.doesNotMatch(hook, /\}, \[query, mode, zoom, catalog\]\);/);
  assert.match(hook, /const timer = setTimeout\(async \(\) => \{/);
  assert.match(hook, /return \(\) => \{\s*cancelled = true;\s*clearTimeout\(timer\);/);
  assert.match(hook, /if \(!engineReady \|\| !engineRef\.current\) return;/);
  assert.match(hook, /if \(cancelled\) return;/);
  assert.match(shell, /engineReady: Boolean\(engineView\)/);

  const readyKeyAt = hook.indexOf('const searchReadyKey =');
  const effectAt = hook.indexOf('useEffect(() => {', readyKeyAt);
  assert.ok(readyKeyAt !== -1 && effectAt > readyKeyAt, 'readiness key must be captured before the suggest effect');
});
