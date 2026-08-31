import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isQuotaClassReason, shouldShortCircuitQuota } from '../src/lib/site-geocode.ts';

// 2026-08-21 (fix/geocode-quota-short-circuit): AMap place-text 日配额 10044 +
// 百度兜底 302 双耗尽后, geocode-sites-apply.mjs 逐站空跑 (~1800 站零产出)。
// 短路判定: 连续 N 个已尝试站点全部配额类失败 (quota / baidu-status:302 /
// tencent-status:121|321|322 (每日上限) / tencent-status:110|112|190|199|311
// (key/IP/功能配置永久失效) / no-key) → 提前停止; 非配额类失败或成功解析
// 冲掉窗口, 不误停。2026-08-21 (feature/geocode-tencent): 腾讯族并入。

test('isQuotaClassReason: quota / baidu-status:302 / tencent 每日上限与配置失效 / no-key 是配额类', () => {
  assert.equal(isQuotaClassReason('quota'), true);
  assert.equal(isQuotaClassReason('baidu-status:302'), true);
  assert.equal(isQuotaClassReason('no-key'), true);
  // 腾讯每日调用量上限 (现行 121 + 旧文档 321/322 族)
  assert.equal(isQuotaClassReason('tencent-status:121'), true);
  assert.equal(isQuotaClassReason('tencent-status:321'), true);
  assert.equal(isQuotaClassReason('tencent-status:322'), true);
  // 腾讯 key/IP/功能配置永久失效 — 等同无兜底, 空跑也要短路
  assert.equal(isQuotaClassReason('tencent-status:110'), true);
  assert.equal(isQuotaClassReason('tencent-status:112'), true);
  assert.equal(isQuotaClassReason('tencent-status:190'), true);
  assert.equal(isQuotaClassReason('tencent-status:199'), true);
  // 311 = key 格式错误 — 永久配置失效 (2026-08-21 真实探测校准)
  assert.equal(isQuotaClassReason('tencent-status:311'), true);
});

test('isQuotaClassReason: 401 / 120 限流 / 间歇性 / 其余失败不是配额类', () => {
  // 401 是百度并发限流 (可重试) — 不算
  assert.equal(isQuotaClassReason('baidu-status:401'), false);
  // 120 是腾讯每秒限流 (可重试一次) — 不算
  assert.equal(isQuotaClassReason('tencent-status:120'), false);
  // 间歇性网络/数据问题 — 不算
  assert.equal(isQuotaClassReason('http'), false);
  assert.equal(isQuotaClassReason('empty'), false);
  assert.equal(isQuotaClassReason('parse'), false);
  assert.equal(isQuotaClassReason('no-pois'), false);
  // regeo 城市不符 — 证明配额不是卡点 — 不算
  assert.equal(isQuotaClassReason('regeo-outside:outside-city:深圳市'), false);
  assert.equal(isQuotaClassReason('regeo-outside:outside-province:广东省'), false);
  // grader 拒收 (接口有返回但没命中) — 不算
  assert.equal(isQuotaClassReason('name-mismatch:杭州得物包装实业有限公司'), false);
  assert.equal(isQuotaClassReason('manual-exclude'), false);
  assert.equal(isQuotaClassReason('address-district-mismatch'), false);
  // 空/缺失 — 不算
  assert.equal(isQuotaClassReason(undefined), false);
  assert.equal(isQuotaClassReason(null), false);
  assert.equal(isQuotaClassReason(''), false);
});

test('shouldShortCircuitQuota: 连续 5 站配额类失败 → 停', () => {
  const history = ['quota', 'baidu-status:302', 'no-key', 'quota', 'baidu-status:302'];
  assert.equal(shouldShortCircuitQuota(history), true);
});

test('shouldShortCircuitQuota: 不足 N 站不触发', () => {
  assert.equal(shouldShortCircuitQuota([]), false);
  assert.equal(shouldShortCircuitQuota(['quota', 'quota', 'quota']), false);
  assert.equal(shouldShortCircuitQuota(['quota', 'quota'], 2), true);
  assert.equal(shouldShortCircuitQuota(['quota'], 2), false);
  assert.equal(shouldShortCircuitQuota(['quota', 'quota'], 0), false);
});

test('shouldShortCircuitQuota: 中间夹非配额类失败 → 不误停', () => {
  // http 间歇失败打断连续窗口 → 不误停
  const withHttp = ['quota', 'quota', 'http', 'quota', 'baidu-status:302', 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(withHttp), false);
  // 401 并发限流打断 → 不误停
  const with401 = ['quota', 'quota', 'baidu-status:401', 'quota', 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(with401), false);
  // regeo-outside 打断 → 不误停
  const withRegeo = ['quota', 'baidu-status:302', 'regeo-outside:outside-city:深圳市', 'quota', 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(withRegeo), false);
  // 窗口滑过非配额类后, 又连续 5 个配额类 → 仍会停 (恢复后再次耗尽也停)
  const later = ['http', 'quota', 'quota', 'quota', 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(later), true);
});

test('shouldShortCircuitQuota: 配额类失败后恢复 (成功解析) → 不误停', () => {
  // 4 个配额类失败后 1 站解析成功 → 窗口含 null → 不误停
  const recovered = ['quota', 'quota', 'quota', 'quota', null, 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(recovered), false);
  // 恢复后再次连续耗尽 (null 被挤出窗口) → 停
  const recoveredThenExhausted = ['quota', 'quota', 'quota', 'quota', null, 'quota', 'quota', 'quota', 'quota', 'quota'];
  assert.equal(shouldShortCircuitQuota(recoveredThenExhausted), true);
});

test('geocode-sites-apply.mjs 接线: 连续配额类失败 → 提前停止 + exit 2', () => {
  // 契约测试 (对齐 component-contracts.test.mjs 风格): 脚本必须挂上短路 —
  // 常量、判定调用、醒目行、非零退出码、跳出主循环。
  const script = readFileSync(
    new URL('../scripts/geocode-sites-apply.mjs', import.meta.url),
    'utf8',
  );
  assert.match(script, /const QUOTA_SHORT_CIRCUIT_N = 5/);
  assert.match(script, /shouldShortCircuitQuota\(quotaHistory, QUOTA_SHORT_CIRCUIT_N\)/);
  assert.match(script, /break mainLoop/);
  assert.match(script, /mainLoop: for \(const \{ file, company, site \} of needing\)/);
  assert.match(script, /QUOTA_EXHAUSTED: AMap\+百度\+腾讯 配额耗尽/);
  assert.match(script, /process\.exit\(2\)/);
  // 解析成功冲掉窗口 — 不误停的接线点
  assert.match(script, /recordOutcome\(null\)/);
  // env 接入 (2026-08-25 fix/plan-env-load: 共享 injectEnv, 覆盖四 provider key)
  assert.match(script, /injectEnv\(\['AMAP_WEB_KEY', 'JIAOYUNTONG_MAP_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY'\]\)/);
  assert.match(script, /!env\.AMAP_WEB_KEY && !env\.BAIDU_MAP_AK && !env\.TENCENT_MAP_KEY/);
  assert.match(script, /TENCENT_MAP_KEY: \$\{env\.TENCENT_MAP_KEY \? 'set' : 'MISSING'\}/);
});
