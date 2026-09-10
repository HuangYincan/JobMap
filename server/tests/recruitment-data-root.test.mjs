import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  defaultDropDir,
  jobMapDataDir,
  recruitmentCorpusAvailable,
  recruitmentDataRoot,
} from '../src/lib/recruitment-data-root.ts';

describe('recruitment-data-root', { concurrency: false }, () => {
  test('JOBMAP_DATA_DIR wins over sibling/in-repo discovery', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobmap-data-'));
    mkdirSync(join(dir, 'recruitment', 'radar'), { recursive: true });
    writeFileSync(join(dir, 'recruitment', 'radar', 'demo.json'), '{}\n');
    const previous = process.env.JOBMAP_DATA_DIR;
    process.env.JOBMAP_DATA_DIR = dir;
    try {
      assert.equal(jobMapDataDir(), dir);
      assert.equal(recruitmentDataRoot(), join(dir, 'recruitment'));
      assert.equal(defaultDropDir('radar'), join(dir, 'recruitment', 'radar'));
      assert.equal(recruitmentCorpusAvailable(), true);
    } finally {
      if (previous === undefined) delete process.env.JOBMAP_DATA_DIR;
      else process.env.JOBMAP_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaultDropDir folders stay under recruitmentDataRoot', () => {
    const root = recruitmentDataRoot();
    assert.equal(defaultDropDir('official-career'), join(root, 'official-career'));
    assert.equal(defaultDropDir('radar').startsWith(root), true);
  });
});
