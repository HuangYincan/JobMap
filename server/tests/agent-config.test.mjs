import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBaiduAgentPlan, readAgentConfig } from '../src/lib/agent/config.ts';

const ALL_KEYS = [
  'AGENT_LLM_BASE_URL',
  'AGENT_LLM_API_KEY',
  'AGENT_LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'AGENT_MAX_TOOL_TURNS',
  'AGENT_HISTORY_LIMIT',
  'BAIDU_MAP_AUTH_TOKEN',
];

function withEnv(env, fn) {
  const saved = new Map();
  for (const k of ALL_KEYS) {
    saved.set(k, process.env[k]);
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('readAgentConfig: AGENT_LLM_* 优先于 LLM_*', () => {
  withEnv(
    {
      AGENT_LLM_BASE_URL: 'https://agent.example.com/v1',
      AGENT_LLM_API_KEY: 'sk-agent',
      AGENT_LLM_MODEL: 'agent-model',
      LLM_BASE_URL: 'https://llm.example.com/v1',
      LLM_API_KEY: 'sk-llm',
      LLM_MODEL: 'llm-model',
    },
    () => {
      const r = readAgentConfig();
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.equal(r.cfg.baseUrl, 'https://agent.example.com/v1');
        assert.equal(r.cfg.apiKey, 'sk-agent');
        assert.equal(r.cfg.model, 'agent-model');
      }
    },
  );
});

test('readAgentConfig: 仅 LLM_* 时回退', () => {
  withEnv({ LLM_BASE_URL: 'https://llm.example.com/v1', LLM_API_KEY: 'sk-llm', LLM_MODEL: 'llm-model' }, () => {
    const r = readAgentConfig();
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.cfg.baseUrl, 'https://llm.example.com/v1');
      assert.equal(r.cfg.apiKey, 'sk-llm');
      assert.equal(r.cfg.model, 'llm-model');
    }
  });
});

test('readAgentConfig: 全缺 → ok:false 且 reason 含缺失变量名(不含任何值)', () => {
  withEnv({}, () => {
    const r = readAgentConfig();
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /AGENT_LLM_BASE_URL/);
      assert.match(r.reason, /AGENT_LLM_API_KEY/);
      assert.match(r.reason, /AGENT_LLM_MODEL/);
      assert.ok(!r.reason.includes('sk-'));
    }
  });
});

test('readAgentConfig: 部分缺失(只有 baseUrl) → ok:false', () => {
  withEnv({ LLM_BASE_URL: 'https://llm.example.com/v1' }, () => {
    const r = readAgentConfig();
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /API_KEY/);
  });
});

test('readAgentConfig: AGENT_MAX_TOOL_TURNS 默认 8,非法值回退默认', () => {
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxTurns, 8);
  });
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm', AGENT_MAX_TOOL_TURNS: '3' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxTurns, 3);
  });
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm', AGENT_MAX_TOOL_TURNS: 'abc' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxTurns, 8);
  });
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm', AGENT_MAX_TOOL_TURNS: '-2' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxTurns, 8);
  });
});

test('readAgentConfig: AGENT_HISTORY_LIMIT 默认 6000,自定义生效', () => {
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxHistoryChars, 6000);
  });
  withEnv({ LLM_BASE_URL: 'u', LLM_API_KEY: 'k', LLM_MODEL: 'm', AGENT_HISTORY_LIMIT: '10000' }, () => {
    assert.equal(readAgentConfig().ok && readAgentConfig().cfg.maxHistoryChars, 10000);
  });
});

test('hasBaiduAgentPlan: 缺失/空 → false;非空 → true', () => {
  withEnv({}, () => assert.equal(hasBaiduAgentPlan(), false));
  withEnv({ BAIDU_MAP_AUTH_TOKEN: '   ' }, () => assert.equal(hasBaiduAgentPlan(), false));
  withEnv({ BAIDU_MAP_AUTH_TOKEN: 't1.abc.def' }, () => assert.equal(hasBaiduAgentPlan(), true));
});
