import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amapWebKey,
  baiduWebKey,
  tencentWebKey,
  jiaoyuntongWebKey,
  formatGeocodeProviderReport,
  getGeocodeProviders,
} from '../src/lib/site-geocode.ts';

// 与 site-geocode.ts 内 key getter 读同一 env(trim 后非空 = configured)。
// JIAOYUNTONG_MAP_KEY = 公司内部地图网关 token(place 检索链,2026-08-25)。
const KEY_ENV = ['AMAP_WEB_KEY', 'JIAOYUNTONG_MAP_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY'];

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

test('getGeocodeProviders: 四 key 全配 → 全 configured, 按 place 链顺序 amap→jiaoyuntong→baidu→tencent', () => {
  withEnv({ AMAP_WEB_KEY: 'k1', JIAOYUNTONG_MAP_KEY: 'k4', BAIDU_MAP_AK: 'k2', TENCENT_MAP_KEY: 'k3' }, () => {
    const providers = getGeocodeProviders();
    assert.deepEqual(
      providers.map((p) => [p.id, p.envVar, p.configured]),
      [
        ['amap', 'AMAP_WEB_KEY', true],
        ['jiaoyuntong', 'JIAOYUNTONG_MAP_KEY', true],
        ['baidu', 'BAIDU_MAP_AK', true],
        ['tencent', 'TENCENT_MAP_KEY', true],
      ],
    );
  });
});

test('getGeocodeProviders: 单配 amap → 只有 amap configured', () => {
  withEnv({ AMAP_WEB_KEY: 'k1' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: true, jiaoyuntong: false, baidu: false, tencent: false });
  });
});

test('getGeocodeProviders: 单配 baidu → 只有 baidu configured', () => {
  withEnv({ BAIDU_MAP_AK: 'k2' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: false, jiaoyuntong: false, baidu: true, tencent: false });
  });
});

test('getGeocodeProviders: 单配 tencent → 只有 tencent configured', () => {
  withEnv({ TENCENT_MAP_KEY: 'k3' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: false, jiaoyuntong: false, baidu: false, tencent: true });
  });
});

test('getGeocodeProviders: 单配 jiaoyuntong → 只有 jiaoyuntong configured', () => {
  withEnv({ JIAOYUNTONG_MAP_KEY: 'k4' }, () => {
    const byId = Object.fromEntries(getGeocodeProviders().map((p) => [p.id, p.configured]));
    assert.deepEqual(byId, { amap: false, jiaoyuntong: true, baidu: false, tencent: false });
  });
});

test('getGeocodeProviders: 零配 → 全 missing', () => {
  withEnv({}, () => {
    const providers = getGeocodeProviders();
    assert.equal(providers.length, 4);
    assert.ok(providers.every((p) => !p.configured));
  });
});

test('getGeocodeProviders: 空白值(含空串)按 missing 计(trim 语义)', () => {
  withEnv({ AMAP_WEB_KEY: '   ', BAIDU_MAP_AK: '', TENCENT_MAP_KEY: ' \n ' }, () => {
    assert.ok(getGeocodeProviders().every((p) => !p.configured));
  });
});

// 一致性:注册表 configured 必须与 key getter 存在性完全一致(防注册表与链漂移)。
test('注册表 configured 与各 key getter 完全一致(2^4 全组合)', () => {
  const GETTER_BY_ID = { amap: amapWebKey, jiaoyuntong: jiaoyuntongWebKey, baidu: baiduWebKey, tencent: tencentWebKey };
  for (let mask = 0; mask < 16; mask++) {
    const env = {
      AMAP_WEB_KEY: mask & 1 ? 'amap-key' : undefined,
      JIAOYUNTONG_MAP_KEY: mask & 2 ? 'jyt-key' : undefined,
      BAIDU_MAP_AK: mask & 4 ? 'baidu-key' : undefined,
      TENCENT_MAP_KEY: mask & 8 ? 'tencent-key' : undefined,
    };
    withEnv(env, () => {
      const providers = getGeocodeProviders();
      assert.equal(providers.length, 4, `mask=${mask}`);
      for (const p of providers) {
        const getterConfigured = GETTER_BY_ID[p.id]() != null;
        assert.equal(p.configured, getterConfigured, `${p.id} mask=${mask}`);
        assert.equal(process.env[p.envVar]?.trim().length > 0, p.configured, `${p.envVar} mask=${mask}`);
      }
    });
  }
});

test('formatGeocodeProviderReport: 全配 → set 全链', () => {
  withEnv({ AMAP_WEB_KEY: 'k1', JIAOYUNTONG_MAP_KEY: 'k4', BAIDU_MAP_AK: 'k2', TENCENT_MAP_KEY: 'k3' }, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=set jiaoyuntong=set baidu=set tencent=set | place-chain=AMap→jiaoyuntong(公司网关)→Baidu→Tencent | geo/regeo-chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});

test('formatGeocodeProviderReport: 零配 → missing 全链', () => {
  withEnv({}, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=missing jiaoyuntong=missing baidu=missing tencent=missing | place-chain=AMap→jiaoyuntong(公司网关)→Baidu→Tencent | geo/regeo-chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});

test('formatGeocodeProviderReport: 单配 tencent 的中间态', () => {
  withEnv({ TENCENT_MAP_KEY: 'k3' }, () => {
    assert.equal(
      formatGeocodeProviderReport(),
      'PROVIDERS amap=missing jiaoyuntong=missing baidu=missing tencent=set | place-chain=AMap→jiaoyuntong(公司网关)→Baidu→Tencent | geo/regeo-chain=AMap→Baidu→Tencent (skip no-key)',
    );
  });
});
