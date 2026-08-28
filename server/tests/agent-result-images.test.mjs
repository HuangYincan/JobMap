import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentImageFromMcp,
  collectToolImages,
  extractAgentImagesFromText,
  mergeAgentImages,
  sanitizeAgentImageUrl,
} from '../src/lib/agent/result-images.ts';

test('sanitizeAgentImageUrl upgrades http, drops javascript and oversized data', () => {
  assert.equal(
    sanitizeAgentImageUrl('http://store.is.autonavi.com/showpic/a.png'),
    'https://store.is.autonavi.com/showpic/a.png',
  );
  assert.equal(sanitizeAgentImageUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeAgentImageUrl('data:text/html;base64,aaaa'), null);
  assert.equal(sanitizeAgentImageUrl('https://example.com/logo.png'), 'https://example.com/logo.png');
});

test('extractAgentImagesFromText keeps photo hosts and JSON photo keys, drops career URLs', () => {
  const text = [
    '1. 咖啡 — https://careers.example.com/apply',
    '{"photos":["https://cdn.example.com/p1"]}',
    '封面 http://store.is.autonavi.com/showpic/cafe.jpg',
  ].join('\n');
  const images = extractAgentImagesFromText(text);
  assert.deepEqual(
    images.map((i) => i.url),
    ['https://cdn.example.com/p1', 'https://store.is.autonavi.com/showpic/cafe.jpg'],
  );
});

test('collectToolImages merges explicit logos with text photos and caps at 6', () => {
  const images = collectToolImages({
    images: [{ url: 'https://cdn.example.com/logo.png', alt: '腾讯' }],
    text: 'photos: https://store.is.autonavi.com/showpic/a.jpg https://store.is.autonavi.com/showpic/a.jpg',
  });
  assert.equal(images[0].alt, '腾讯');
  assert.equal(images.length, 2);
});

test('agentImageFromMcp accepts short jpeg payload and rejects junk', () => {
  const ok = agentImageFromMcp('AAAA', 'image/jpeg');
  assert.equal(ok?.url.startsWith('data:image/jpeg;base64,'), true);
  assert.equal(agentImageFromMcp('$$$$', 'image/jpeg'), null);
  assert.equal(agentImageFromMcp('AAAA', 'application/pdf'), null);
});

test('mergeAgentImages de-duplicates', () => {
  const merged = mergeAgentImages(
    [{ url: 'https://a.example/x.png' }],
    [{ url: 'https://a.example/x.png' }, { url: 'https://b.example/y.png' }],
  );
  assert.equal(merged.length, 2);
});
