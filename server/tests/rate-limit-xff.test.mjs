// XFF 信任策略统一契约(quality-scan r2 #1,2026-08-23)。
// 三路由(agent/chat、auth/otp/send、auth/password/login)共享 lib/client-ip:
//   (a) 未配置 TRUSTED_PROXY_IPS → resolveClientIp 一律 null(忽略转发头)——
//       伪造/轮换 XFF 不换桶;桶键 = 会话指纹(登录用户)或固定桶(匿名)。
//   (b) 配置 TRUSTED_PROXY_IPS 也不足以验证入站 peer；未提供 verified peer 时
//       仍忽略转发头，只有独立 runtime seam 匹配 allowlist 才可读取 XFF。
//   (c) 不匹配 allowlist 的 verified peer 仍不可信。
// 纯函数直测(Request 为 node 全局,无网络依赖);路由接线用 readFileSync 契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRUSTED_PROXY_IPS,
  clientIpBucketKey,
  resolveClientIp,
  sessionFingerprintKey,
} from '../src/lib/client-ip.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

function req(headers = {}) {
  return new Request('http://localhost', { headers });
}

// --- (a) 未配置 TRUSTED_PROXY_IPS: 伪造/轮换 XFF 不换桶 -------------------------

test('(a) 未配置时 resolveClientIp 忽略 XFF / x-real-ip → 一律 null', () => {
  assert.equal(TRUSTED_PROXY_IPS.length, 0, '测试环境默认未配置可信代理');
  assert.equal(resolveClientIp(req({ 'x-forwarded-for': '1.2.3.4' })), null);
  assert.equal(resolveClientIp(req({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8' })), null);
  assert.equal(resolveClientIp(req({ 'x-real-ip': '5.6.7.8' })), null);
  assert.equal(resolveClientIp(req()), null);
});

test('(a) 轮换 XFF 桶键不变 — 匿名固定桶 anon:public;登录用户按会话指纹', () => {
  // 匿名:任何请求头组合 → 同一固定桶
  assert.equal(clientIpBucketKey(req({ 'x-forwarded-for': '1.2.3.4' }), null), 'anon:public');
  assert.equal(clientIpBucketKey(req({ 'x-forwarded-for': '9.9.9.9' }), null), 'anon:public');
  assert.equal(clientIpBucketKey(req({ 'x-real-ip': '5.6.7.8' }), null), 'anon:public');
  assert.equal(clientIpBucketKey(req(), null), 'anon:public');
  // 登录用户:同一 token 固定桶,轮换 XFF 不换桶
  const t = 'session-token-a';
  const k1 = clientIpBucketKey(req({ 'x-forwarded-for': '1.2.3.4' }), t);
  const k2 = clientIpBucketKey(req({ 'x-forwarded-for': '9.9.9.9' }), t);
  assert.equal(k1, k2);
  assert.match(k1, /^session:[0-9a-f]{64}$/);
});

// --- (c) 注册用户 / 匿名桶键不同 ------------------------------------------------

test('(c) 注册用户与匿名桶键不同;不同会话 token 不同桶;同 token 幂等', () => {
  const anon = sessionFingerprintKey(null);
  const a = sessionFingerprintKey('token-a');
  const b = sessionFingerprintKey('token-b');
  assert.equal(anon, 'anon:public');
  assert.notEqual(a, anon);
  assert.notEqual(b, anon);
  assert.notEqual(a, b);
  assert.equal(sessionFingerprintKey('token-a'), a);
});

// --- (b) 配置 TRUSTED_PROXY_IPS: 仅显式 verified peer 可启用转发头 ----------------

test('(b) 配置 TRUSTED_PROXY_IPS 但无 verified peer 时仍忽略 XFF', async () => {
  process.env.TRUSTED_PROXY_IPS = '10.0.0.1, 10.0.0.2';
  try {
    const trusted = await import(`../src/lib/client-ip.ts?trusted=${Date.now()}`);
    assert.deepEqual(trusted.TRUSTED_PROXY_IPS, ['10.0.0.1', '10.0.0.2']);
    const fwd = req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
    assert.equal(trusted.resolveClientIp(fwd), null);
    assert.match(trusted.clientIpBucketKey(fwd, 'tok'), /^session:[0-9a-f]{64}$/);
    assert.equal(trusted.resolveClientIp(req({ 'x-real-ip': '198.51.100.7' })), null);
    assert.equal(trusted.resolveClientIp(req()), null);

    // 只有独立 runtime seam 明确提供匹配 peer 时才信任 XFF；不读取请求头推断 peer。
    assert.equal(trusted.resolveClientIp(fwd, '10.0.0.1'), '203.0.113.5');
    assert.equal(trusted.clientIpBucketKey(fwd, 'tok', '10.0.0.1'), 'ip:203.0.113.5');
    assert.equal(trusted.resolveClientIp(req({ 'x-real-ip': '198.51.100.7' }), '10.0.0.2'), '198.51.100.7');
    assert.equal(trusted.resolveClientIp(req(), '10.0.0.1'), 'unknown');
    assert.equal(trusted.clientIpBucketKey(req(), 'tok', '10.0.0.1'), 'ip:unknown');
    assert.equal(trusted.resolveClientIp(fwd, '198.51.100.10'), null);
  } finally {
    delete process.env.TRUSTED_PROXY_IPS;
  }
});

// --- 路由接线契约: 三路由统一走 lib/client-ip, XFF 读取位于门控之后 --------------

test('契约: 三路由均经 lib/client-ip 解析;XFF 读取位于可信代理门控之后', () => {
  const helper = src('lib/client-ip.ts');
  const gateIdx = helper.indexOf('isTrustedProxyPeer(verifiedPeerAddress)');
  const fwdIdx = helper.indexOf("headers.get('x-forwarded-for')");
  assert.ok(gateIdx !== -1 && fwdIdx !== -1 && gateIdx < fwdIdx, 'XFF 读取必须在可信代理门控之后');
  const realIdx = helper.indexOf("headers.get('x-real-ip')");
  assert.ok(realIdx !== -1 && gateIdx < realIdx, 'x-real-ip 读取同样位于门控之后');
  for (const rel of [
    'app/api/agent/chat/route.ts',
    'app/api/auth/otp/send/route.ts',
    'app/api/auth/password/login/route.ts',
  ]) {
    const route = src(rel);
    assert.match(route, /@\/lib\/client-ip/, `${rel} 必须引用共享 helper`);
    assert.match(route, /resolveClientIp\(request\)|clientIpBucketKey\(request/, `${rel} 必须经共享解析取 per-IP 维度`);
    assert.doesNotMatch(route, /function clientIp\(/, `${rel} 不得残留内联 XFF 解析`);
  }
});
