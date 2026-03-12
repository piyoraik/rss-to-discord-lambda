import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';

import { parseFeedItems } from '../src/feed-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

test('parseFeedItems parses RSS items and categories', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Maintenance Notice</title>
          <link>https://example.com/rss-1</link>
          <pubDate>Thu, 12 Mar 2026 01:00:00 GMT</pubDate>
          <category>maintenance</category>
        </item>
      </channel>
    </rss>`;

  const items = parseFeedItems(xml, parser);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, 'Maintenance Notice');
  assert.equal(items[0]?.link, 'https://example.com/rss-1');
  assert.deepEqual(items[0]?.categories, ['maintenance']);
  assert.equal(
    items[0]?.dates.pubDate?.toISOString(),
    '2026-03-12T01:00:00.000Z'
  );
  assert.equal(items[0]?.identifiers.guid, undefined);
});

test('parseFeedItems prefers Atom alternate links', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom Entry</title>
        <link rel="self" href="https://example.com/self" />
        <link rel="alternate" href="https://example.com/alternate" />
        <updated>2026-03-12T03:04:05Z</updated>
      </entry>
    </feed>`;

  const items = parseFeedItems(xml, parser);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.link, 'https://example.com/alternate');
  assert.equal(
    items[0]?.dates.updated?.toISOString(),
    '2026-03-12T03:04:05.000Z'
  );
});
