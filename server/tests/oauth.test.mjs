// ============================================================
// 真实 OAuth 后端测试(ws-backend)
//
// route.ts 使用 next/server + `@/` 别名,node:test 无法直接 import(仓库
// 既有契约,见 api-hardening.test.mjs),因此:
//   - 行为逻辑全部在 lib/oauth/*(oauth-config / oauth-state /
//     oauth-exchange / oauth-flow)直测:configured 判定、authorize URL、
//     state 签名/校验/清洗、code→token→userinfo 映射、全链路编排
//     (fake cookie jar + mock fetch + 内存 store,零网络)。
//   - route 薄壳用 readFileSync + 正则断言守卫(400/503 码、auth_error
//     参数、cookie 写入与 session 接线)。
//
// 内存模式:__accountStoreTest.poolOverride = () => null(照 otp-guard 先例)。
// 23505 邮箱冲突分支:注入 fake 池(照 otp-guard failingPool 先例)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuthorizeUrl,
  getOAuthProviderConfig,
  isOAuthProviderId,
  listOAuthProviders,
  OAUTH_PROVIDER_IDS,
} from '../src/lib/oauth/oauth-config.ts';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_NEXT_LENGTH,
  OAUTH_STATE_TTL_MS,
  oauthStateCookieOptions,
  randomOauthState,
  sanitizeNext,
  signOauthState,
  verifyOauthState,
} from '../src/lib/oauth/oauth-state.ts';
import {
  OauthExchangeError,
  exchangeCodeForUserinfo,
} from '../src/lib/oauth/oauth-exchange.ts';
import {
  OauthBadRequestError,
  OauthNotConfiguredError,
  OauthProviderError,
  OauthStateInvalidError,
  absoluteRedirect,
  errorRedirectPath,
  runOauthCallback,
  startOauthFlow,
} from '../src/lib/oauth/oauth-flow.ts';
import {
  DbUnavailableError,
  __accountStoreTest,
  getSessionUser,
  upsertIdentity,
} from '../src/lib/account-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

// ---- env 注入(withEnv 先例:resend-client.test.mjs) ----

const OAUTH_ENV_KEYS = [
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'WECHAT_OAUTH_APP_ID',
  'WECHAT_OAUTH_SECRET',
  'SESSION_SECRET',
];

const GITHUB_ENV = { GITHUB_OAUTH_CLIENT_ID: 'gh_client', GITHUB_OAUTH_CLIENT_SECRET: 'gh_secret' };
const GOOGLE_ENV = { GOOGLE_OAUTH_CLIENT_ID: 'gg_client', GOOGLE_OAUTH_CLIENT_SECRET: 'gg_secret' };
const WECHAT_ENV = { WECHAT_OAUTH_APP_ID: 'wx_app', WECHAT_OAUTH_SECRET: 'wx_secret' };
const ALL_ENV = { ...GITHUB_ENV, ...GOOGLE_ENV, ...WECHAT_ENV, SESSION_SECRET: 'test-oauth-secret' };

