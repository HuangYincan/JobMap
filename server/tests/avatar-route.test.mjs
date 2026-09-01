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
  const formIdx = route.indexOf('formRequest.formData');
  assert.ok(unauthIdx !== -1 && formIdx !== -1 && unauthIdx < formIdx, '401 守卫先于表单解析');
});

test('POST bounds authenticated upload frequency before multipart work', () => {
  assert.match(route, /import \{ BoundedRateStore \} from "@\/lib\/bounded-rate-store"/);
  assert.match(route, /const AVATAR_UPLOAD_MAX_PER_WINDOW = 5/);
  assert.match(route, /avatarUploadAttempts = new BoundedRateStore<number\[\]>\(/);
  assert.match(route, /code: "AVATAR_RATE_LIMITED"/);
  assert.match(route, /status: 429/);
  assert.match(route, /"Retry-After"/);

  const unauthIdx = route.indexOf('code: "UNAUTHORIZED"');
  const guardIdx = route.indexOf('checkAvatarUploadLimit(user.id, now)');
  const recordIdx = route.indexOf('recordAvatarUpload(user.id, now)');
  const contentLengthIdx = route.indexOf('contentLength > MAX_AVATAR_REQUEST_BYTES');
  const formIdx = route.indexOf('formRequest.formData()');
  const updateIdx = route.indexOf('updateAvatar(user.id, {');
  for (const idx of [guardIdx, recordIdx, contentLengthIdx, formIdx, updateIdx]) assert.notEqual(idx, -1);
  assert.ok(unauthIdx < guardIdx && guardIdx < recordIdx);
  assert.ok(recordIdx < contentLengthIdx && contentLengthIdx < formIdx && formIdx < updateIdx);
});

test('POST bounds the request stream before multipart materialization', () => {
  assert.match(route, /import \{ readBoundedRequestBody, RequestBodyTooLargeError \} from "@\/lib\/request-body"/);
  assert.match(route, /MAX_AVATAR_REQUEST_BYTES/);
  const lengthIdx = route.indexOf('contentLength > MAX_AVATAR_REQUEST_BYTES');
  const streamIdx = route.indexOf('readBoundedRequestBody(request, MAX_AVATAR_REQUEST_BYTES)');
  const formIdx = route.indexOf('formRequest.formData()');
  const fileIdx = route.indexOf('file.size > MAX_AVATAR_BYTES');
  for (const idx of [lengthIdx, streamIdx, formIdx, fileIdx]) assert.notEqual(idx, -1);
  assert.ok(lengthIdx < streamIdx && streamIdx < formIdx && formIdx < fileIdx);
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
  assert.match(route, /noStoreJson\(\{ user: next \}\)/);
});

test('GET 未登录 → 401;无头像 → 404;有头像 → 字节 + immutable 缓存', () => {
  assert.match(route, /code: "UNAUTHORIZED"/);
  assert.match(route, /code: "NOT_FOUND"/);
  assert.match(route, /"Cache-Control": "private, max-age=31536000, immutable"/);
  assert.match(route, /getAvatarData\(user\.id\)/);
});
