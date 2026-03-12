import assert from 'node:assert/strict';
import test from 'node:test';

type ResolvedFeedItem = {
  itemKey: string;
  title: string;
  link: string;
  categories: string[];
  publishedAt?: Date;
};

const matchesBaselineItemKey = (
  itemKey: string,
  baselineItemKey: string
): boolean => {
  if (itemKey === baselineItemKey) {
    return true;
  }

  const separatorIndex = itemKey.indexOf(':');
  if (separatorIndex === -1) {
    return false;
  }

  return itemKey.slice(separatorIndex + 1) === baselineItemKey;
};

const applyBaselineItemKey = (
  items: ResolvedFeedItem[],
  cfg: {
    baselineItemKey?: string;
    lastPublishedAt?: string;
    processedItemKeys?: string[];
  }
): ResolvedFeedItem[] => {
  const baselineItemKey = cfg.baselineItemKey;
  const processedCount = cfg.processedItemKeys?.length ?? 0;
  const hasBootstrapState = processedCount === 0 && !cfg.lastPublishedAt;

  if (!baselineItemKey || !hasBootstrapState) {
    return items;
  }

  const baselineIndex = items.findIndex((item) =>
    matchesBaselineItemKey(item.itemKey, baselineItemKey)
  );
  if (baselineIndex === -1) {
    return items;
  }

  return items.slice(0, baselineIndex);
};

test('baselineItemKey limits the first fetch to newer items only', () => {
  const items: ResolvedFeedItem[] = [
    {
      itemKey: 'id:525000',
      title: 'new',
      link: 'https://example.com/1',
      categories: [],
    },
    {
      itemKey: 'id:524900',
      title: 'newer',
      link: 'https://example.com/2',
      categories: [],
    },
    {
      itemKey: 'id:524736',
      title: 'baseline',
      link: 'https://example.com/3',
      categories: [],
    },
    {
      itemKey: 'id:524121',
      title: 'old',
      link: 'https://example.com/4',
      categories: [],
    },
  ];

  assert.deepEqual(
    applyBaselineItemKey(items, {
      baselineItemKey: '524736',
    }).map((item) => item.itemKey),
    ['id:525000', 'id:524900']
  );
});

test('baselineItemKey is ignored after state exists', () => {
  const items: ResolvedFeedItem[] = [
    {
      itemKey: 'id:525000',
      title: 'new',
      link: 'https://example.com/1',
      categories: [],
    },
    {
      itemKey: 'id:524736',
      title: 'baseline',
      link: 'https://example.com/3',
      categories: [],
    },
  ];

  assert.deepEqual(
    applyBaselineItemKey(items, {
      baselineItemKey: '524736',
      processedItemKeys: ['id:525000'],
    }).map((item) => item.itemKey),
    ['id:525000', 'id:524736']
  );
});

const applyHtmlTitleBaseline = (
  items: ResolvedFeedItem[],
  cfg: {
    baselineTitle?: string;
    latestTitle?: string;
    sourceType?: 'rss' | 'html';
  }
): ResolvedFeedItem[] => {
  if (cfg.sourceType !== 'html') {
    return items;
  }

  const stateTitle = cfg.latestTitle ?? cfg.baselineTitle;
  if (!stateTitle) {
    return items;
  }

  const titleIndex = items.findIndex((item) => item.title === stateTitle);
  if (titleIndex === -1) {
    return [];
  }

  return items.slice(0, titleIndex);
};

test('latestTitle limits HTML candidates to entries above the last seen title', () => {
  const items: ResolvedFeedItem[] = [
    {
      itemKey: 'id:525100',
      title: 'new 1',
      link: 'https://example.com/1',
      categories: [],
    },
    {
      itemKey: 'id:525000',
      title: 'new 2',
      link: 'https://example.com/2',
      categories: [],
    },
    {
      itemKey: 'id:524736',
      title: 'seen title',
      link: 'https://example.com/3',
      categories: [],
    },
  ];

  assert.deepEqual(
    applyHtmlTitleBaseline(items, {
      latestTitle: 'seen title',
      sourceType: 'html',
    }).map((item) => item.title),
    ['new 1', 'new 2']
  );
});

test('HTML title baseline returns no candidates when the reference title is missing', () => {
  const items: ResolvedFeedItem[] = [
    {
      itemKey: 'id:525100',
      title: 'new 1',
      link: 'https://example.com/1',
      categories: [],
    },
  ];

  assert.deepEqual(
    applyHtmlTitleBaseline(items, {
      baselineTitle: 'missing title',
      sourceType: 'html',
    }),
    []
  );
});