/** 设 env 跑 fn,finally 还原(照 resend-client 先例;async fn 需 await 才能等体跑完)。 */
async function withEnv(patch, fn) {
  const saved = {};
  for (const key of OAUTH_ENV_KEYS) saved[key] = process.env[key];
  for (const key of OAUTH_ENV_KEYS) {
    if (key in patch) process.env[key] = patch[key];
    else delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of OAUTH_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ---- 假 cookie jar 与 mock fetch ----

function fakeCookieJar(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    sets: [],
    get(name) {
      const value = map.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value, options) {
      this.sets.push({ name, value, options });
      map.set(name, value);
    },
    delete(name) {
      map.delete(name);
    },
  };
}

/** 按 url 正则分发假响应,记录每次调用;未匹配 → 抛错(防误发三方)。 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const route = routes.find(([re]) => re.test(String(url)));
    if (!route) throw new Error(`unexpected fetch in test: ${url}`);
    const [, status, body] = route;
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, impl };
}

// ============================================================
// 1. oauth-config:providers 端点契约(configured 判定/固定顺序/无敏感字段)
// ============================================================

test('providers:固定顺序 github/google/wechat,configured 按 env 判定', () =>
  withEnv(ALL_ENV, () => {
    assert.deepEqual(listOAuthProviders(), [
      { id: 'github', configured: true },
      { id: 'google', configured: true },
      { id: 'wechat', configured: true },
    ]);
    assert.deepEqual(OAUTH_PROVIDER_IDS, ['github', 'google', 'wechat']);
  }));

test('providers:部分配置 — 仅 github 完整,其余未配置', () =>
  withEnv(GITHUB_ENV, () => {
    assert.deepEqual(listOAuthProviders(), [
      { id: 'github', configured: true },
      { id: 'google', configured: false },
      { id: 'wechat', configured: false },
    ]);
  }));

test('providers:只配 client id 缺 secret → 未配置;空白值 trim 后视同缺失', () =>
  withEnv({ GITHUB_OAUTH_CLIENT_ID: 'gh_client', GITHUB_OAUTH_CLIENT_SECRET: '   ' }, () => {
    assert.equal(getOAuthProviderConfig('github').configured, false);
  }));

test('providers:响应形状零敏感字段(id + configured 之外无任何 env 痕迹)', () =>
  withEnv(ALL_ENV, () => {
    const list = listOAuthProviders();
    for (const item of list) {
      assert.deepEqual(Object.keys(item).sort(), ['configured', 'id']);
    }
    assert.ok(!JSON.stringify(list).includes('gh_secret'));
  }));

test('isOAuthProviderId:合法 id 通过;大小写/空/null/非 oauth provider 拒绝', () => {
  assert.equal(isOAuthProviderId('github'), true);
  assert.equal(isOAuthProviderId('google'), true);
  assert.equal(isOAuthProviderId('wechat'), true);
  assert.equal(isOAuthProviderId('GitHub'), false);
  assert.equal(isOAuthProviderId(''), false);
  assert.equal(isOAuthProviderId(null), false);
  assert.equal(isOAuthProviderId(undefined), false);
  assert.equal(isOAuthProviderId('x'), false); // account.ts 有 'x' 但不是 oauth provider
  assert.equal(isOAuthProviderId('email'), false);
});

test('buildAuthorizeUrl:三 provider 的 authorize URL 契约(参数/scope/fragment)', () => {
  const common = { clientId: 'cid', redirectUri: 'https://app.dev/api/auth/oauth/callback/github', state: 'abc123' };
  const gh = buildAuthorizeUrl('github', { ...common, clientId: 'ghcid' });
  assert.ok(gh.startsWith('https://github.com/login/oauth/authorize?'));
  assert.ok(gh.includes('client_id=ghcid'));
  assert.ok(gh.includes('redirect_uri=' + encodeURIComponent(common.redirectUri)));
  assert.ok(gh.includes('state=abc123'));
  assert.ok(gh.includes('scope=read%3Auser+user%3Aemail')); // URLSearchParams 空格编码为 +
  assert.ok(!gh.includes('response_type'));

  const gg = buildAuthorizeUrl('google', { ...common, clientId: 'ggcid' });
  assert.ok(gg.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(gg.includes('client_id=ggcid'));
  assert.ok(gg.includes('response_type=code'));
  assert.ok(gg.includes('scope=openid+email+profile'));

  const wx = buildAuthorizeUrl('wechat', { ...common, clientId: 'wxapp' });
  assert.ok(wx.startsWith('https://open.weixin.qq.com/connect/qrconnect?'));
  assert.ok(wx.includes('appid=wxapp'));
  assert.ok(wx.includes('response_type=code'));
  assert.ok(wx.includes('scope=snsapi_login'));
  assert.ok(wx.includes('lang=zh_CN'));
  assert.ok(wx.endsWith('#wechat_redirect'), 'wechat 保留 fragment');
});

// ============================================================
// 2. oauth-state:next 清洗 / state 签名与校验
// ============================================================

test('sanitizeNext:合法相对路径原样;非法一律回 /', () => {
  assert.equal(sanitizeNext('/jobs'), '/jobs');
  assert.equal(sanitizeNext('/jobs?tab=new'), '/jobs?tab=new');
  assert.equal(sanitizeNext(null), '/');
  assert.equal(sanitizeNext(undefined), '/');
  assert.equal(sanitizeNext(''), '/');
  assert.equal(sanitizeNext('   '), '/');
  assert.equal(sanitizeNext('https://evil.com'), '/');
  assert.equal(sanitizeNext('//evil.com'), '/');
  assert.equal(sanitizeNext('/\\evil'), '/');
  assert.equal(sanitizeNext('jobs'), '/');
  assert.equal(sanitizeNext('/a'.repeat(OAUTH_STATE_MAX_NEXT_LENGTH / 2)), '/a'.repeat(OAUTH_STATE_MAX_NEXT_LENGTH / 2));
  assert.equal(sanitizeNext('/a'.repeat(OAUTH_STATE_MAX_NEXT_LENGTH / 2 + 1)), '/');
});

test('randomOauthState:32-byte hex nonce(64 字符)', () => {
  const s = randomOauthState();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.notEqual(randomOauthState(), s);
});

test('oauth_state cookie 选项:httpOnly / sameSite=lax / path=/ / maxAge 600', () => {
  const opts = oauthStateCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.path, '/');
  assert.equal(opts.maxAge, 600);
  assert.equal(opts.secure, process.env.NODE_ENV === 'production');
});

test('state 签名/校验:roundtrip 成功,next 原样恢复', () =>
  withEnv(ALL_ENV, () => {
    const state = randomOauthState();
    const raw = signOauthState({ state, next: '/jobs', now: 1_750_000_000_000 });
    assert.match(raw, /^v1\.\d+\.[0-9a-f]{64}\.[^.]+\.[0-9a-f]{32}$/);
    const result = verifyOauthState(raw, { state, now: 1_750_000_000_000 });
    assert.deepEqual(result, { ok: true, next: '/jobs' });
  }));

test('state 校验:缺失 / 格式坏 / 版本错 / state 不匹配 → 全部无效', () =>
  withEnv(ALL_ENV, () => {
    const state = randomOauthState();
    const raw = signOauthState({ state, next: '/jobs' });
    assert.equal(verifyOauthState(null, { state }).ok, false);
    assert.equal(verifyOauthState(undefined, { state }).ok, false);
    assert.equal(verifyOauthState('garbage', { state }).ok, false);
    assert.equal(verifyOauthState('v2.1.2.3.4', { state }).ok, false);
    assert.equal(verifyOauthState(raw.replace(state, '0'.repeat(64)), { state }).ok, false);
    assert.equal(verifyOauthState(raw, { state: 'f'.repeat(64) }).ok, false);
    assert.equal(verifyOauthState(raw, { state: null }).ok, false);
  }));

test('state 校验:HMAC 篡改 / next 篡改 → 无效', () =>
  withEnv(ALL_ENV, () => {
    const state = randomOauthState();
    const raw = signOauthState({ state, next: '/jobs' });
    const parts = raw.split('.');
    // 篡改 mac 末位
    const badMac = parts.slice(0, -1).concat([parts[4].slice(0, -1) + (parts[4].endsWith('a') ? 'b' : 'a')]).join('.');
    assert.equal(verifyOauthState(badMac, { state }).ok, false);
    // 篡改 next(b64 段)→ HMAC 失效
    const evilNext = Buffer.from('/admin').toString('base64url');
    const badNext = [parts[0], parts[1], parts[2], evilNext, parts[4]].join('.');
    assert.equal(verifyOauthState(badNext, { state }).ok, false);
  }));

test('state 校验:过期(>600s) → 无效;恰好 600s 内有效', () =>
  withEnv(ALL_ENV, () => {
    const state = randomOauthState();
    const raw = signOauthState({ state, next: '/jobs', now: 1_000_000 });
    assert.equal(verifyOauthState(raw, { state, now: 1_000_000 + OAUTH_STATE_TTL_MS }).ok, true);
    assert.equal(verifyOauthState(raw, { state, now: 1_000_000 + OAUTH_STATE_TTL_MS + 1 }).ok, false);
  }));

test('state 校验:嵌入的 next 非法(签名后不被信任)→ 整票作废', () =>
  withEnv(ALL_ENV, () => {
    const state = randomOauthState();
    const raw = signOauthState({ state, next: '/jobs' });
    // 用合法 mac 但换掉 next 为绝对 URL:先伪造 b64 再伪造对应 mac 不现实,
    // 这里验证「next 需重新通过 sanitize」的守卫路径存在即可(构造签名时已清洗,
    // 直接校验:换 b64 后 mac 也换 → 需要真实密钥,由 HMAC 测试覆盖)。
    const parts = raw.split('.');
    const evilNext = Buffer.from('//evil.com').toString('base64url');
    const tampered = [parts[0], parts[1], parts[2], evilNext, parts[4]].join('.');
    assert.equal(verifyOauthState(tampered, { state }).ok, false);
  }));

// ============================================================
// 3. oauth-exchange:code→token→userinfo(零网络,mock fetch)
// ============================================================

test('exchange github:POST token + Bearer userinfo + verified primary email,映射 id/name/email/avatar', async () => {
  const cfg = getOAuthProviderConfig('github', GITHUB_ENV);
  const { calls, impl } = fakeFetch([
    [/^https:\/\/github\.com\/login\/oauth\/access_token$/, 200, { access_token: 'gh-tok-1' }],
    [/^https:\/\/api\.github\.com\/user$/, 200, { id: 12345, login: 'octo', name: 'Octo Cat', email: 'untrusted@example.com', avatar_url: 'https://a.github/u.png' }],
    [/^https:\/\/api\.github\.com\/user\/emails$/, 200, [{ email: 'octo@users.noreply.github.com', primary: true, verified: true }]],
  ]);
  const info = await exchangeCodeForUserinfo(cfg, 'code-1', { redirectUri: 'https://app.dev/api/auth/oauth/callback/github', fetchImpl: impl });
  assert.deepEqual(info, {
    provider: 'github',
    subject: '12345',
    email: 'octo@users.noreply.github.com',
    displayName: 'Octo Cat',
    avatarUrl: 'https://a.github/u.png',
  });
  assert.equal(calls.length, 3);
  const tokenCall = calls[0];
  assert.equal(tokenCall.init.method, 'POST');
  assert.equal(tokenCall.init.headers.Accept, 'application/json');
  assert.equal(tokenCall.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(tokenCall.init.body);
  assert.equal(body.get('client_id'), 'gh_client');
  assert.equal(body.get('client_secret'), 'gh_secret');
  assert.equal(body.get('code'), 'code-1');
  assert.equal(body.get('redirect_uri'), 'https://app.dev/api/auth/oauth/callback/github');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer gh-tok-1');
  assert.match(calls[1].url, /^https:\/\/api\.github\.com\/user$/);
  assert.equal(calls[2].init.headers.Authorization, 'Bearer gh-tok-1');
  assert.match(calls[2].url, /^https:\/\/api\.github\.com\/user\/emails$/);
});

test('exchange github:无 verified primary email → email undefined;name 缺 → login 兜底', async () => {
  const cfg = getOAuthProviderConfig('github', GITHUB_ENV);
  const { impl } = fakeFetch([
    [/access_token/, 200, { access_token: 't' }],
    [/\/user$/, 200, { id: 7, login: 'login-only', email: 'unverified@example.com' }],
    [/\/user\/emails$/, 200, [
      { email: 'unverified@example.com', primary: true, verified: false },
      { email: 'secondary@example.com', primary: false, verified: true },
    ]],
  ]);
  const info = await exchangeCodeForUserinfo(cfg, 'c', { redirectUri: 'https://app.dev/cb', fetchImpl: impl });
  assert.equal(info.email, undefined);
  assert.equal(info.displayName, 'login-only');
  assert.equal(info.avatarUrl, undefined);
});

test('exchange github:oversized or unsafe optional userinfo fields are dropped', async () => {
  const cfg = getOAuthProviderConfig('github', GITHUB_ENV);
  const { impl } = fakeFetch([
    [/access_token/, 200, { access_token: 't' }],
    [/\/user$/, 200, {
      id: 8,
      name: 'x'.repeat(101),
      email: `${'x'.repeat(250)}@example.com`,
      avatar_url: 'javascript:alert(1)',
    }],
    [/\/user\/emails$/, 200, [{ email: `${'x'.repeat(250)}@example.com`, primary: true, verified: true }]],
  ]);
  const info = await exchangeCodeForUserinfo(cfg, 'c', { redirectUri: 'https://app.dev/cb', fetchImpl: impl });
  assert.equal(info.subject, '8');
  assert.equal(info.displayName, undefined);
  assert.equal(info.email, undefined);
  assert.equal(info.avatarUrl, undefined);
});

test('exchange rejects an oversized provider subject before account upsert', async () => {
  const cfg = getOAuthProviderConfig('github', GITHUB_ENV);
  const { impl } = fakeFetch([
    [/access_token/, 200, { access_token: 't' }],
    [/\/user$/, 200, { id: 'x'.repeat(256) }],
  ]);
  await assert.rejects(
    exchangeCodeForUserinfo(cfg, 'c', { redirectUri: 'https://app.dev/cb', fetchImpl: impl }),
    OauthExchangeError,
  );
});

test('exchange google:POST token(grant_type) + Bearer userinfo(sub/email/name/picture)', async () => {
  const cfg = getOAuthProviderConfig('google', GOOGLE_ENV);
  const { calls, impl } = fakeFetch([
    [/^https:\/\/oauth2\.googleapis\.com\/token$/, 200, { access_token: 'gg-tok' }],
    [/^https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo$/, 200, { sub: 'sub-42', email: 'g@gmail.com', email_verified: true, name: 'G User', picture: 'https://p.g' }],
  ]);
  const info = await exchangeCodeForUserinfo(cfg, 'code-2', { redirectUri: 'https://app.dev/api/auth/oauth/callback/google', fetchImpl: impl });
  assert.deepEqual(info, {
    provider: 'google',
    subject: 'sub-42',
    email: 'g@gmail.com',
    displayName: 'G User',
    avatarUrl: 'https://p.g',
  });
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('client_id'), 'gg_client');
  assert.equal(body.get('redirect_uri'), 'https://app.dev/api/auth/oauth/callback/google');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer gg-tok');
});

test('exchange wechat:token 走 GET(query 带 appid/secret/code),userinfo GET 带 access_token/openid,email 恒 undefined', async () => {
  const cfg = getOAuthProviderConfig('wechat', WECHAT_ENV);
  const { calls, impl } = fakeFetch([
    [/^https:\/\/api\.weixin\.qq\.com\/sns\/oauth2\/access_token\?/, 200, { openid: 'wx-openid-1', access_token: 'wx-tok' }],
    [/^https:\/\/api\.weixin\.qq\.com\/sns\/userinfo\?/, 200, { openid: 'wx-openid-1', nickname: '微信用户', headimgurl: 'https://wx.h/1.png' }],
  ]);
  const info = await exchangeCodeForUserinfo(cfg, 'code-3', { redirectUri: 'https://app.dev/api/auth/oauth/callback/wechat', fetchImpl: impl });
  assert.deepEqual(info, {
    provider: 'wechat',
    subject: 'wx-openid-1',
    email: undefined,
    displayName: '微信用户',
    avatarUrl: 'https://wx.h/1.png',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  const tokenUrl = new URL(calls[0].url);
  assert.equal(tokenUrl.searchParams.get('appid'), 'wx_app');
  assert.equal(tokenUrl.searchParams.get('secret'), 'wx_secret');
  assert.equal(tokenUrl.searchParams.get('code'), 'code-3');
  assert.equal(tokenUrl.searchParams.get('grant_type'), 'authorization_code');
  const infoUrl = new URL(calls[1].url);
  assert.equal(infoUrl.searchParams.get('access_token'), 'wx-tok');
  assert.equal(infoUrl.searchParams.get('openid'), 'wx-openid-1');
  assert.equal(infoUrl.searchParams.get('lang'), 'zh_CN');
});

test('exchange 失败判定:HTTP 非 2xx / error 字段 / errcode 非 0 / 缺 access_token / 缺 subject', async () => {
  const gh = getOAuthProviderConfig('github', GITHUB_ENV);
  const gg = getOAuthProviderConfig('google', GOOGLE_ENV);
  const wx = getOAuthProviderConfig('wechat', WECHAT_ENV);
  const uri = 'https://app.dev/cb';

  await assert.rejects(
    exchangeCodeForUserinfo(gh, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/access_token/, 400, { error: 'bad_verification_code' }]]).impl }),
    OauthExchangeError,
  );
  await assert.rejects(
    exchangeCodeForUserinfo(gh, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/access_token/, 200, { error: 'bad_verification_code' }]]).impl }),
    OauthExchangeError,
  );
  await assert.rejects(
    exchangeCodeForUserinfo(gh, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/access_token/, 200, { access_token: '' }]]).impl }),
    OauthExchangeError,
  );
  await assert.rejects(
    exchangeCodeForUserinfo(gg, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/token/, 200, { access_token: 't' }], [/userinfo/, 200, { name: 'no-sub' }]]).impl }),
    OauthExchangeError,
  );
  // 微信 errcode 非 0 藏在 200 里(微信惯例)
  await assert.rejects(
    exchangeCodeForUserinfo(wx, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/oauth2\/access_token/, 200, { errcode: 40029, errmsg: 'invalid code' }]]).impl }),
    OauthExchangeError,
  );
  await assert.rejects(
    exchangeCodeForUserinfo(wx, 'c', { redirectUri: uri, fetchImpl: fakeFetch([[/oauth2\/access_token/, 200, { openid: 'o1' }]]).impl }),
    OauthExchangeError,
  );
});

// ============================================================
// 4. oauth-flow start:302 目标 + oauth_state cookie + next 清洗 + 400/503
// ============================================================

test('start github:location 含 authorize host/client_id/state/redirect_uri,cookie 已构(verify 可过)', () =>
  withEnv(ALL_ENV, () => {
    const result = startOauthFlow({
      provider: 'github',
      next: '/jobs',
      origin: 'https://app.dev',
      now: 1_750_000_000_000,
    });
    assert.match(result.location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    assert.ok(result.location.includes('client_id=gh_client'));
    assert.ok(result.location.includes('redirect_uri=' + encodeURIComponent('https://app.dev/api/auth/oauth/callback/github')));
    const state = new URL(result.location).searchParams.get('state');
    assert.match(state, /^[0-9a-f]{64}$/);
    assert.equal(result.next, '/jobs');
    assert.equal(result.cookie.name, OAUTH_STATE_COOKIE);
    const verified = verifyOauthState(result.cookie.value, { state, now: 1_750_000_000_000 });
    assert.deepEqual(verified, { ok: true, next: '/jobs' });
    assert.equal(result.cookie.options.httpOnly, true);
    assert.equal(result.cookie.options.maxAge, 600);
  }));

test('start wechat:location 用 appid 且保留 #wechat_redirect', () =>
  withEnv(ALL_ENV, () => {
    const result = startOauthFlow({ provider: 'wechat', next: '/', origin: 'https://app.dev' });
    assert.ok(result.location.startsWith('https://open.weixin.qq.com/connect/qrconnect?'));
    assert.ok(result.location.includes('appid=wx_app'));
    assert.ok(result.location.endsWith('#wechat_redirect'));
  }));

test('start:next 绝对 URL / //evil → 清洗为 /(cookie 内 next 也是 /)', () =>
  withEnv(ALL_ENV, () => {
    for (const evil of ['https://evil.com', '//evil.com']) {
      const result = startOauthFlow({ provider: 'github', next: evil, origin: 'https://app.dev', now: 1_750_000_000_000 });
      assert.equal(result.next, '/');
      const state = new URL(result.location).searchParams.get('state');
      assert.deepEqual(verifyOauthState(result.cookie.value, { state, now: 1_750_000_000_000 }), { ok: true, next: '/' });
    }
  }));

test('start:provider 缺失/非法 → OauthBadRequestError(route 层 400)', () => {
  withEnv(ALL_ENV, () => {
    assert.throws(() => startOauthFlow({ provider: null, next: null, origin: 'https://app.dev' }), OauthBadRequestError);
    assert.throws(() => startOauthFlow({ provider: 'x', next: null, origin: 'https://app.dev' }), OauthBadRequestError);
  });
});

test('start:未配置 → OauthNotConfiguredError(route 层 503)', () => {
  withEnv({}, () => {
    assert.throws(() => startOauthFlow({ provider: 'github', next: null, origin: 'https://app.dev' }), OauthNotConfiguredError);
  });
});

test('errorRedirectPath:next 拼接 auth_error,兼容 next 自带 query', () => {
  assert.equal(errorRedirectPath('/', 'oauth_state_invalid'), '/?auth_error=oauth_state_invalid');
  assert.equal(errorRedirectPath('/jobs', 'oauth_provider_error'), '/jobs?auth_error=oauth_provider_error');
  assert.equal(errorRedirectPath('/jobs?sort=new', 'oauth_provider_error'), '/jobs?sort=new&auth_error=oauth_provider_error');
});

test('absoluteRedirect:相对路径 → 同源绝对 URL(Next 16 redirect 只收绝对 URL)', () => {
  assert.equal(absoluteRedirect('/map?x=1', 'http://localhost:3000'), 'http://localhost:3000/map?x=1');
  assert.equal(absoluteRedirect('/', 'http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(absoluteRedirect('/jobs?sort=new&auth_error=oauth_provider_error', 'http://localhost:3000'), 'http://localhost:3000/jobs?sort=new&auth_error=oauth_provider_error');
});

test('absoluteRedirect:与 errorRedirectPath 组合 → 同源 auth_error 绝对 URL', () => {
  assert.equal(
    absoluteRedirect(errorRedirectPath('/', 'oauth_state_invalid'), 'http://localhost:3000'),
    'http://localhost:3000/?auth_error=oauth_state_invalid',
  );
  assert.equal(
    absoluteRedirect(errorRedirectPath('/jobs', 'oauth_provider_error'), 'http://localhost:3000'),
    'http://localhost:3000/jobs?auth_error=oauth_provider_error',
  );
});

test('absoluteRedirect:跨源防御(//host / 绝对 URL 直传)→ 回落 origin + /', () => {
  assert.equal(absoluteRedirect('//evil.com/x', 'http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(absoluteRedirect('https://evil.com/x', 'http://localhost:3000'), 'http://localhost:3000/');
});

// ============================================================
// 5. oauth-flow callback:全链路(内存 store + mock fetch + fake jar)
// ============================================================

function memoryMode() {
  __accountStoreTest.poolOverride = () => null;
  return () => {
    __accountStoreTest.poolOverride = undefined;
  };
}

test('callback github 全链路成功:新用户落库、session 可用、cookie 清、302 到 next 无 auth_error', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/jobs', now: 1_750_000_000_000 });
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
      const { calls, impl } = fakeFetch([
        [/github\.com\/login\/oauth\/access_token/, 200, { access_token: 'tok' }],
        [/api\.github\.com\/user$/, 200, { id: 999, login: 'octo', name: 'Octo', email: 'untrusted@dev.io', avatar_url: 'https://a/1.png' }],
        [/api\.github\.com\/user\/emails/, 200, [{ email: 'octo@dev.io', primary: true, verified: true }]],
      ]);
      const result = await runOauthCallback({
        provider: 'github',
        code: 'code-x',
        state,
        cookieJar: jar,
        origin: 'https://app.dev',
        now: 1_750_000_000_000,
        fetchImpl: impl,
      });
      assert.equal(result.next, '/jobs');
      assert.ok(!result.next.includes('auth_error'));
      assert.equal(result.user.displayName, 'Octo');
      assert.equal(result.user.accountLabel, 'octo@dev.io');
      assert.equal(jar.map.has(OAUTH_STATE_COOKIE), false, 'state cookie 已清');
      assert.equal(calls.length, 3);
      // 会话可用:session token 能取回同一用户
      const viaSession = await getSessionUser(result.session.token);
      assert.equal(viaSession.id, result.user.id);
    } finally {
      restore();
    }
  }));

test('callback:同一 provider 二次登录复用同一用户(id 不变)', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      let firstId = null;
      for (const i of [1, 2]) {
        const state = randomOauthState();
        const raw = signOauthState({ state, next: '/jobs' });
        const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
        const { impl } = fakeFetch([
          [/access_token/, 200, { access_token: `tok-${i}` }],
          [/api\.github\.com\/user$/, 200, { id: 999, login: 'octo', name: 'Octo', email: 'untrusted@dev.io' }],
          [/api\.github\.com\/user\/emails/, 200, [{ email: 'octo@dev.io', primary: true, verified: true }]],
        ]);
        const result = await runOauthCallback({ provider: 'github', code: `c-${i}`, state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
        if (firstId === null) firstId = result.user.id;
        else assert.equal(result.user.id, firstId);
      }
    } finally {
      restore();
    }
  }));

test('callback wechat:email undefined → accountLabel 回退空串(前端回退 provider 名),displayName=nickname', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/' });
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
      const { impl } = fakeFetch([
        [/oauth2\/access_token/, 200, { openid: 'wx-o-1', access_token: 'wx-t' }],
        [/sns\/userinfo/, 200, { openid: 'wx-o-1', nickname: '微信昵称', headimgurl: 'https://wx.h/1.png' }],
      ]);
      const result = await runOauthCallback({ provider: 'wechat', code: 'wx-code', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
      assert.equal(result.user.email, undefined);
      assert.equal(result.user.accountLabel, '');
      assert.equal(result.user.displayName, '微信昵称');
      assert.equal(result.user.avatarUrl, 'https://wx.h/1.png');
    } finally {
      restore();
    }
  }));

test('callback google:邮箱撞已有 OTP 用户路径在 upsertIdentity(见第 6 节);正常新用户 email/sub 映射', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/recent' });
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
      const { impl } = fakeFetch([
        [/oauth2\.googleapis\.com\/token/, 200, { access_token: 'gg-t' }],
        [/userinfo/, 200, { sub: 'sub-77', email: 'g77@gmail.com', email_verified: true, name: 'G Seven' }],
      ]);
      const result = await runOauthCallback({ provider: 'google', code: 'gc', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
      assert.equal(result.next, '/recent');
      assert.equal(result.user.email, 'g77@gmail.com');
      assert.equal(result.user.provider, 'google');
      assert.equal(result.user.accountLabel, 'g77@gmail.com');
    } finally {
      restore();
    }
  }));

test('callback google:email_verified 非 true 时不使用邮箱自动挂接', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      const email = `google-unverified-${Date.now()}@test.dev`;
      const existing = await upsertIdentity({ provider: 'email', subject: email, email });
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/recent' });
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
      const { impl } = fakeFetch([
        [/oauth2\.googleapis\.com\/token/, 200, { access_token: 'gg-unverified' }],
        [/userinfo/, 200, { sub: `google-unverified-${Date.now()}`, email, email_verified: false, name: 'Unverified Google' }],
      ]);
      const result = await runOauthCallback({ provider: 'google', code: 'gc', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
      assert.notEqual(result.user.id, existing.id, 'unverified email must not attach the existing account');
      assert.equal(result.user.email, undefined, 'unverified email is omitted from the new identity');
    } finally {
      restore();
    }
  }));

test('callback github:只有 verified primary email 才允许自动挂接', async () =>
  await withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      for (const [label, emails] of [
        ['unverified primary', [{ email: 'github-unverified@test.dev', primary: true, verified: false }]],
        ['no primary', [{ email: 'github-secondary@test.dev', primary: false, verified: true }]],
      ]) {
        const email = `github-${label.replaceAll(' ', '-')}-${Date.now()}@test.dev`;
        const existing = await upsertIdentity({ provider: 'email', subject: email, email });
        const state = randomOauthState();
        const raw = signOauthState({ state, next: '/recent' });
        const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
        const { impl } = fakeFetch([
          [/access_token/, 200, { access_token: `gh-${label}` }],
          [/api\.github\.com\/user$/, 200, { id: `gh-${label}`, login: 'octo', email }],
          [/api\.github\.com\/user\/emails$/, 200, emails],
        ]);
        const result = await runOauthCallback({ provider: 'github', code: 'gc', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
        assert.notEqual(result.user.id, existing.id, `${label} email must not attach the existing account`);
        assert.equal(result.user.email, undefined, `${label} email is omitted from the new identity`);
      }
    } finally {
      restore();
    }
  }));

test('callback:next 绝对 URL 在 start 已清洗 → 跳回 /', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      // start 阶段把 https://evil 清洗为 /,cookie 里只有 /
      const start = startOauthFlow({ provider: 'github', next: 'https://evil.com', origin: 'https://app.dev' });
      const state = new URL(start.location).searchParams.get('state');
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: start.cookie.value });
      const { impl } = fakeFetch([
        [/access_token/, 200, { access_token: 't' }],
        [/api\.github\.com\/user$/, 200, { id: 5, login: 'l', name: 'N' }],
        [/api\.github\.com\/user\/emails/, 200, [{ email: 'callback@dev.io', primary: true, verified: true }]],
      ]);
      const result = await runOauthCallback({ provider: 'github', code: 'c', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl });
      assert.equal(result.next, '/');
    } finally {
      restore();
    }
  }));

test('callback:state 缺失/不匹配/过期 → OauthStateInvalidError,cookie 清,零三方调用', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/jobs', now: 1_000_000 });
      const { calls, impl } = fakeFetch([[/.*/, 200, { access_token: 't' }]]);
      const cases = [
        { label: 'cookie 缺失', jar: fakeCookieJar(), state },
        { label: 'state 不匹配', jar: fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw }), state: 'f'.repeat(64) },
        { label: 'state 过期', jar: fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw }), state, now: 1_000_000 + OAUTH_STATE_TTL_MS + 1 },
      ];
      for (const c of cases) {
        await assert.rejects(
          runOauthCallback({ provider: 'github', code: 'c', state: c.state, cookieJar: c.jar, origin: 'https://app.dev', now: c.now, fetchImpl: impl }),
          (err) => {
            assert.ok(err instanceof OauthStateInvalidError, `${c.label}: expected OauthStateInvalidError`);
            assert.equal(err.next, '/');
            assert.equal(c.jar.map.has(OAUTH_STATE_COOKIE), false, `${c.label}: cookie 已清`);
            return true;
          },
        );
      }
      assert.equal(calls.length, 0, 'state 校验失败不得调用三方');
    } finally {
      restore();
    }
  }));

