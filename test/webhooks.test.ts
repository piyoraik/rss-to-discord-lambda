import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeWebhookUrls } from '../src/webhooks';

test('normalizeWebhookUrls prefers webhookUrls when provided', () => {
  assert.deepEqual(
    normalizeWebhookUrls({
      webhookUrl: 'https://example.com/one',
      webhookUrls: ['https://example.com/two', 'https://example.com/three'],
    }),
    ['https://example.com/two', 'https://example.com/three']
  );
});

test('normalizeWebhookUrls falls back to webhookUrl', () => {
  assert.deepEqual(
    normalizeWebhookUrls({
      webhookUrl: 'https://example.com/one',
    }),
    ['https://example.com/one']
  );
});

test('Set values can be converted to arrays before normalization', () => {
  assert.deepEqual(
    normalizeWebhookUrls({
      webhookUrls: Array.from(new Set(['https://example.com/one'])),
    }),
    ['https://example.com/one']
  );
});
