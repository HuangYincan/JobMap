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
