/**
 * HTML 一覧ページから selector 指定で通知対象 item を抽出する。
 * forum のようなスレッド一覧を ParsedFeedItem へ変換し、後続の差分判定へ渡す。
 */
import { load } from 'cheerio';

import type { ParsedFeedItem } from '@/feed-parser';

const normalizeIdentifier = (value: string): string => {
  const trimmed = value.trim();
  const numericSuffixMatch = /(?:^|_)(\d+)$/.exec(trimmed);

  return numericSuffixMatch?.[1] ?? trimmed;
};

const getFirstNonEmpty = (
  ...values: Array<string | undefined>
): string | undefined => {
  return values
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
};

export const parseHtmlItems = (
  html: string,
  feedUrl: string,
  itemSelector: string,
  linkSelector: string,
  titleSelector: string
): ParsedFeedItem[] => {
  const $ = load(html);
  const baseUrl = $('base').attr('href')?.trim() || feedUrl;

  return $(itemSelector)
    .toArray()
    .map((element) => {
      const item = $(element);
      const linkElement = item.find(linkSelector).first();
      const titleElement = item.find(titleSelector).first();
      const href = linkElement.attr('href');
      const link = href ? new URL(href, baseUrl).toString() : '';
      const title =
        titleElement.text().trim() || linkElement.text().trim() || 'No title';
      const rawIdentifier = getFirstNonEmpty(
        linkElement.attr('id'),
        item.attr('id')
      );
      const id = rawIdentifier ? normalizeIdentifier(rawIdentifier) : undefined;

      return {
        categories: [],
        dates: {},
        identifiers: {
          id,
        },
        link,
        title,
      };
    })
    .filter((item) => item.link.length > 0);
};
