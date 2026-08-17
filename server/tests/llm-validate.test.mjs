import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HttpError,
  aggregateTitleHints,
  buildValidationPrompt,
  callChatCompletionsJson,
  domainHint,
  extractDomain,
  isRetryableStatus,
  looksLikeRefusal,
  parseLlmVerdict,
  verdictLevel,
} from '../src/lib/llm-validate.ts';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PASS_VERDICT = {
  titleReal: true,
  isAggregateRow: false,
  suggestedSplit: [],
  companyPositionMatch: 'pass',
  companyCityMatch: 'pass',
  applyDomainMatch: 'pass',
  reason: '真实岗位,信息一致',
};

test('parseLlmVerdict: plain JSON', () => {
  const v = parseLlmVerdict(JSON.stringify(PASS_VERDICT));
  assert.ok(v);
  assert.equal(v.titleReal, true);
  assert.equal(v.companyPositionMatch, 'pass');
  assert.equal(v.reason, '真实岗位,信息一致');
});

test('parseLlmVerdict: JSON inside ```json fences', () => {
  const text = `好的,这是我的判定:\n\`\`\`json\n${JSON.stringify(PASS_VERDICT)}\n\`\`\`\n希望对你有帮助`;
  const v = parseLlmVerdict(text);
  assert.ok(v);
  assert.equal(v.titleReal, true);
});

test('parseLlmVerdict: JSON with surrounding prose', () => {
  const text = `分析:标题像真实岗位。${JSON.stringify(PASS_VERDICT)}。结论如上。`;
  const v = parseLlmVerdict(text);
  assert.ok(v);
  assert.equal(v.isAggregateRow, false);
});

test('parseLlmVerdict: broken JSON returns null', () => {
  assert.equal(parseLlmVerdict('{"titleReal": true, oops'), null);
  assert.equal(parseLlmVerdict(''), null);
  assert.equal(parseLlmVerdict('全部通过'), null);
});

test('parseLlmVerdict: refusal / off-topic returns null', () => {
  assert.equal(parseLlmVerdict('抱歉,我无法判断该信息。'), null);
  assert.equal(parseLlmVerdict('I cannot determine the truthfulness of this position.'), null);
  assert.equal(looksLikeRefusal('作为一个 AI 助手,我不能...'), true);
  assert.equal(looksLikeRefusal(JSON.stringify(PASS_VERDICT)), false);
});

test('parseLlmVerdict: verdict JSON wins even when reason sounds like a refusal', () => {
  // reason 字段含「无法/不能」是合法的 fail 判定,不得被拒答检测丢弃
  const v = parseLlmVerdict(JSON.stringify({ ...PASS_VERDICT, companyCityMatch: 'fail', reason: '无法确认该公司在该城市有办公点' }));
  assert.ok(v);
  assert.equal(v.companyCityMatch, 'fail');
  assert.equal(v.reason, '无法确认该公司在该城市有办公点');
});

test('parseLlmVerdict: missing / wrong-typed fields coerce to safe defaults', () => {
  const v = parseLlmVerdict('{"titleReal": "true", "isAggregateRow": "yes", "suggestedSplit": ["前端", 42, ""], "companyPositionMatch": 3}');
  assert.ok(v);
  assert.equal(v.titleReal, true);
  assert.equal(v.isAggregateRow, true);
  assert.deepEqual(v.suggestedSplit, ['前端']); // non-string / empty filtered
  assert.equal(v.companyPositionMatch, 'warn'); // invalid enum → warn, never invented fail
  assert.equal(v.applyDomainMatch, 'warn'); // missing field → warn
});

test('verdictLevel: fail dominates, aggregate is warn, warn dims warn', () => {
  assert.equal(verdictLevel({ ...PASS_VERDICT }), 'pass');
  assert.equal(verdictLevel({ ...PASS_VERDICT, titleReal: false }), 'fail');
  assert.equal(verdictLevel({ ...PASS_VERDICT, companyCityMatch: 'fail' }), 'fail');
  assert.equal(verdictLevel({ ...PASS_VERDICT, applyDomainMatch: 'fail' }), 'fail');
  assert.equal(verdictLevel({ ...PASS_VERDICT, isAggregateRow: true, suggestedSplit: ['算法工程师'] }), 'warn');
  assert.equal(verdictLevel({ ...PASS_VERDICT, companyPositionMatch: 'warn' }), 'warn');
});

test('aggregateTitleHints: aggregate rows detected', () => {
  // 商汤 radar drop 的真实聚合标题
  assert.ok(aggregateTitleHints('招聘方向：模型研究  AI  Infra   模型应用开发  FDE').length > 0);
  assert.ok(aggregateTitleHints('技术、设计、数据、运营、产品等七大类').length > 0);
  assert.ok(aggregateTitleHints('开发/算法/产品/运营').length > 0);
});

test('aggregateTitleHints: concrete titles not flagged', () => {
  assert.deepEqual(aggregateTitleHints('前端开发工程师（2026 秋招）'), []);
  assert.deepEqual(aggregateTitleHints('C++/Java 研发工程师'), []);
  assert.deepEqual(aggregateTitleHints('加入 DeepSeek（官方人才站）'), []); // 门户入口由 LLM 判 titleReal=false,非聚合行
  assert.deepEqual(aggregateTitleHints(''), []);
});

