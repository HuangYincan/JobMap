// city-centers:静态城市中心表 + 城市名归一(tech/21 + ws-b + 2026-08-21 扩展)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CITY_CENTERS,
  CITY_CENTER_EPS,
  OVERSEAS_CITY_KEYS,
  bareCityName,
  cityCenter,
  isCityCenterPin,
} from '../src/lib/city-centers.ts';

test('CITY_CENTERS: 覆盖主要城市且坐标在合理范围(大陆 lng 73–136 / lat 3–54, 海外全球)', () => {
  for (const [k, v] of Object.entries(CITY_CENTERS)) {
    assert.ok(Number.isFinite(v.lng) && Number.isFinite(v.lat), `${k} 坐标有限`);
  }
  for (const [k, v] of Object.entries(CITY_CENTERS)) {
    if (OVERSEAS_CITY_KEYS.has(k)) continue;
    assert.ok(v.lng >= 73 && v.lng <= 136, `${k} lng=${v.lng}`);
    assert.ok(v.lat >= 3 && v.lat <= 54, `${k} lat=${v.lat}`);
  }
  for (const k of OVERSEAS_CITY_KEYS) {
    const v = CITY_CENTERS[k];
    assert.ok(v.lng >= -180 && v.lng <= 180, `${k} lng=${v.lng}`);
    assert.ok(v.lat >= -60 && v.lat <= 60, `${k} lat=${v.lat}`);
  }
  // 京津沪渝 + 主要二线 + 2026-08-21 新增(含海外)都在表内
  for (const city of ['北京', '上海', '天津', '重庆', '杭州', '深圳', '广州', '武汉', '成都', '柳州', '无锡', '兰州', '哈尔滨', '新加坡', '东京', '洛杉矶']) {
    assert.ok(city in CITY_CENTERS, `${city} 在中心表`);
  }
});

test('bareCityName: 去「省/市/区」后缀成裸名', () => {
  assert.equal(bareCityName('北京市'), '北京');
  assert.equal(bareCityName('北京'), '北京');
  assert.equal(bareCityName('浙江省'), '浙江');
  assert.equal(bareCityName('杭州市'), '杭州');
  assert.equal(bareCityName('哈尔滨'), '哈尔滨'); // 无后缀原样
});

test('bareCityName: 剥「省+城市」连写前缀(广西柳州 / 河南洛阳)', () => {
  assert.equal(bareCityName('广西柳州'), '柳州');
  assert.equal(bareCityName('河南洛阳'), '洛阳');
  assert.equal(bareCityName('河南省洛阳'), '洛阳'); // 省字衔接也支持
  assert.equal(bareCityName('吉林'), '吉林'); // 纯省名(兼市名)不剥
  assert.equal(bareCityName('北京'), '北京'); // 直辖市不剥
});

test('cityCenter: 北京/北京市 命中同一键', () => {
  assert.deepEqual(cityCenter('北京'), { lng: 116.4, lat: 39.9 });
  assert.deepEqual(cityCenter('北京市'), { lng: 116.4, lat: 39.9 });
});

test('cityCenter: 省前缀连写与新增城市命中(柳州 / 新加坡 / 东京 / 洛杉矶)', () => {
  assert.deepEqual(cityCenter('广西柳州'), { lng: 109.41, lat: 24.32 });
  assert.deepEqual(cityCenter('柳州市'), { lng: 109.41, lat: 24.32 });
  assert.deepEqual(cityCenter('新加坡'), { lng: 103.82, lat: 1.35 });
  assert.deepEqual(cityCenter('东京'), { lng: 139.69, lat: 35.69 });
  assert.deepEqual(cityCenter('洛杉矶'), { lng: -118.24, lat: 34.05 });
});

test('cityCenter: 未知城市返回 undefined(调用方回退均值)', () => {
  assert.equal(cityCenter('三亚'), undefined);
  assert.equal(cityCenter('随便城'), undefined);
});

test('isCityCenterPin: 精确中心坐标命中, 偏移/真实坐标不命中', () => {
  // 每个主要城市中心(±EPS 内)都应判为 pin
  for (const [k, v] of Object.entries(CITY_CENTERS)) {
    assert.ok(isCityCenterPin(v.lng, v.lat), `${k} 中心应判为 pin`);
  }
  // 偏移超过 EPS 的真实坐标不命中
  assert.ok(!isCityCenterPin(121.4745, 31.2345), '上海中心 +~500m 不是 pin');
  assert.ok(!isCityCenterPin(116.405, 39.905), '北京中心 +~500m 不是 pin');
  assert.ok(!isCityCenterPin(120.16, 30.28), '杭州真实办公区不是 pin');
  // 非有限值安全返回 false
  assert.ok(!isCityCenterPin(NaN, 31.23));
  assert.ok(!isCityCenterPin(121.47, Infinity));
});

test('isCityCenterPin: 边界 — EPS 内命中, 略过不命中', () => {
  const sh = CITY_CENTERS['上海'];
  // 用带余量的偏移(±1e-4), 避开浮点加法在恰好 EPS 处的 1e-16 级误差。
  assert.ok(isCityCenterPin(sh.lng + 0.0004, sh.lat), 'EPS 内命中');
  assert.ok(!isCityCenterPin(sh.lng + 0.0006, sh.lat), 'EPS 外不命中');
});