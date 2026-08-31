import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_JSON_BODY_MAX_CHARS,
  readBoundedRequestBody,
  readJsonBody,
  RequestBodyTooLargeError,
} from '../src/lib/request-body.ts';

function jsonRequest(body) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

test('readBoundedRequestBody cancels and rejects an oversized stream', async () => {
  let cancelCalls = 0;
  const chunk = new Uint8Array(16).fill(120);
  const request = {
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: chunk }),
        cancel: async () => {
          cancelCalls += 1;
        },
      }),
    },
  };

  await assert.rejects(
    readBoundedRequestBody(request, 16),
    RequestBodyTooLargeError,
  );
  assert.equal(cancelCalls, 1);
});

test('readJsonBody preserves multibyte characters within the character limit', async () => {
  const text = '中'.repeat(20);
  assert.deepEqual(await readJsonBody(jsonRequest({ text }), 31), { text });
});

test('readJsonBody parses bounded JSON', async () => {
  assert.deepEqual(await readJsonBody(jsonRequest({ ok: true }), 64), { ok: true });
});

test('readJsonBody rejects oversized bodies before JSON.parse semantics', async () => {
  const request = jsonRequest(JSON.stringify({ value: 'x'.repeat(128) }));
  await assert.rejects(readJsonBody(request, 64), RequestBodyTooLargeError);
});

test('readJsonBody rejects malformed JSON with SyntaxError', async () => {
  await assert.rejects(readJsonBody(jsonRequest('{broken'), 64), SyntaxError);
  assert.equal(DEFAULT_JSON_BODY_MAX_CHARS, 16 * 1024);
});
