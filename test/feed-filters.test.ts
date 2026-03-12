import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchesTitleIncludes,
  normalizeStringListInput,
} from '../src/feed-filters';

test('normalizeStringListInput converts a string into an array', () => {
  assert.deepEqual(normalizeStringListInput('maintenance'), ['maintenance']);
});

test('normalizeStringListInput converts a Set into an array', () => {
  assert.deepEqual(
    normalizeStringListInput(new Set(['maintenance', 'important'])),
    ['maintenance', 'important']
  );
});

test('matchesTitleIncludes uses OR matching', () => {
  assert.equal(
    matchesTitleIncludes('全ワールド メンテナンス', ['障害', '全ワールド']),
    true
  );
  assert.equal(
    matchesTitleIncludes('通常のお知らせ', ['障害', '全ワールド']),
    false
  );
});
