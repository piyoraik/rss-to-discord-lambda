import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maskWebhookUrl,
  sanitizeErrorForLog,
  sanitizeFeedConfigItem,
} from '../src/redaction';

test('maskWebhookUrl hides the secret token portion', () => {
  assert.equal(
    maskWebhookUrl('https://discord.com/api/webhooks/12345/abcdef'),
    'https://discord.com/api/webhooks/12345/***'
  );
});

test('sanitizeFeedConfigItem masks webhook fields', () => {
  assert.deepEqual(
    sanitizeFeedConfigItem({
      feedUrl: 'https://example.com/feed.xml',
      webhookUrl: 'https://discord.com/api/webhooks/12345/abcdef',
      webhookUrls: ['https://discord.com/api/webhooks/12345/ghijkl'],
    }),
    {
      feedUrl: 'https://example.com/feed.xml',
      webhookUrl: 'https://discord.com/api/webhooks/12345/***',
      webhookUrls: ['https://discord.com/api/webhooks/12345/***'],
    }
  );
});

test('sanitizeErrorForLog masks axios webhook URL values', () => {
  const sanitized = sanitizeErrorForLog({
    config: {
      method: 'post',
      url: 'https://discord.com/api/webhooks/12345/abcdef',
    },
    isAxiosError: true,
    message: 'Request failed with status code 400',
    name: 'AxiosError',
    response: {
      status: 400,
    },
    toJSON: () => ({}),
  });

  assert.deepEqual(sanitized, {
    code: undefined,
    message: 'Request failed with status code 400',
    method: 'post',
    name: 'AxiosError',
    status: 400,
    url: 'https://discord.com/api/webhooks/12345/***',
  });
});
