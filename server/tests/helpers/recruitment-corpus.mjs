import test from 'node:test';
import { recruitmentCorpusAvailable } from '../../src/lib/recruitment-data-root.ts';

export { recruitmentCorpusAvailable };

/** Register a test that only runs when private JobMap-data drops are present. */
export function corpusTest(name, fn) {
  test(name, { skip: recruitmentCorpusAvailable() ? false : 'requires private JobMap-data checkout' }, fn);
}
