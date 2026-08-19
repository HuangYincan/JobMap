// city-cluster:城市聚合纯函数 + 聚合徽章构造契约(tech/21,zoom ≤ 8)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLUSTER_DRILL_ZOOM,
  CLUSTER_MAX_ZOOM,
  clusterCities,
  poiCity,
} from '../src/lib/city-cluster.ts';
import {
  CLUSTER_BADGE_SIZE,
  cityClusterBadgeHTML,
  createCityClusterMarker,
} from '../src/lib/map-markers.ts';

/** 构造 recruitment POI(sites[0] 携带城市)。location 可传 null 模拟无坐标。 */
function workPoi(id, city, lng, lat) {
  const location = lng === null || lat === null ? { lng: NaN, lat: NaN, address: '' } : { lng, lat, address: '' };
  return {
    id,
    kind: 'recruitment',
    mode: 'work',
    source: 'api',
    name: id,
    location,
    company: { name: id, industries: [], scale: 'startup' },
    sites: [{ id: `${id}-site`, name: id, city, location }],
    positions: [],
  };
}

function domainPoi(id) {
  return {
    id,
    kind: 'domain',
    mode: 'domain',
    source: 'api',
    name: id,
    location: { lng: 120.15, lat: 30.27, address: '' },
    category: '公司企业',
  };
}

test('clusterCities: zoom > CLUSTER_MAX_ZOOM(8) 返回 null(个体 pin)', () => {
  const pois = [workPoi('a', '北京', 116.4, 39.9)];
  for (const zoom of [9, 11, 13, 20]) {
    assert.equal(clusterCities(pois, zoom), null, `zoom=${zoom}`);
  }
});

test('clusterCities: zoom <= 8 启用聚合(边界 8 聚合)', () => {
  const pois = [workPoi('a', '北京', 116.4, 39.9)];
  for (const zoom of [0, 5, 8]) {
    const groups = clusterCities(pois, zoom);
    assert.ok(Array.isArray(groups), `zoom=${zoom}`);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].city, '北京');
  }
});

test('clusterCities: 按 site.city 分组计数', () => {
  const pois = [
    workPoi('a', '北京', 116.4, 39.9),
    workPoi('b', '北京', 116.5, 39.95),
    workPoi('c', '北京', 116.6, 40.0),
    workPoi('d', '杭州', 120.1, 30.25),
    workPoi('e', '杭州', 120.2, 30.3),
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 2);
  // 数量降序:北京 3 > 杭州 2
  assert.deepEqual(
    groups.map((g) => [g.city, g.count]),
    [['北京', 3], ['杭州', 2]],
  );
});

test('clusterCities: 中心点 = 组内 pin 坐标均值', () => {
  const pois = [
    workPoi('a', '北京', 116.0, 40.0),
    workPoi('b', '北京', 116.4, 40.1),
    workPoi('c', '北京', 116.6, 40.0),
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 1);
  assert.ok(Math.abs(groups[0].lng - (116.0 + 116.4 + 116.6) / 3) < 1e-9);
  assert.ok(Math.abs(groups[0].lat - (40.0 + 40.1 + 40.0) / 3) < 1e-9);
});

test('clusterCities: 无 city 的 pin 不聚合、不计入', () => {
  const pois = [
    workPoi('a', '北京', 116.4, 39.9),
    workPoi('b', '  ', 117.0, 39.0), // 空白 city
    { ...workPoi('c', '北京', 116.5, 39.95), sites: [] }, // 无 sites
    { ...workPoi('d', '北京', 116.6, 40.0), sites: undefined }, // sites 缺失
    { ...workPoi('e', '北京', 116.7, 40.1), sites: [{ id: 'e-site', name: 'e' }] }, // site 无 city
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].city, '北京');
  assert.equal(groups[0].count, 1); // 只有 a 有 city
});

test('clusterCities: 无合法坐标的 pin 计入数量但不参与中心均值;组内全无坐标则省略', () => {
  const pois = [
    workPoi('a', '北京', 116.4, 39.9),
    workPoi('b', '北京', null, null), // 无坐标:计入 count,不进均值
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].lng, 116.4);
  assert.equal(groups[0].lat, 39.9);

  const allBroken = clusterCities([workPoi('c', '北京', null, null)], 5);
  assert.deepEqual(allBroken, []); // 无法定位徽章 → 组省略
});

test('clusterCities: 非 work 上下文(纯 domain / 空列表)返回 null', () => {
  assert.equal(clusterCities([domainPoi('x'), domainPoi('y')], 5), null);
  assert.equal(clusterCities([], 5), null);
  // 非法 zoom 也返回 null
  assert.equal(clusterCities([workPoi('a', '北京', 116.4, 39.9)], NaN), null);
});

