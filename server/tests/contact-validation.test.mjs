import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_EMAIL_LENGTH,
  isValidEmail,
  isValidPhone,
  normalizeContact,
  normalizeEmail,
  normalizePhone,
} from '../src/lib/contact-validation.ts';

test('contact validation bounds email and phone keys', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('user@'), false);
  assert.equal(isValidEmail(`${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`), false);
  assert.equal(isValidEmail('x'.repeat(16_000)), false);

  assert.equal(isValidPhone('+86 138-0013-8000'), true);
  assert.equal(normalizePhone('+86 138-0013-8000'), '+8613800138000');
  assert.equal(isValidPhone('13800138'), true);
  assert.equal(isValidPhone('12345'), false);
  assert.equal(isValidPhone('1'.repeat(16_000)), false);
});

test('contact normalization produces the canonical OTP/identity key', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizePhone(' +86 138-0013-8000 '), '+8613800138000');
  assert.equal(normalizeContact('email', 'User@Example.COM'), 'user@example.com');
  assert.equal(normalizeContact('phone', '+86 138-0013-8000'), '+8613800138000');
});