test('extractDomain: strips protocol and www', () => {
  assert.equal(extractDomain('https://www.deepseek.com/'), 'deepseek.com');
  assert.equal(extractDomain('https://hire-r1.mokahr.com/x/xyz'), 'hire-r1.mokahr.com');
  assert.equal(extractDomain('not a url'), '');
  assert.equal(extractDomain(undefined), '');
});

test('domainHint: known ATS hosts flagged', () => {
  assert.equal(domainHint('https://hire-r1.mokahr.com/x').knownAts, true);
  assert.equal(domainHint('https://talent.zhiye.com/apply').knownAts, true);
  assert.equal(domainHint('https://www.deepseek.com/').knownAts, false);
  assert.equal(domainHint('https://www.deepseek.com/').domain, 'deepseek.com');
});

test('buildValidationPrompt: only the single position leaves the module', () => {
  const company = {
    name: '深度求索',
    industries: ['ai'],
    sites: [{ id: 's1', name: '深度求索', location: { address: '拱墅区环城北路169号' } }],
    positions: [
      {
        externalId: 'p1',
        title: '前端开发工程师（2026 秋招）',
        siteId: 's1',
        family: 'campus',
        department: '应用工程',
        skills: ['TypeScript'],
        status: 'open',
        applyUrl: 'https://www.deepseek.com/',
      },
      {
        externalId: 'p2',
        title: '其他公司岗位标题-私密',
        siteId: 's1',
        family: 'campus',
        status: 'open',
        applyUrl: 'https://other.example.com/',
      },
    ],
  };
  const messages = buildValidationPrompt(company, company.sites[0], company.positions[0]);
  assert.ok(messages.user.includes('前端开发工程师'));
  assert.ok(messages.user.includes('深度求索'));
  assert.ok(messages.user.includes('https://www.deepseek.com/'));
  assert.ok(!messages.user.includes('其他公司岗位标题-私密'), '不得泄露同公司其他岗位');
  assert.ok(!messages.user.includes('other.example.com'), '不得泄露其他岗位的 applyUrl');
  assert.ok(messages.system.includes('isAggregateRow'));
});

test('callChatCompletionsJson: posts OpenAI-compatible body, returns content', async () => {
  const seen = {};
  const fakeFetch = async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.authorization;
    seen.body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PASS_VERDICT) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const content = await callChatCompletionsJson({
    baseUrl: 'https://llm.example.com/v1/',
    apiKey: 'sk-secret',
    model: 'test-model',
    messages: { system: 'sys', user: 'user' },
    fetchLike: fakeFetch,
  });
  assert.equal(seen.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(seen.auth, 'Bearer sk-secret');
  assert.equal(seen.body.model, 'test-model');
  assert.equal(seen.body.temperature, 0);
  assert.equal(seen.body.messages[0].role, 'system');
  assert.equal(seen.body.stream, false);
  assert.ok(parseLlmVerdict(content));
});

test('callChatCompletionsJson: non-2xx throws HttpError with status', async () => {
  const fakeFetch = async () => new Response('rate limited', { status: 429 });
  await assert.rejects(
    callChatCompletionsJson({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: { system: 's', user: 'u' },
      fetchLike: fakeFetch,
    }),
    (err) => err instanceof HttpError && err.status === 429,
  );
});

test('callChatCompletionsJson: empty content throws', async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
  await assert.rejects(
    callChatCompletionsJson({
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
      model: 'm',
      messages: { system: 's', user: 'u' },
      fetchLike: fakeFetch,
    }),
  );
});

test('isRetryableStatus: 429 / 5xx / network retried; 400 permanent', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(undefined), true); // network error / timeout
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(422), false);
});

test('CLI dry-run without LLM keys: exits 0 and prints sample input', () => {
  const env = { ...process.env, LLM_API_KEY: '', LLM_MODEL: '', LLM_BASE_URL: '' };
  const res = spawnSync(process.execPath, ['scripts/validate-positions-llm.mjs'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /dry-run/);
  assert.match(res.stdout, /待验证 \d+ 条/);
  assert.match(res.stdout, /示例输入/);
  assert.ok(!res.stdout.includes('sk-'), '不得打印任何 key');
});

test('CLI --only filters to the given slugs (dry-run)', () => {
  const env = { ...process.env, LLM_API_KEY: '', LLM_MODEL: '', LLM_BASE_URL: '' };
  const res = spawnSync(process.execPath, ['scripts/validate-positions-llm.mjs', '--only', 'deepseek'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const lines = res.stdout.split('\n').filter((l) => l.includes('待验证'));
  assert.ok(lines.length === 1, `expected one 待验证 line, got: ${res.stdout}`);
  const n = Number(lines[0].match(/待验证 (\d+) 条/)?.[1]);
  assert.ok(Number.isFinite(n) && n > 0 && n <= 10, `deepseek drop should have a few positions, got ${n}`);
});