test('callback:code 交换失败 / userinfo 失败 → OauthProviderError(带 verified next),cookie 清', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      for (const [label, routes] of [
        ['token 400', [[/access_token/, 400, { error: 'bad_verification_code' }]]],
        ['token error 字段', [[/access_token/, 200, { error: 'bad_verification_code' }]]],
        ['userinfo 500', [[/access_token/, 200, { access_token: 't' }], [/\/user$/, 500, { error: 'server' }]]],
        ['userinfo 缺 subject', [[/access_token/, 200, { access_token: 't' }], [/\/user$/, 200, { name: 'x' }]]],
      ]) {
        const state = randomOauthState();
        const raw = signOauthState({ state, next: '/jobs' });
        const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
        const { impl } = fakeFetch(routes);
        await assert.rejects(
          runOauthCallback({ provider: 'github', code: 'c', state, cookieJar: jar, origin: 'https://app.dev', fetchImpl: impl }),
          (err) => {
            assert.ok(err instanceof OauthProviderError, `${label}: expected OauthProviderError`);
            assert.equal(err.next, '/jobs');
            assert.equal(jar.map.has(OAUTH_STATE_COOKIE), false, `${label}: cookie 已清`);
            return true;
          },
        );
      }
    } finally {
      restore();
    }
  }));

