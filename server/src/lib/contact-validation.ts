export const MAX_EMAIL_LENGTH = 254;
export const MAX_PHONE_DIGITS = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{6,15}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** OTP storage, delivery, binding, and identity lookup must use one canonical key. */
export function normalizeContact(provider: 'phone' | 'email', value: string): string {
  return provider === 'phone' ? normalizePhone(value.trim()) : normalizeEmail(value);
}

export function isValidPhone(value: unknown): value is string {
  return typeof value === 'string' && PHONE_RE.test(normalizePhone(value));
}
