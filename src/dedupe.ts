/**
 * ParsedFeedItem から差分判定用の itemKey と公開日時を解決する。
 * dedupeStrategy と dateField に応じて、通知判定に使う正規化済み情報を返す。
 */
import { createHash } from 'node:crypto';

import type { ParsedFeedItem } from '@/feed-parser';

export type DedupeStrategy = 'auto' | 'link_only' | 'date_only' | 'id_only';
export type DateField = 'published' | 'updated' | 'pubDate' | 'dc:date';

export type ResolvedFeedItem = {
  title: string;
  link: string;
  itemKey: string;
  publishedAt?: Date;
  categories: string[];
};

const hashValue = (value: string): string => {
  return createHash('sha256').update(value).digest('hex');
};

const toItemKey = (prefix: string, value: string): string => {
  return `${prefix}:${value}`;
};

const pickDateField = (
  item: ParsedFeedItem,
  dateField?: DateField
): Date | undefined => {
  if (dateField === 'published') {
    return item.dates.published ?? item.dates.updated;
  }

  if (dateField === 'updated') {
    return item.dates.updated ?? item.dates.published;
  }

  if (dateField === 'pubDate') {
    return item.dates.pubDate;
  }

  if (dateField === 'dc:date') {
    return item.dates.dcDate;
  }

  return (
    item.dates.published ??
    item.dates.updated ??
    item.dates.pubDate ??
    item.dates.dcDate ??
    item.dates.date
  );
};

const buildAutoKey = (item: ParsedFeedItem): string => {
  const identifier = item.identifiers.id ?? item.identifiers.guid ?? item.link;
  if (identifier) {
    return toItemKey('key', identifier);
  }

  if (item.link) {
    return toItemKey('link', item.link);
  }

  if (item.title && item.link) {
    return toItemKey('hash', hashValue(`${item.title}:${item.link}`));
  }

  return toItemKey('hash', hashValue(item.title));
};

export const resolveFeedItem = (
  item: ParsedFeedItem,
  dedupeStrategy: DedupeStrategy = 'auto',
  dateField?: DateField
): ResolvedFeedItem | null => {
  if (!item.link) {
    return null;
  }

  const publishedAt = pickDateField(item, dateField);

  if (dedupeStrategy === 'link_only') {
    return {
      categories: item.categories,
      itemKey: toItemKey('link', item.link),
      link: item.link,
      publishedAt,
      title: item.title,
    };
  }

  if (dedupeStrategy === 'id_only') {
    const identifier = item.identifiers.id ?? item.identifiers.guid;
    if (!identifier) {
      return null;
    }

    return {
      categories: item.categories,
      itemKey: toItemKey('id', identifier),
      link: item.link,
      publishedAt,
      title: item.title,
    };
  }

  if (dedupeStrategy === 'date_only') {
    if (!publishedAt) {
      return null;
    }

    return {
      categories: item.categories,
      itemKey: buildAutoKey(item),
      link: item.link,
      publishedAt,
      title: item.title,
    };
  }

  return {
    categories: item.categories,
    itemKey: buildAutoKey(item),
    link: item.link,
    publishedAt,
    title: item.title,
  };
};
