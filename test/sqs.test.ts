import assert from 'node:assert/strict';
import test from 'node:test';

import { toSqsFifoId } from '../src/sqs';

test('toSqsFifoId removes unsupported characters', () => {
  assert.equal(
    toSqsFifoId(
      'https://forum.square-enix.com/ffxiv/forums/537-%E3%83%86%E3%82%B9%E3%83%88'
    ),
    'httpsforum.square-enix.comffxivforums537-E38386E382B9E38388'
  );
});

test('toSqsFifoId falls back to a hash when sanitized value is empty', () => {
  const id = toSqsFifoId('%%%');

  assert.match(id, /^[a-f0-9]{64}$/);
});
