import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFeedItem } from '../src/dedupe';
import type { ParsedFeedItem } from '../src/feed-parser';

const baseItem: ParsedFeedItem = {
  categories: [],
  dates: {
    published: new Date('2026-03-12T01:00:00.000Z'),
    updated: new Date('2026-03-12T02:00:00.000Z'),
  },
  identifiers: {
    id: 'entry-1',
  },
  link: 'https://example.com/entry-1',
  title: 'Entry 1',
};

test('resolveFeedItem uses id for auto strategy', () => {
  const item = resolveFeedItem(baseItem, 'auto');

  assert.equal(item?.itemKey, 'key:entry-1');
  assert.equal(item?.publishedAt?.toISOString(), '2026-03-12T01:00:00.000Z');
});

test('resolveFeedItem uses link for link_only strategy', () => {
  const item = resolveFeedItem(baseItem, 'link_only');

  assert.equal(item?.itemKey, 'link:https://example.com/entry-1');
});

test('resolveFeedItem uses requested updated field for date_only strategy', () => {
  const item = resolveFeedItem(baseItem, 'date_only', 'updated');

  assert.equal(item?.publishedAt?.toISOString(), '2026-03-12T02:00:00.000Z');
});

test('resolveFeedItem skips id_only when identifier is missing', () => {
  const item = resolveFeedItem(
    {
      ...baseItem,
      identifiers: {},
    },
    'id_only'
  );

  assert.equal(item, null);
});