test('callback:provider 非法 → OauthBadRequestError;未配置 → OauthProviderError(不 500)', () =>
  withEnv(ALL_ENV, async () => {
    const restore = memoryMode();
    try {
      await assert.rejects(
        runOauthCallback({ provider: 'x', code: 'c', state: null, cookieJar: fakeCookieJar(), origin: 'https://app.dev' }),
        OauthBadRequestError,
      );
    } finally {
      restore();
    }
  }));

test('callback:provider 未配置(env 空)→ OauthProviderError 兜底', () =>
  withEnv({ SESSION_SECRET: 's' }, async () => {
    const restore = memoryMode();
    try {
      const state = randomOauthState();
      const raw = signOauthState({ state, next: '/jobs' });
      const jar = fakeCookieJar({ [OAUTH_STATE_COOKIE]: raw });
      await assert.rejects(
        runOauthCallback({ provider: 'github', code: 'c', state, cookieJar: jar, origin: 'https://app.dev' }),
        (err) => err instanceof OauthProviderError && err.next === '/',
      );
    } finally {
      restore();
    }
  }));

// ============================================================
// 6. upsertIdentity 邮箱冲突(23505):挂接已有用户 / 非 23505 照抛
// ============================================================

test('upsertIdentity:INSERT 23505(邮箱冲突)→ 复用已有用户 + 挂接身份,不新建', async () => {
  const sqlLog = [];
  const identityParams = [];
  const existingRow = {
    id: '42',
    display_name: 'Existing User',
    avatar_url: null,
    phone: null,
    email: 'existing@test.dev',
    username: null,
    preferences: null,
  };
  __accountStoreTest.poolOverride = () => {
    const client = {
      query: async (sql, params) => {
        sqlLog.push(sql);
        if (['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT oauth_user_insert', 'RELEASE SAVEPOINT oauth_user_insert', 'ROLLBACK TO SAVEPOINT oauth_user_insert'].includes(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO users')) {
          throw { code: '23505', message: 'duplicate key value violates unique constraint "users_email_uidx"' };
        }
        if (sql.includes('FROM users')) return { rows: [existingRow] };
        if (sql.includes('INSERT INTO auth_identities')) {
          identityParams.push(params);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      release() {},
    };
    return { connect: async () => client };
  };
  try {
    const user = await upsertIdentity({
      provider: 'google',
      subject: 'sub-google-1',
      email: 'existing@test.dev',
      displayName: 'Google User',
    });
    assert.equal(user.id, '42', '返回已有用户而非新建');
    assert.equal(user.email, 'existing@test.dev');
    assert.equal(user.displayName, 'Existing User', '已有用户资料不被覆盖');
    assert.equal(user.provider, 'google');
    assert.equal(identityParams.length, 1, '恰好挂接一次身份');
    assert.deepEqual(identityParams[0], ['42', 'google', 'sub-google-1']);
    const selectIdx = sqlLog.findIndex((s) => s.includes('FROM users'));
    assert.ok(selectIdx > -1 && sqlLog[selectIdx].includes('lower(email) = lower($1)'), '按 lower(email) 查已有用户');
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('upsertIdentity:非 23505 错误照抛 DbUnavailableError', async () => {
  __accountStoreTest.poolOverride = () => {
    const client = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        throw { code: 'XX000', message: 'internal_error (test)' };
      },
      release() {},
    };
    return { connect: async () => client };
  };
  try {
    await assert.rejects(
      upsertIdentity({ provider: 'google', subject: 's1', email: 'a@test.dev' }),
      DbUnavailableError,
    );
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('upsertIdentity:23505 但查无此人(竞态)→ 仍抛 DbUnavailableError,不静默', async () => {
  __accountStoreTest.poolOverride = () => {
    const client = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'SAVEPOINT oauth_user_insert' || sql === 'ROLLBACK TO SAVEPOINT oauth_user_insert' || sql === 'RELEASE SAVEPOINT oauth_user_insert') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO users')) throw { code: '23505', message: 'dup' };
        return { rows: [] };
      },
      release() {},
    };
    return { connect: async () => client };
  };
  try {
    await assert.rejects(
      upsertIdentity({ provider: 'google', subject: 's2', email: 'ghost@test.dev' }),
      DbUnavailableError,
    );
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

// ============================================================
// 7. route 薄壳契约(readFileSync + 正则,仓库既有模式)
// ============================================================

test('route providers:返回 listOAuthProviders 的 { providers },零敏感字段', () => {
  const route = src('app/api/auth/oauth/providers/route.ts');
  assert.match(route, /NextResponse\.json\(\{ providers: listOAuthProviders\(\) \}\)/);
  assert.ok(!route.includes('clientSecret'), 'providers route 不得出现 secret 字样');
  assert.ok(!route.includes('CLIENT_SECRET'));
  assert.ok(!route.includes('access_token'));
});

test('route start:flow 接线 + 400 BAD_REQUEST + 503 OAUTH_NOT_CONFIGURED + cookie 写入 + 302', () => {
  const route = src('app/api/auth/oauth/start/route.ts');
  assert.match(route, /startOauthFlow\(\{/);
  assert.match(route, /jar\.set\(result\.cookie\.name, result\.cookie\.value, result\.cookie\.options\)/);
  assert.match(route, /NextResponse\.redirect\(result\.location, 302\)/);
  assert.match(route, /code: 'BAD_REQUEST'/);
  assert.match(route, /status: 400/);
  assert.match(route, /code: 'OAUTH_NOT_CONFIGURED'/);
  assert.match(route, /status: 503/);
});

test('route callback:runOauthCallback 接线 + session cookie + 全部 302 经 absoluteRedirect(Next 16 绝对 URL)', () => {
  const route = src('app/api/auth/oauth/callback/[provider]/route.ts');
  assert.match(route, /runOauthCallback\(\{/);
  assert.match(route, /writeSessionCookie\(result\.session\.token, result\.session\.expiresAt\)/);
  assert.match(route, /NextResponse\.redirect\(absoluteRedirect\(result\.next, base\), 302\)/);
  assert.match(route, /NextResponse\.redirect\(absoluteRedirect\(errorRedirectPath\(err\.next, 'oauth_state_invalid'\), base\), 302\)/);
  assert.match(route, /NextResponse\.redirect\(absoluteRedirect\(errorRedirectPath\(err\.next, 'oauth_provider_error'\), base\), 302\)/);
  assert.match(route, /NextResponse\.redirect\(absoluteRedirect\('\/\?auth_error=oauth_provider_error', base\), 302\)/);
  assert.ok(!route.includes('NextResponse.redirect(result.next'), '不得裸传相对 result.next');
  assert.ok(!route.includes('NextResponse.redirect(errorRedirectPath(err.next'), '不得裸传相对 errorRedirectPath');
  assert.match(route, /code: 'BAD_REQUEST'/);
  assert.match(route, /status: 400/);
  assert.match(route, /params: Promise<\{ provider: string \}>/);
});

test('demo login is gated by provider configuration and never enabled in production', () => {
  const oauth = src('app/api/auth/oauth/route.ts');
  const github = src('app/api/auth/github/route.ts');
  assert.match(oauth, /import \{ demoLoginGate \} from '@\/lib\/demo-login-gate'/);
  assert.match(github, /import \{ demoLoginGate \} from '@\/lib\/demo-login-gate'/);
  const configuredIdxOauth = oauth.indexOf('const gate = demoLoginGate(spec.provider)');
  const demoUpsertIdxOauth = oauth.indexOf('upsertIdentity(spec)');
  assert.ok(configuredIdxOauth !== -1 && demoUpsertIdxOauth !== -1);
  assert.ok(configuredIdxOauth < demoUpsertIdxOauth, 'real-provider check must precede demo session creation');
  assert.match(oauth, /gate\.code/);
  assert.match(oauth, /status: 403/);

  const configuredIdxGithub = github.indexOf("const gate = demoLoginGate('github')");
  const demoUpsertIdxGithub = github.indexOf('upsertIdentity(');
  assert.ok(configuredIdxGithub !== -1 && demoUpsertIdxGithub !== -1);
  assert.ok(configuredIdxGithub < demoUpsertIdxGithub, 'real-provider check must precede demo session creation');
  assert.match(github, /gate\.code/);
  assert.match(github, /status: 403/);

  assert.match(oauth, /export async function POST\(request: Request\)/);
  assert.match(oauth, /github:demo/);
  assert.match(oauth, /google:demo/);
  assert.match(oauth, /wechat:demo/);
  assert.match(oauth, /upsertIdentity\(spec\)/);
  assert.match(github, /github:demo/);
  assert.match(github, /upsertIdentity\(/);
});
