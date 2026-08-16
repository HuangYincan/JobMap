import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTRAST_TOKENS, contrastRatio, meetsContrast } from '../src/lib/contrast.ts';

test('light text tokens meet WCAG AA on frost and white', () => {
  assert.ok(meetsContrast(CONTRAST_TOKENS.inkLight, CONTRAST_TOKENS.white));
  assert.ok(meetsContrast(CONTRAST_TOKENS.inkLight, CONTRAST_TOKENS.frostLight));
  assert.ok(meetsContrast(CONTRAST_TOKENS.mutedLight, CONTRAST_TOKENS.white));
  assert.ok(meetsContrast(CONTRAST_TOKENS.mutedLight, CONTRAST_TOKENS.frostLight));
  assert.ok(meetsContrast(CONTRAST_TOKENS.blueInkLight, CONTRAST_TOKENS.white));
  assert.ok(meetsContrast(CONTRAST_TOKENS.semanticGreen, CONTRAST_TOKENS.white));
});

test('dark text tokens meet WCAG AA on frost', () => {
  assert.ok(meetsContrast(CONTRAST_TOKENS.inkDark, CONTRAST_TOKENS.frostDark));
  assert.ok(meetsContrast(CONTRAST_TOKENS.mutedDark, CONTRAST_TOKENS.frostDark));
  assert.ok(meetsContrast(CONTRAST_TOKENS.blueInkDark, CONTRAST_TOKENS.frostDark));
  assert.ok(meetsContrast(CONTRAST_TOKENS.semanticGreenDark, CONTRAST_TOKENS.frostDark));
});

test('brand blue stays a large-text / UI chrome color', () => {
  assert.ok(meetsContrast(CONTRAST_TOKENS.brandBlue, CONTRAST_TOKENS.white, 3));
  assert.ok(contrastRatio(CONTRAST_TOKENS.brandBlue, CONTRAST_TOKENS.white) < 4.5);
});
