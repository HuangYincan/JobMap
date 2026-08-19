// city-centers:静态城市中心表 + 城市名归一(tech/21 + ws-b)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CITY_CENTERS,
  bareCityName,
  cityCenter,
} from '../src/lib/city-centers.ts';

test('CITY_CENTERS: 覆盖主要城市且坐标在合理范围(lng 73–136 / lat 3–54,中国境内)', () => {
  for (const [k, v] of Object.entries(CITY_CENTERS)) {
    assert.ok(Number.isFinite(v.lng) && Number.isFinite(v.lat), `${k} 坐标有限`);
    assert.ok(v.lng >= 73 && v.lng <= 136, `${k} lng=${v.lng}`);
    assert.ok(v.lat >= 3 && v.lat <= 54, `${k} lat=${v.lat}`);
  }
  // 京津沪渝 + 主要二线都在表内
  for (const city of ['北京', '上海', '天津', '重庆', '杭州', '深圳', '广州', '武汉', '成都']) {
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

test('cityCenter: 北京/北京市 命中同一键', () => {
  assert.deepEqual(cityCenter('北京'), { lng: 116.4, lat: 39.9 });
  assert.deepEqual(cityCenter('北京市'), { lng: 116.4, lat: 39.9 });
});

test('cityCenter: 未知城市返回 undefined(调用方回退均值)', () => {
  assert.equal(cityCenter('哈尔滨'), undefined);
  assert.equal(cityCenter('随便城'), undefined);
});