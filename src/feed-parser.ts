/**
 * RSS / Atom XML を共通の ParsedFeedItem 形式へ正規化する。
 * feed の種類差分を吸収し、識別子・リンク・カテゴリ・日時候補を抽出する。
 */
export type ParsedFeedItem = {
  title: string;
  link: string;
  categories: string[];
  identifiers: {
    guid?: string;
    id?: string;
  };
  dates: {
    date?: Date;
    dcDate?: Date;
    pubDate?: Date;
    published?: Date;
    updated?: Date;
  };
};

type XmlObject = Record<string, unknown>;

const isXmlObject = (value: unknown): value is XmlObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const extractText = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return extractText(value[0]);
  }

  if (!isXmlObject(value)) {
    return '';
  }

  return (
    extractText(value['#text']) ||
    extractText(value.__cdata) ||
    extractText(value.cdata) ||
    extractText(value.value) ||
    extractText(value.href)
  );
};

const extractLink = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const alternateLink = value.find((item) => {
      if (!isXmlObject(item)) {
        return false;
      }

      return item.rel === 'alternate' && typeof item.href === 'string';
    });
    const hrefLink =
      alternateLink ??
      value.find((item) => isXmlObject(item) && typeof item.href === 'string');

    return extractLink(hrefLink ?? value[0]);
  }

  if (!isXmlObject(value)) {
    return '';
  }

  return (
    extractText(value.href) ||
    extractText(value.url) ||
    extractText(value.link) ||
    extractText(value['#text']) ||
    extractText(value.__cdata)
  );
};

const toXmlObjectArray = (value: unknown): XmlObject[] => {
  if (Array.isArray(value)) {
    return value.filter(isXmlObject);
  }

  return isXmlObject(value) ? [value] : [];
};

const extractCategories = (item: XmlObject): string[] => {
  const rawCategories =
    item.category ??
    item.categories ??
    item.tag ??
    item.tags ??
    item['dc:subject'] ??
    [];

  const categoryValues = Array.isArray(rawCategories)
    ? rawCategories
    : [rawCategories];

  return categoryValues
    .map((category) => {
      if (typeof category === 'string') {
        return category;
      }

      if (!isXmlObject(category)) {
        return '';
      }

      return (
        extractText(category.term) ||
        extractText(category.label) ||
        extractText(category['#text']) ||
        extractText(category.__cdata) ||
        extractText(category.value)
      );
    })
    .filter((category): category is string => category.length > 0);
};

const extractDate = (value: unknown): Date | undefined => {
  const text = extractText(value);
  if (!text) {
    return undefined;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const parseFeedItems = (
  xml: string,
  parser: { parse: (input: string) => unknown }
): ParsedFeedItem[] => {
  const parsed = parser.parse(xml);
  const root = isXmlObject(parsed) ? parsed : {};
  const rawItems =
    (isXmlObject(root.rss) && isXmlObject(root.rss.channel)
      ? root.rss.channel.item
      : undefined) ??
    (isXmlObject(root.feed) ? root.feed.entry : undefined) ??
    (isXmlObject(root.rdf) ? root.rdf.item : undefined) ??
    [];

  return toXmlObjectArray(rawItems)
    .map((item) => {
      const title = extractText(item.title) || 'No title';
      const link = extractLink(item.link) || extractLink(item.guid);
      const categories = extractCategories(item);
      const identifiers = {
        guid: extractText(item.guid) || undefined,
        id: extractText(item.id) || undefined,
      };
      const dates = {
        date: extractDate(item.date),
        dcDate: extractDate(item['dc:date']),
        pubDate: extractDate(item.pubDate),
        published: extractDate(item.published),
        updated: extractDate(item.updated),
      };

      return { title, link, categories, identifiers, dates };
    })
    .filter((item) => item.link.length > 0);
};
