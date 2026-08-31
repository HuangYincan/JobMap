import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextSuggestionIndex, suggestKeyAction } from '../src/lib/suggest-nav.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('nextSuggestionIndex wraps at both ends', () => {
  assert.equal(nextSuggestionIndex(-1, 3, 1), 0);
  assert.equal(nextSuggestionIndex(2, 3, 1), 0);
  assert.equal(nextSuggestionIndex(0, 3, -1), 2);
  assert.equal(nextSuggestionIndex(-1, 0, 1), -1);
});

test('suggestKeyAction picks, commits, and closes', () => {
  assert.deepEqual(suggestKeyAction('ArrowDown', -1, 4), { type: 'move', index: 0 });
  assert.deepEqual(suggestKeyAction('Enter', 1, 4), { type: 'pick', index: 1 });
  assert.deepEqual(suggestKeyAction('Enter', -1, 4), { type: 'commit' });
  assert.deepEqual(suggestKeyAction('Escape', 2, 4), { type: 'close' });
  assert.deepEqual(suggestKeyAction('a', 0, 4), { type: 'none' });
});

test('search boxes are comboboxes with a shared keyboard helper', () => {
  const sidebar = readFileSync(join(root, 'components/secondary-sidebar.tsx'), 'utf8');
  const shell = readFileSync(join(root, 'components/map-shell.tsx'), 'utf8');
  assert.match(sidebar, /role="combobox"/);
  assert.match(sidebar, /suggestKeyAction/);
  assert.match(sidebar, /aria-activedescendant/);
  assert.match(shell, /role="combobox"/);
  assert.match(shell, /suggestKeyAction/);
  assert.match(shell, /id="mobile-suggest"/);
});
