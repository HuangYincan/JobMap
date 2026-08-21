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

/** 构造 recruitment POI(sites[0] 携带城市)。location 可传 null 模拟无坐标。
 *  tier 缺省 0(永显)——旧用例不显式传 tier 时保持「任意 zoom 可见」语义。 */
function workPoi(id, city, lng, lat, tier = 0) {
  const location = lng === null || lat === null ? { lng: NaN, lat: NaN, address: '' } : { lng, lat, address: '' };
  return {
    id,
    kind: 'recruitment',
    mode: 'work',
    source: 'api',
    name: id,
    location,
    company: { name: id, industries: [], scale: 'startup', tier },
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

test('clusterCities: 命中静态城市中心 → 锚点取行政中心(非 pin 均值)', () => {
  const pois = [
    workPoi('a', '北京', 116.0, 40.0),
    workPoi('b', '北京', 116.4, 40.1),
    workPoi('c', '北京', 116.6, 40.0),
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 1);
  // 已知城市走静态中心(115.9x, 39.9x),不再等于 3 个 pin 的算术均值
  assert.equal(groups[0].lng, 116.4);
  assert.equal(groups[0].lat, 39.9);
});

test('clusterCities: 未命中静态城市中心 → 回退组内 pin 坐标均值(确定性不变)', () => {
  const pois = [
    workPoi('a', '哈尔滨', 126.5, 45.7),
    workPoi('b', '哈尔滨', 126.7, 45.9),
    workPoi('c', '哈尔滨', 126.9, 46.1),
  ];
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].city, '哈尔滨');
  assert.ok(Math.abs(groups[0].lng - (126.5 + 126.7 + 126.9) / 3) < 1e-9);
  assert.ok(Math.abs(groups[0].lat - (45.7 + 45.9 + 46.1) / 3) < 1e-9);
});

