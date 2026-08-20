import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amapWebKey,
  baiduWebKey,
  tencentWebKey,
  formatGeocodeProviderReport,
  getGeocodeProviders,
} from '../src/lib/site-geocode.ts';

// 与 site-geocode.ts 内 key getter 读同一 env(trim 后非空 = configured)。
const KEY_ENV = ['AMAP_WEB_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY'];

/** 设置三个 key env,运行 fn 后还原(与 site-geocode.test.mjs 的 try/finally 同款)。 */
function withEnv(env, fn) {
  const prev = Object.fromEntries(KEY_ENV.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEY_ENV) {
      const v = env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const k of KEY_ENV) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('getGeocodeProviders: 三 key 全配 → 全 configured, 按链顺序 amap→baidu→tencent', () => {
  withEnv({ AMAP_WEB_KEY: 'k1', BAIDU_MAP_AK: 'k2', TENCENT_MAP_KEY: 'k3' }, () => {
    const providers = getGeocodeProviders();
    assert.deepEqual(
      providers.map((p) => [p.id, p.envVar, p.configured]),
      [
        ['amap', 'AMAP_WEB_KEY', true],
        ['baidu', 'BAIDU_MAP_AK', true],
        ['tencent', 'TENCENT_MAP_KEY', true],
      ],
    );
  });
});

test('getGeocodeProviders: 单配 amap → 只有 amap configured', () => {
  withEnv({ AMAP_WEB_KEY: 'k1' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: true, baidu: false, tencent: false });
  });
});

test('getGeocodeProviders: 单配 baidu → 只有 baidu configured', () => {
  withEnv({ BAIDU_MAP_AK: 'k2' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: false, baidu: true, tencent: false });
  });
});

test('getGeocodeProviders: 单配 tencent → 只有 tencent configured', () => {
  withEnv({ TENCENT_MAP_KEY: 'k3' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: false, baidu: false, tencent: true });
  });
});

test('getGeocodeProviders: 零配 → 全 missing', () => {
  withEnv({}, () => {
    const providers = getGeocodeProviders();
    assert.equal(providers.length, 3);
    assert.ok(providers.every((p) => !p.configured));
  });
});

test('getGeocodeProviders: 空白值(含空串)按 missing 计(trim 语义)', () => {
  withEnv({ AMAP_WEB_KEY: '   ', BAIDU_MAP_AK: '', TENCENT_MAP_KEY: ' \n ' }, () => {
    assert.ok(getGeocodeProviders().every((p) => !p.configured));
  });
});

// 一致性:注册表 configured 必须与 key getter 存在性完全一致(防注册表与链漂移)。
test('注册表 configured 与 amapWebKey/baiduWebKey/tencentWebKey 完全一致(2^3 全组合)', () => {
  const GETTER_BY_ID = { amap: amapWebKey, baidu: baiduWebKey, tencent: tencentWebKey };
  for (let mask = 0; mask < 8; mask++) {
    const env = {
      AMAP_WEB_KEY: mask & 1 ? 'amap-key' : undefined,
      BAIDU_MAP_AK: mask & 2 ? 'baidu-key' : undefined,
      TENCENT_MAP_KEY: mask & 4 ? 'tencent-key' : undefined,
    };
    withEnv(env, () => {
      const providers = getGeocodeProviders();
      assert.equal(providers.length, 3, `mask=${mask}`);
      for (const p of providers) {
        const getterConfigured = GETTER_BY_ID[p.id]() != null;
        assert.equal(p.configured, getterConfigured, `${p.id} mask=${mask}`);
        assert.equal(process.env[p.envVar]?.trim().length > 0, p.configured, `${p.envVar} mask=${mask}`);
      }
    });
  }
});

test('formatGeocodeProviderReport: 全配 → set 全链', () => {
  withEnv({ AMAP_WEB_KEY: 'k1', BAIDU_MAP_AK: 'k2', TENCENT_MAP_KEY: 'k3' }, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=set baidu=set tencent=set | chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});

test('formatGeocodeProviderReport: 零配 → missing 全链', () => {
  withEnv({}, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=missing baidu=missing tencent=missing | chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});

test('formatGeocodeProviderReport: 单配 tencent 的中间态', () => {
  withEnv({ TENCENT_MAP_KEY: 'k3' }, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=missing baidu=missing tencent=set | chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});
