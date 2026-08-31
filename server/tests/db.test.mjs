import test from 'node:test';
import assert from 'node:assert/strict';

import { queryPublicRead } from '../src/lib/db.ts';

test('queryPublicRead fails a delayed injected read within its timeout', async () => {
  const pool = {
    async query() {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { rows: [] };
    },
  };
  await assert.rejects(
    queryPublicRead(pool, 'SELECT 1', [], 5),
    (error) => error?.name === 'PublicReadTimeoutError',
  );
});