test('clusterCities: 带「市」后缀的城市名同样命中静态中心(裸名归一)', () => {
  const groups = clusterCities([workPoi('a', '北京市', 116.2, 39.8)], 5);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lng, 116.4);
  assert.equal(groups[0].lat, 39.9);
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

// ---- 坐标↔标签防御(w1,2026-08-20:串味行剔除,成都假聚合根因)----

test('clusterCities: 剔除「city 标签与坐标参考框不符」的串味行(成都假聚合)', () => {
  const pois = [
    // 串味行:标签成都,坐标在杭州(DB 147 行/76 家,2026-08-19 数据修正已记 deferred)
    workPoi('fake-cd-1', '成都', 120.1, 30.25),
    workPoi('fake-cd-2', '成都', 120.2, 30.3),
    // 真实成都(坐标在成都参考框 103.7-104.6/30.3-31.1 内)
    workPoi('real-cd-1', '成都', 104.07, 30.67),
    workPoi('real-cd-2', '成都', 104.1, 30.65),
    // 真实杭州(不被误伤)
    workPoi('real-hz-1', '杭州', 120.15, 30.27),
    workPoi('real-hz-2', '杭州', 120.25, 30.3),
    // 串味行:标签深圳,坐标在杭州(同样被剔除)
    workPoi('fake-sz', '深圳', 120.18, 30.28),
  ];
  const groups = clusterCities(pois, 5);
  assert.deepEqual(
    groups.map((g) => [g.city, g.count]),
    [['成都', 2], ['杭州', 2]],
  );
});

test('clusterCities: 串味防御覆盖深圳/北京/上海/广州/武汉(参考框收录城市)', () => {
  const hangzhouCoords = [120.15, 30.25];
  const cities = [
    ['深圳', 114.05, 22.55],
    ['北京', 116.4, 39.9],
    ['上海', 121.47, 31.23],
    ['广州', 113.26, 23.13],
    ['武汉', 114.31, 30.59],
    ['成都', 104.07, 30.67],
  ];
  const pois = cities.flatMap(([city, lng, lat]) => [
    workPoi(`${city}-fake`, city, ...hangzhouCoords), // 串味:坐标在杭州 → 剔除
    workPoi(`${city}-real`, city, lng, lat), // 真实坐标 → 保留
  ]);
  const groups = clusterCities(pois, 5);
  assert.equal(groups.length, cities.length);
  for (const group of groups) {
    assert.equal(group.count, 1, `${group.city} 徽章只含真实坐标行`);
  }
});

test('clusterCities: 参考框未收录城市 / 坐标缺失的 POI 放行(不误杀)', () => {
  const pois = [
    workPoi('a', '哈尔滨', 126.5, 45.7), // 参考框未收录 → 放行
    workPoi('b', '北京', null, null), // 已知城市但无坐标 → 防御放行,仍计入
    workPoi('b2', '北京', 116.4, 39.9), // 同组有合法坐标 → 徽章可定位
  ];
  const groups = clusterCities(pois, 5);
  assert.deepEqual(
    groups.map((g) => [g.city, g.count]),
    [['北京', 2], ['哈尔滨', 1]],
  );
});

// ---- 聚合计数与 LOD 无关(2026-08-20 修订:取消 zoom<8 的 POI 消失规则)----

test('clusterCities: 徽章计数不随 zoom 变化——tier 过滤只属个体 pin(zoom>8)', () => {
  const pois = [
    workPoi('t4', '杭州', 120.1, 30.25, 4),
    workPoi('t5', '杭州', 120.2, 30.3, 5),
    workPoi('t6', '杭州', 120.3, 30.35, 6),
    workPoi('t8', '杭州', 120.4, 30.4, 8),
    workPoi('t9', '杭州', 120.5, 30.45, 9),
    workPoi('t13', '杭州', 120.6, 30.5, 13),
  ];
  // 聚合区间(zoom <= 8)内计数与 tier 无关:任何 zoom 都是全量 6
  for (const zoom of [0, 4, 5, 6, 8]) {
    const groups = clusterCities(pois, zoom);
    assert.equal(groups.find((g) => g.city === '杭州').count, 6, `zoom=${zoom}`);
  }
  assert.equal(clusterCities(pois, 9), null); // zoom > 8 聚合关闭
});

test('clusterCities: 计数 = 池内容——全量池(无 tier 裁剪)下与 zoom/导航历史无关', () => {
  // 池 A:仅低 tier 行;池 B:全 tier 残留(全量加载后的真实形态)
  const poolA = [
    workPoi('hz-1', '杭州', 120.1, 30.25, 2),
    workPoi('hz-2', '杭州', 120.2, 30.3, 5),
  ];
  const poolB = [
    ...poolA,
    workPoi('hz-3', '杭州', 120.3, 30.35, 6),
    workPoi('hz-4', '杭州', 120.4, 30.4, 9),
    workPoi('hz-5', '杭州', 120.5, 30.45, 13),
    workPoi('cd-1', '成都', 104.07, 30.67, 7),
  ];
  const countHz = (groups) => groups.find((g) => g.city === '杭州').count;
  // 徽章数 = 该城在池中的行数,不再被 tier 阈值裁掉:
  // 池 A 在 zoom 5/8 都是 2,池 B 都是 5——缩放不改变计数
  assert.equal(countHz(clusterCities(poolA, 5)), 2);
  assert.equal(countHz(clusterCities(poolB, 5)), 5);
  assert.equal(countHz(clusterCities(poolB, 8)), 5);
});

test('clusterCities: 未打标公司(tier 缺省 12)计入徽章', () => {
  const noTier = workPoi('no-tier', '杭州', 120.1, 30.25);
  delete noTier.company.tier; // 未打标 → 缺省 TIER_DEFAULT=12
  assert.deepEqual(
    clusterCities([noTier], 8).map((g) => [g.city, g.count]),
    [['杭州', 1]],
  );
});

test('clusterCities: 「杭州市」与「杭州」站点归入同一徽章(裸城名分组)', () => {
  const pois = [
    workPoi('hz-shang', '杭州市', 120.15, 30.27, 6),
    workPoi('hz-bare', '杭州', 120.2, 30.3, 6),
    workPoi('bj', '北京市', 116.4, 39.9, 6),
  ];
  const groups = clusterCities(pois, 8);
  assert.deepEqual(
    groups.map((g) => [g.city, g.count]),
    [['杭州', 2], ['北京', 1]],
  );
  // 徽章标签用裸城名(与 cityCenter 锚点命中同口径)
  const hz = groups.find((g) => g.city === '杭州');
  assert.equal(hz.lng, 120.15); // 命中杭州静态行政中心
  assert.equal(hz.lat, 30.27);
});

// ---- 贝达药业(2026-08-20 修订:tier 6 在 zoom<=8 全区间计入)----

test('clusterCities: betta-hangzhou(杭州临平 120.258/30.438, tier 6)在 zoom<=8 全区间出现于「杭州」徽章', () => {
  const betta = {
    id: 'betta-hangzhou',
    kind: 'recruitment',
    mode: 'work',
    source: 'api',
    name: '贝达药业',
    location: { lng: 120.258, lat: 30.438, address: '临平区兴中路355号' },
    company: {
      name: '贝达药业',
      industries: ['biotech'],
      scale: 'enterprise',
      tier: 6,
    },
    sites: [
      {
        id: 'betta-hangzhou-site',
        name: '贝达药业',
        city: '杭州',
        location: { lng: 120.258, lat: 30.438, address: '临平区兴中路355号' },
      },
    ],
    positions: [{ id: 'betta-ra', title: '临床研究助理实习生', type: 'intern', status: 'open' }],
  };
  for (const zoom of [0, 5, 6, 7, 8]) {
    const groups = clusterCities([betta], zoom);
    assert.equal(groups.length, 1, `zoom=${zoom}`);
    assert.equal(groups[0].city, '杭州');
    assert.equal(groups[0].count, 1);
    assert.equal(groups[0].lng, 120.15); // 命中杭州静态行政中心
    assert.equal(groups[0].lat, 30.27);
  }
  // 串味混池:贝达坐标(杭州框内)+ 同坐标标签成都 → 只留杭州,成都徽章消失
  const mixed = clusterCities(
    [
      betta,
      workPoi('fake-cd', '成都', 120.258, 30.438, 6),
    ],
    7,
  );
  assert.deepEqual(
    mixed.map((g) => [g.city, g.count]),
    [['杭州', 1]],
  );
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

test('createCityClusterMarker: 构造契约(位置/中心锚定/点击回调/防御守卫,ws-c view 形态)', () => {
  const created = [];
  // duck-type MapView:createMarker 构造即登记,返回 wrapper(raw = marker);
  // onClick 经 marker 'click' 事件接线(与引擎适配器 createMarker 同语义)
  const view = {
    engine: { namespace: 'AMap', id: 'amap' },
    createMarker(opts) {
      const marker = {
        opts,
        handlers: {},
        on(event, fn) {
          this.handlers[event] = fn;
        },
        setMap() {},
      };
      if (typeof opts.onClick === 'function') marker.on('click', opts.onClick);
      created.push(marker);
      return { raw: marker, setPosition() {}, setContent() {}, remove() {} };
    },
  };

  let clicks = 0;
  const group = { city: '杭州', count: 15, lng: 120.15, lat: 30.27 };
  const marker = createCityClusterMarker(view, group, {
    color: '#007AFF',
    onClick: () => {
      clicks += 1;
    },
  });

  assert.ok(marker);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].opts.position, { lng: 120.15, lat: 30.27 });
  // 中心锚定:offset 元组 → 引擎适配器内部转 AMap.Pixel
  assert.deepEqual(created[0].opts.offset, [-CLUSTER_BADGE_SIZE / 2, -CLUSTER_BADGE_SIZE / 2]);
  assert.equal(created[0].opts.zIndex, 50);
  assert.equal(created[0].opts.bubble, false); // 点击不冒泡到地图(duck-type 透传)
  assert.ok(created[0].opts.content.includes('杭州'));
  assert.ok(created[0].opts.content.includes('15'));

  created[0].handlers.click();
  assert.equal(clicks, 1);

  // 防御守卫:无 view / createMarker 构造抛错 → null 不抛
  assert.equal(createCityClusterMarker(null, group), null);
  const broken = {
    engine: { namespace: 'AMap', id: 'amap' },
    createMarker() {
      throw new Error('boom');
    },
  };
  assert.equal(createCityClusterMarker(broken, group), null);
});
