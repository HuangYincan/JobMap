import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanCsvRow,
  HANGZHOU_BBOX,
  inHangzhouBox,
  parseBizExt,
  parsePhotosUrlArray,
  parseTelCell,
  splitLocation,
  tierForCategory,
} from '../src/lib/hz-poi-import.ts';

test('parsePhotosUrlArray: 空/畸形 → []', () => {
  assert.deepEqual(parsePhotosUrlArray(''), []);
  assert.deepEqual(parsePhotosUrlArray('[]'), []);
  assert.deepEqual(parsePhotosUrlArray('{}'), []);
  assert.deepEqual(parsePhotosUrlArray('{'), []);
});

test('parsePhotosUrlArray: 单引号 python-repr → url 数组', () => {
  const input = `[{'title':[],'url':'http://store.is.autonavi.com/showpic/af709cff','provider':[]}]`;
  assert.deepEqual(parsePhotosUrlArray(input), [
    'http://store.is.autonavi.com/showpic/af709cff',
  ]);
});

test('parsePhotosUrlArray: 多条 url 全部提取', () => {
  const input =
    `[{'title':[],'url':'http://a.com/1','provider':[]},{'url':'http://a.com/2'}]`;
  assert.deepEqual(parsePhotosUrlArray(input), [
    'http://a.com/1',
    'http://a.com/2',
  ]);
});

test('parsePhotosUrlArray: JSON 双引号形态(实测 ~0.3% 行)', () => {
  const input =
    `[{"title": "Logo", "url": "https://store.is.autonavi.com/showpic/6b35f687", "provider": []}]`;
  assert.deepEqual(parsePhotosUrlArray(input), [
    'https://store.is.autonavi.com/showpic/6b35f687',
  ]);
});

test('parsePhotosUrlArray: 混合形态 + 无引号键', () => {
  const input = `[{"url":"http://a.com/x"},{url:'http://a.com/y'}]`;
  assert.deepEqual(parsePhotosUrlArray(input), [
    'http://a.com/x',
    'http://a.com/y',
  ]);
});

test('splitLocation: "lng,lat" → 坐标', () => {
  assert.deepEqual(splitLocation('120.135110,30.251243'), {
    lng: 120.13511,
    lat: 30.251243,
  });
  assert.deepEqual(splitLocation(' 120.135110 , 30.251243 '), {
    lng: 120.13511,
    lat: 30.251243,
  });
});

test('splitLocation: 非法 → null', () => {
  assert.equal(splitLocation(''), null);
  assert.equal(splitLocation('abc'), null);
  assert.equal(splitLocation('120.13'), null);
  assert.equal(splitLocation('999,30'), null);
  assert.equal(splitLocation('120.13,999'), null);
});

test('parseBizExt: 提取 rating 与 open_time', () => {
  assert.deepEqual(parseBizExt(`{'rating':'4.4','cost':[],'open_time':'09:00-16:30'}`), {
    rating: 4.4,
    openTime: '09:00-16:30',
  });
});

test('parseBizExt: 空/畸形 → {}', () => {
  assert.deepEqual(parseBizExt(''), {});
  assert.deepEqual(parseBizExt('{}'), {});
  assert.deepEqual(parseBizExt('{'), {});
});

test('parseTelCell: 真实电话保留,空串/"[]"/"{}" → undefined', () => {
  assert.equal(parseTelCell('0571-85791266'), '0571-85791266');
  assert.equal(parseTelCell(' 0571-85791266 '), '0571-85791266'); // trim
  assert.equal(parseTelCell(''), undefined);
  assert.equal(parseTelCell('   '), undefined);
  assert.equal(parseTelCell('[]'), undefined); // 源 CSV 空电话字面量(实测 69.3% 行)
  assert.equal(parseTelCell('{}'), undefined);
  assert.equal(parseTelCell(undefined), undefined);
});

test('cleanCsvRow: 真实杭州行全字段', () => {
  const raw = {
    id: 'B0FFHF120D',
    name: '杭州印象西湖山水实景演出',
    address: '北山路82号',
    tel: '0571-85791266',
    rating: '4.4',
    cost: '[]',
    biz_ext: `{'rating':'4.4','cost':[]}`,
    location: '120.135687,30.251276',
    lon_gcj02: '120.135687',
    lat_gcj02: '30.251276',
    lon_wgs84: '120.1291153',
    lat_wgs84: '30.25435156',
    typecode: '220104',
    bigType: '事件活动',
    midType: '公众活动',
    smallType: '文艺演出',
    adname: '西湖区',
    business_area: '西湖',
    photos: `[{'title':[],'url':'http://store.is.autonavi.com/showpic/af709cff','provider':[]}]`,
  };
  const row = cleanCsvRow(raw);
  assert.ok(row);
  assert.equal(row.poi_id, 'B0FFHF120D');
  assert.equal(row.name, '杭州印象西湖山水实景演出');
  assert.equal(row.rating, 4.4);
  assert.equal(row.cost, undefined); // '[]' → 弃
  assert.equal(row.tel, '0571-85791266');
  assert.equal(row.lngGcj, 120.135687);
  assert.equal(row.latGcj, 30.251276);
  assert.equal(row.lonWgs84, 120.1291153);
  assert.equal(row.bigType, '事件活动');
  assert.equal(row.midType, '公众活动');
  assert.equal(row.adname, '西湖区');
  assert.deepEqual(row.photos, ['http://store.is.autonavi.com/showpic/af709cff']);
});

