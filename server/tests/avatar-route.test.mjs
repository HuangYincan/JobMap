// /api/me/avatar 路由契约测试(api-hardening 同款:readFileSync + 正则断言)。
// 校验逻辑本体在 lib/avatar-image.ts(avatar-image.test.mjs 直测字节),
// 这里断言 route 的守卫顺序、错误码与响应形状。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

const route = src('app/api/me/avatar/route.ts');

test('POST /api/me/avatar 未登录 → 401(守卫在解析表单之前)', () => {
  const unauthIdx = route.indexOf('code: "UNAUTHORIZED"');
  const formIdx = route.indexOf('request.formData');
  assert.ok(unauthIdx !== -1 && formIdx !== -1 && unauthIdx < formIdx, '401 守卫先于表单解析');
});

test('POST 校验:缺 file 字段 / 非图片 / 超限 → 400 并带对应 code', () => {
  assert.match(route, /missing file field/);
  assert.match(route, /"AVATAR_TOO_LARGE"/);
  assert.match(route, /"INVALID_AVATAR"/);
  assert.match(route, /code: "BAD_REQUEST"/);
  // 校验走 lib/avatar-image(常量与逻辑在单测直测,route 不重复实现)
  assert.match(route, /checkAvatarImage\(bytes\)/);
  assert.match(route, /status: 400/);
});

test('POST 成功 → 版本化 URL(/api/me/avatar?v=) 写入 user.avatarUrl', () => {
  assert.match(route, /updateAvatar\(user\.id, \{/);
  assert.match(route, /`\/api\/me\/avatar\?v=\$\{Date\.now\(\)\}`/);
  assert.match(route, /NextResponse\.json\(\{ user: next \}\)/);
});

test('GET 未登录 → 401;无头像 → 404;有头像 → 字节 + immutable 缓存', () => {
  assert.match(route, /code: "UNAUTHORIZED"/);
  assert.match(route, /code: "NOT_FOUND"/);
  assert.match(route, /"Cache-Control": "private, max-age=31536000, immutable"/);
  assert.match(route, /getAvatarData\(user\.id\)/);
});
