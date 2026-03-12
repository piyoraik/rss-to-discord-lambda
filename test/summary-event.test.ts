import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../src/summary';

process.env.BEDROCK_REGION = 'ap-northeast-1';
process.env.MODEL_ID = 'amazon.nova-lite-v1:0';
process.env.STATE_TABLE = 'dummy-table';

test('summary handler ignores non-SQS events', async () => {
  await assert.doesNotReject(handler({ foo: 'bar' }));
});
