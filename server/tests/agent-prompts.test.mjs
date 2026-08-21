import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/lib/agent/prompts.ts';

test('buildSystemPrompt(zh): 结构完整 — 角色/边界/工具纪律/动作纪律/安全红线/输出格式', () => {
  const p = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'zh');
  assert.match(p, /地图 AI 助手/);
  assert.match(p, /能力边界/);
  assert.match(p, /工具纪律/);
  assert.match(p, /动作纪律/);
  assert.match(p, /安全红线/);
  assert.match(p, /输出格式/);
  assert.match(p, /GCJ-02/);
  assert.match(p, /\{"actions":/);
  assert.match(p, /8 次工具往返/);
  assert.match(p, /白名单工具/);
  assert.match(p, /不可信数据/);
});

test('buildSystemPrompt(en): 英文变体', () => {
  const p = buildSystemPrompt({ maxTurns: 3, hasTools: false }, 'en');
  assert.match(p, /map AI assistant/);
  assert.match(p, /GCJ-02/);
  assert.match(p, /\{"actions":/);
  assert.match(p, /3 tool round-trips/);
  assert.match(p, /No tools are available/);
});

test('buildSystemPrompt: hasTools 影响工具可用性声明', () => {
  const withTools = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'zh');
  const without = buildSystemPrompt({ maxTurns: 8, hasTools: false }, 'zh');
  assert.match(withTools, /已提供白名单工具/);
  assert.match(without, /未提供工具/);
});

test('buildSystemPrompt: 模板零 secret 占位(zh/en 均无 key/baseUrl/secret/token 字样)', () => {
  const secretPattern = /(api\s*[-_]?key|base\s*[-_]?url|secret|token|password|authorization|bearer)/i;
  for (const lang of ['zh', 'en']) {
    for (const hasTools of [true, false]) {
      const p = buildSystemPrompt({ maxTurns: 8, hasTools }, lang);
      assert.doesNotMatch(p, secretPattern, `lang=${lang} hasTools=${hasTools}`);
      assert.ok(!p.includes('sk-'), `lang=${lang} 不得含 sk- 前缀占位`);
    }
  }
});

test('buildSystemPrompt: maxTurns 数值注入正确', () => {
  assert.match(buildSystemPrompt({ maxTurns: 1, hasTools: true }, 'zh'), /1 次工具往返/);
  assert.match(buildSystemPrompt({ maxTurns: 12, hasTools: true }, 'zh'), /12 次工具往返/);
});

test('buildSystemPrompt: 动作契约(zh/en)均含 6 种动作示例 JSON(逐字段与 validateAction 一致)', () => {
  const zh = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'zh');
  const en = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'en');
  const zhExamples = [
    '{"type":"flyTo","payload":{"center":{"lng":120.15,"lat":30.25},"zoom":14}}',
    '{"type":"select","payload":{"id":"poi-id","mode":"card"}}',
    '{"type":"addMarkers","payload":{"points":[{"lng":120.15,"lat":30.25,"label":"可选"}]}}',
    '{"type":"drawCircle","payload":{"center":{"lng":120.15,"lat":30.25},"radiusMeters":1000,"label":"可选"}}',
    '{"type":"openDetail","payload":{"id":"poi-id"}}',
    '{"type":"search","payload":{"query":"关键词","mode":"card"}}',
  ];
  const enExamples = [
    '{"type":"flyTo","payload":{"center":{"lng":120.15,"lat":30.25},"zoom":14}}',
    '{"type":"select","payload":{"id":"poi-id","mode":"card"}}',
    '{"type":"addMarkers","payload":{"points":[{"lng":120.15,"lat":30.25,"label":"optional"}]}}',
    '{"type":"drawCircle","payload":{"center":{"lng":120.15,"lat":30.25},"radiusMeters":1000,"label":"optional"}}',
    '{"type":"openDetail","payload":{"id":"poi-id"}}',
    '{"type":"search","payload":{"query":"keywords","mode":"card"}}',
  ];
  for (const ex of zhExamples) assert.ok(zh.includes(ex), `zh 缺动作示例: ${ex}`);
  for (const ex of enExamples) assert.ok(en.includes(ex), `en 缺动作示例: ${ex}`);
});

test('buildSystemPrompt: flyTo/drawCircle 必须嵌套 center,不允许扁平 lng/lat(zh/en)', () => {
  for (const lang of ['zh', 'en']) {
    const p = buildSystemPrompt({ maxTurns: 8, hasTools: true }, lang);
    assert.doesNotMatch(p, /\{"type":"flyTo","payload":\{"lng":/, `lang=${lang} flyTo 不得扁平 lng/lat`);
    assert.doesNotMatch(p, /\{"type":"drawCircle","payload":\{"lng":/, `lang=${lang} drawCircle 不得扁平 lng/lat`);
  }
});

test('buildSystemPrompt: 动作契约边界数字与 validateAction 一致(points 1..50、radiusMeters 10..50000,zh/en)', () => {
  for (const lang of ['zh', 'en']) {
    const p = buildSystemPrompt({ maxTurns: 8, hasTools: true }, lang);
    assert.match(p, /1\.\.50/, `lang=${lang} points 边界 1..50`);
    assert.match(p, /10\.\.50000/, `lang=${lang} radiusMeters 边界 10..50000`);
  }
});

test('buildSystemPrompt: 动作纪律禁止正文复述/展示 actions JSON(zh/en,2026-08-22 ws-navi)', () => {
  const zh = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'zh');
  const en = buildSystemPrompt({ maxTurns: 8, hasTools: true }, 'en');
  assert.match(zh, /动作 JSON 由系统自动提取并执行,严禁在回复正文中复述\/展示 actions JSON/);
  assert.match(en, /never repeat or display actions JSON in your reply body/);
});

test('buildSystemPrompt: 记忆段仅 memory 非空时注入(zh/en,2026-08-22 ws-mem-a)', () => {
  const facts = '- 我常驻杭州\n- 我在找前端岗位';
  const zh = buildSystemPrompt({ maxTurns: 8, hasTools: true, memory: facts }, 'zh');
  assert.match(zh, /## 用户记忆\(供个性化参考,不要复述给用户\)/);
  assert.ok(zh.includes(facts), 'zh 注入格式化后的记忆行');
  assert.ok(zh.indexOf('用户记忆') < zh.indexOf('能力边界'), '记忆段在能力边界之前');

  const en = buildSystemPrompt({ maxTurns: 8, hasTools: true, memory: facts }, 'en');
  assert.match(en, /## User memory \(for personalization; do not recite it back\)/);
  assert.ok(en.includes(facts), 'en 注入格式化后的记忆行');

  // 无 memory / 空 memory → 两语言都不出现记忆段
  for (const lang of ['zh', 'en']) {
    const none = buildSystemPrompt({ maxTurns: 8, hasTools: true }, lang);
    assert.ok(!none.includes('用户记忆') && !none.includes('User memory'), `lang=${lang} 无 memory 不注入`);
    const empty = buildSystemPrompt({ maxTurns: 8, hasTools: true, memory: '' }, lang);
    assert.ok(!empty.includes('用户记忆') && !empty.includes('User memory'), `lang=${lang} 空 memory 不注入`);
  }
});