test('cleanCsvRow: rating "[]" → undefined,biz_ext rating 兜底', () => {
  const raw = {
    id: 'X1',
    name: '测试',
    rating: '[]',
    biz_ext: `{'rating':'3.1'}`,
    location: '120.1,30.2',
    lon_wgs84: '120.1',
    lat_wgs84: '30.2',
    bigType: '餐饮服务',
    adname: '上城区',
  };
  const row = cleanCsvRow(raw);
  assert.ok(row);
  assert.equal(row.rating, 3.1);
});

test('cleanCsvRow: tel "[]"/空 → undefined,真实电话保留', () => {
  const base = {
    id: 'X2',
    name: '测试',
    location: '120.1,30.2',
    lon_wgs84: '120.1',
    lat_wgs84: '30.2',
    bigType: '餐饮服务',
    adname: '上城区',
  };
  const r1 = cleanCsvRow({ ...base, tel: '[]' });
  assert.ok(r1);
  assert.equal(r1.tel, undefined); // 源 CSV 空电话字面量 → 不入库
  const r2 = cleanCsvRow({ ...base, tel: '' });
  assert.ok(r2);
  assert.equal(r2.tel, undefined);
  const r3 = cleanCsvRow({ ...base, tel: '0571-85791266' });
  assert.ok(r3);
  assert.equal(r3.tel, '0571-85791266');
});

test('cleanCsvRow: 必填缺失 → null', () => {
  assert.equal(cleanCsvRow({ name: 'x', location: '120,30', lon_wgs84: '120', lat_wgs84: '30', bigType: 'a', adname: 'b' }), null); // 缺 id
  assert.equal(cleanCsvRow({ id: 'x', location: '120,30', lon_wgs84: '120', lat_wgs84: '30', bigType: 'a', adname: 'b' }), null); // 缺 name
  assert.equal(cleanCsvRow({ id: 'x', name: 'y', location: 'bad', lon_wgs84: '120', lat_wgs84: '30', bigType: 'a', adname: 'b' }), null); // 坐标非法
  assert.equal(cleanCsvRow({ id: 'x', name: 'y', location: '120,30', lon_wgs84: 'bad', lat_wgs84: '30', bigType: 'a', adname: 'b' }), null); // wgs 缺
  assert.equal(cleanCsvRow({ id: 'x', name: 'y', location: '120,30', lon_wgs84: '120', lat_wgs84: '30', adname: 'b' }), null); // 缺 bigType
  assert.equal(cleanCsvRow({ id: 'x', name: 'y', location: '120,30', lon_wgs84: '120', lat_wgs84: '30', bigType: 'a' }), null); // 缺 adname
});

test('tierForCategory: 地标永显 / 噪声永隐', () => {
  assert.equal(tierForCategory('风景名胜'), 0);
  assert.equal(tierForCategory('科教文化服务'), 0);
  assert.equal(tierForCategory('政府机构及社会团体'), 2);
  assert.equal(tierForCategory('交通设施服务'), 3);
  assert.equal(tierForCategory('购物服务'), 5);
  assert.equal(tierForCategory('公司企业'), 5);
  assert.equal(tierForCategory('餐饮服务'), 10);
  assert.equal(tierForCategory('地名地址信息'), 21); // 噪声
  assert.equal(tierForCategory('通行设施'), 21);
  assert.equal(tierForCategory('虚拟数据'), 21);
  assert.equal(tierForCategory('事件活动'), 21);
});

test('inHangzhouBox: 框内/框外', () => {
  assert.equal(inHangzhouBox({ lng: 120.15, lat: 30.27 }), true); // 西湖区
  assert.equal(inHangzhouBox({ lng: 119.0, lat: 29.5 }), true); // 淳安县
  assert.equal(inHangzhouBox({ lng: 121.4, lat: 31.2 }), false); // 上海
  assert.equal(inHangzhouBox({ lng: 116.4, lat: 39.9 }), false); // 北京
  assert.equal(inHangzhouBox({ lng: 120.15, lat: 26.0 }), false); // 纬度过低
});

test('HANGZHOU_BBOX 覆盖数据实际范围', () => {
  assert.ok(HANGZHOU_BBOX.west <= 118.3556);
  assert.ok(HANGZHOU_BBOX.east >= 120.7029);
  assert.ok(HANGZHOU_BBOX.south <= 29.1954);
  assert.ok(HANGZHOU_BBOX.north >= 30.5594);
});
