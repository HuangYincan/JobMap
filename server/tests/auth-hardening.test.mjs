// ============================================================
// 认证安全加固(scan 批次 A:ws-a)
//   #1 OTP 单次消费契约(DB 模式可重放缺陷,account-store consumeOtp)
//   #2 OTP 发送 per-IP / per-账号 24h 桶(checkOtpSendLimits)
//   #3  密码登录防爆破(route 滑动窗口)+ 查无此人 dummy verify(时间侧信道)
//   #4  SESSION_SECRET:生产必配 / 非生产 boot 随机并与 oauth-state 统一
//
// 参照仓库既有模式(otp-guard / account-security / oauth):
//   - store 层直测:__accountStoreTest.poolOverride 注入 fake 池 / 强制内存模式;
//   - route 薄壳用 readFileSync + 正则断言守卫(route.ts 用 next/server + `@/`
//     别名,node:test 无法直接 import,仓库既有契约)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __accountStoreTest,
  consumeOtp as storeConsumeOtp,
  issueOtp as storeIssueOtp,
} from '../src/lib/account-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

/** 模拟 auth_otp_challenges 的 DB fake 池:按 code_hash 匹配、consumed 即失效。 */
function otpDbPool() {
  let seq = 0;
  const challenges = [];
  return {
    query: async (sql, params = []) => {
      if (sql.includes('DELETE FROM auth_otp_challenges')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO auth_otp_challenges')) {
        challenges.push({
          id: String(++seq),
          provider: params[0],
          target: params[1],
          codeHash: params[2],
          expiresAtMs: params[3],
          consumed: false,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM auth_otp_challenges') && sql.includes('code_hash')) {
        const row = challenges.find(
          (c) =>
            !c.consumed &&
            c.provider === params[0] &&
            c.target === params[1] &&
            c.expiresAtMs > Date.now() &&
            c.codeHash === params[2],
        );
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('UPDATE auth_otp_challenges SET consumed_at')) {
        const hit = challenges.find((c) => c.id === params[0]);
        if (hit) hit.consumed = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in otp fake pool: ${sql}`);
    },
  };
}

// ============================================================
// #1 OTP 单次消费契约
// ============================================================

test('#1 内存模式:同一 code 二次 consume 必 false', async () => {
  __accountStoreTest.poolOverride = () => null;
  try {
    const target = `mem-single-${Date.now()}@test.local`;
    const { code } = await storeIssueOtp('email', target);
    assert.equal(await storeConsumeOtp('email', target, code), true);
    assert.equal(await storeConsumeOtp('email', target, code), false);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('#1 DB 模式:同一 code 二次 consume 必 false(成功路径已消费内存挑战,不可重放)', async () => {
  // poolOverride 每次调用 getPoolForCall 都会取一次:必须共享同一池实例(状态在池内)。
  const pool = otpDbPool();
  __accountStoreTest.poolOverride = () => pool;
  try {
    const target = `db-single-${Date.now()}@test.local`;
    const { code } = await storeIssueOtp('email', target);
    assert.equal(await storeConsumeOtp('email', target, code), true);
    assert.equal(await storeConsumeOtp('email', target, code), false);
    // 独立 target 不受影响:错码 false → 正确码 true(原契约保持)
    const t2 = `db-single2-${Date.now()}@test.local`;
    const { code: code2 } = await storeIssueOtp('email', t2);
    assert.equal(await storeConsumeOtp('email', t2, '000000'), false);
    assert.equal(await storeConsumeOtp('email', t2, code2), true);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});