test('clusterCities: 输出顺序确定(数量降序,数量相同按城市名升序)', () => {
  const pois = [
    workPoi('a', '深圳', 114.0, 22.5),
    workPoi('b', '上海', 121.4, 31.2),
    workPoi('c', '杭州', 120.1, 30.25),
    workPoi('d', '上海', 121.5, 31.25),
    workPoi('e', '深圳', 114.1, 22.55),
    workPoi('f', '北京', 116.4, 39.9),
  ];
  const groups = clusterCities(pois, 5);
  assert.deepEqual(
    groups.map((g) => g.city),
    ['上海', '深圳', '北京', '杭州'], // 2,2,1,1;同数按拼音
  );
});

test('poiCity: 一 POI 一职场,取 sites[0].city 并 trim;无则 undefined', () => {
  assert.equal(poiCity(workPoi('a', ' 北京 ', 116.4, 39.9)), '北京');
  assert.equal(poiCity({ ...workPoi('b', '北京', 116.4, 39.9), sites: [] }), undefined);
  assert.equal(poiCity(domainPoi('x')), undefined);
});

test('常量:CLUSTER_MAX_ZOOM=8 / CLUSTER_DRILL_ZOOM=11(用户批准阈值)', () => {
  assert.equal(CLUSTER_MAX_ZOOM, 8);
  assert.equal(CLUSTER_DRILL_ZOOM, 11);
});

// ---- 聚合徽章构造契约(map-markers 扩展,不侵入 controller)----

test('cityClusterBadgeHTML: 白底 + 品牌蓝描边 + 「城市名 N」(圆形由 dm-cluster 样式类承担)', () => {
  const html = cityClusterBadgeHTML({ city: '北京', count: 12 });
  assert.ok(html.includes('class="dm-cluster"')); // 圆形/白底/描边样式类契约
  assert.ok(html.includes('#007AFF')); // 缺省品牌蓝
  assert.ok(html.includes('北京'));
  assert.ok(html.includes('12'));
  assert.ok(html.includes(`width:${CLUSTER_BADGE_SIZE}px`));
  assert.ok(html.includes(`height:${CLUSTER_BADGE_SIZE}px`));
});

test('cityClusterBadgeHTML: 自定义强调色 + 尺寸 + 城市名转义', () => {
  const html = cityClusterBadgeHTML({ city: '北京<城>', count: 3 }, '#FF6B35', 64);
  assert.ok(html.includes('border-color:#FF6B35'));
  assert.ok(html.includes('color:#FF6B35'));
  assert.ok(html.includes('width:64px'));
  assert.ok(html.includes('北京&lt;城&gt;')); // HTML 转义,防注入
  assert.ok(!html.includes('北京<城>'));
});

test('createCityClusterMarker: 构造契约(位置/中心锚定/点击回调/防御守卫)', () => {
  const created = [];
  const amap = {
    Marker: class {
      constructor(opts) {
        this.opts = opts;
        this.handlers = {};
        created.push(this);
      }
      on(event, fn) {
        this.handlers[event] = fn;
      }
    },
    Pixel: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
  };
  const map = {};

  let clicks = 0;
  const group = { city: '杭州', count: 15, lng: 120.15, lat: 30.27 };
  const marker = createCityClusterMarker(amap, map, group, {
    color: '#007AFF',
    onClick: () => {
      clicks += 1;
    },
  });

  assert.ok(marker);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].opts.position, [120.15, 30.27]);
  assert.equal(created[0].opts.offset.x, -CLUSTER_BADGE_SIZE / 2); // 中心锚定
  assert.equal(created[0].opts.offset.y, -CLUSTER_BADGE_SIZE / 2);
  assert.equal(created[0].opts.map, map);
  assert.equal(created[0].opts.bubble, false); // 点击不冒泡到地图
  assert.ok(created[0].opts.content.includes('杭州'));
  assert.ok(created[0].opts.content.includes('15'));

  created[0].handlers.click();
  assert.equal(clicks, 1);

  // 防御守卫:无 amap / 无 map / 构造抛错 → null 不抛
  assert.equal(createCityClusterMarker(null, map, group), null);
  assert.equal(createCityClusterMarker(amap, null, group), null);
  const brokenAmap = { Marker: class { constructor() { throw new Error('boom'); } }, Pixel: class {} };
  assert.equal(createCityClusterMarker(brokenAmap, map, group), null);
});
