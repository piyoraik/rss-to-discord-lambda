import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type { APIGatewayProxyResult } from 'aws-lambda';

interface FeedItem {
  title: string;
  link: string;
  publishedAt: Date;
  categories: string[];
}

interface FeedConfig {
  feedUrl: string;
  webhookUrl?: string;
  categoryTerm?: string;
  titleIncludes?: string;
  lastPublishedAt?: string;
}

const STATE_TABLE = process.env.STATE_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;

const MAX_POSTS_PER_FEED = 20;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

/** 環境変数の存在チェックを行う */
const validateEnv = () => {
  if (!STATE_TABLE) throw new Error('STATE_TABLE is not set');
  if (!QUEUE_URL) throw new Error('QUEUE_URL is not set');
};

/** XML ノードからテキストを抽出する */
const extractText = (value: any): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return extractText(value[0]);
  }
  if (typeof value === 'object') {
    return (
      value['#text'] ??
      value['__cdata'] ??
      value['cdata'] ??
      value['value'] ??
      value['href'] ??
      ''
    );
  }
  return '';
};

/** XML ノードからリンク URL を抽出する（Atom/RSS 両対応） */
const extractLink = (value: any): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // Prefer Atom-style link with rel=alternate, otherwise href/self/first.
    const altLink = value.find((v) => v?.rel === 'alternate' && v?.href);
    const hrefLink = altLink ?? value.find((v) => v?.href);
    return extractLink(hrefLink ?? value[0]);
  }
  if (typeof value === 'object') {
    return (
      value.href ??
      value.url ??
      value.link ??
      value['#text'] ??
      value['__cdata'] ??
      ''
    );
  }
  return '';
};

/** RSS/Atom XML から記事一覧を取り出す */
const parseFeedItems = (xml: string): FeedItem[] => {
  const parsed = parser.parse(xml);
  const rawItems =
    parsed?.rss?.channel?.item ??
    parsed?.feed?.entry ??
    parsed?.rdf?.item ??
    [];

  const items: any[] = Array.isArray(rawItems)
    ? rawItems
    : rawItems
    ? [rawItems]
    : [];

  return items
    .map((item) => {
      const title = extractText(item.title) || 'No title';
      const link = extractLink(item.link) || extractLink(item.guid) || '';
      const rawDate =
        item.pubDate ??
        item.published ??
        item.updated ??
        item['dc:date'] ??
        item.date;
      const publishedAt = rawDate ? new Date(rawDate) : null;
      const rawCategories =
        item.category ??
        item.categories ??
        item.tag ??
        item.tags ??
        item['dc:subject'] ??
        [];
      const categories: string[] = (Array.isArray(rawCategories) ? rawCategories : [rawCategories])
        .map((c) => {
          if (typeof c === 'string') return c;
          if (typeof c === 'object') {
            return (
              c.term ??
              c.label ??
              c['#text'] ??
              c['__cdata'] ??
              c.value ??
              ''
            );
          }
          return '';
        })
        .filter(Boolean);

      if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;
      return { title, link, publishedAt, categories };
    })
    .filter((i): i is FeedItem => Boolean(i));
};

/** Discord Webhook へメッセージを送信する */
const enqueueItems = async (items: FeedItem[], cfg: FeedConfig) => {
  for (const item of items) {
    const payload = {
      feedUrl: cfg.feedUrl,
      webhookUrl: cfg.webhookUrl,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt.toISOString(),
    };
    // SQS FIFO の MessageDeduplicationId は英数字と一部記号のみ許容されるためサニタイズする
    const dedupRaw = `${cfg.feedUrl}-${item.publishedAt.toISOString()}-${item.link}`;
    const dedupId = dedupRaw.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 128) || Buffer.from(dedupRaw).toString('base64').slice(0, 128);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL!,
        MessageGroupId: cfg.feedUrl,
        MessageDeduplicationId: dedupId,
        MessageBody: JSON.stringify(payload),
      })
    );
  }
};

/** DynamoDB からフィード設定（lastProcessed を含む）を取得する */
const loadFeedConfigs = async (): Promise<FeedConfig[]> => {
  const configs: FeedConfig[] = [];
  let lastKey: Record<string, any> | undefined;
  try {
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: STATE_TABLE!,
          ProjectionExpression: 'feedUrl, webhookUrl, categoryTerm, titleIncludes, lastPublishedAt',
          ExclusiveStartKey: lastKey,
        })
      );
      for (const item of res.Items ?? []) {
        if (!item.feedUrl) continue;
        configs.push({
          feedUrl: item.feedUrl,
          webhookUrl: item.webhookUrl,
          categoryTerm: item.categoryTerm,
          titleIncludes: item.titleIncludes,
          lastPublishedAt: item.lastPublishedAt,
        });
      }
      lastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
  } catch (err) {
    console.error('Failed to scan STATE_TABLE for feed configs', err);
    throw err;
  }
  return configs;
};

/** 指定フィードの新着を抽出し Discord に投稿、状態を更新する */
const processFeed = async (cfg: FeedConfig): Promise<void> => {
  const feedUrl = cfg.feedUrl;
  const lastProcessed = cfg.lastPublishedAt ? new Date(cfg.lastPublishedAt) : null;
  const webhookUrl = cfg.webhookUrl;
  if (!webhookUrl) {
    console.error(`No webhook configured for feed ${feedUrl}; skipping`);
    return;
  }
  const categoryTerm = cfg.categoryTerm;
  const titleIncludes = cfg.titleIncludes;

  console.log(`Processing feed: ${feedUrl} (last processed: ${lastProcessed?.toISOString() ?? 'never'})`);

  const response = await axios.get(feedUrl, { timeout: 15000 });
  const items = parseFeedItems(response.data);

  const newItems = items
    .filter((item) => {
      if (!lastProcessed) return true;
      return item.publishedAt > lastProcessed;
    })
    .filter((item) => {
      if (categoryTerm) {
        return item.categories.includes(categoryTerm);
      }
      return true;
    })
    .filter((item) => {
      if (titleIncludes) {
        return item.title.includes(titleIncludes);
      }
      return true;
    })
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
    .slice(0, MAX_POSTS_PER_FEED);

  console.log(`Found ${newItems.length} new items for feed ${feedUrl}`);

  await enqueueItems(newItems, cfg);
  console.log(`Enqueued items for ${feedUrl}: count=${newItems.length}`);
};

// エントリーポイント: 設定されたフィードを処理し、Discord へ投稿し、進捗を保存する
export const rssHandler = async (): Promise<APIGatewayProxyResult> => {
  validateEnv();

  const configs = await loadFeedConfigs();
  if (configs.length === 0) {
    throw new Error('No RSS feeds configured in DynamoDB');
  }

  for (const cfg of configs) {
    try {
      await processFeed(cfg);
    } catch (err) {
      console.error(`Error processing feed ${cfg.feedUrl}`, err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'RSS processing completed' }),
  };
};
