/**
 * 監視対象の RSS / HTML 一覧ページを取得し、差分判定後の通知候補を SQS へ投入する。
 * DynamoDB 上の監視設定を読み込み、取得方式やフィルタ条件を切り替える。
 * HTML 監視時は baselineTitle / latestTitle を使って初回基準と継続監視を制御する。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { APIGatewayProxyResult } from 'aws-lambda';

import {
  resolveFeedItem,
  type DateField,
  type DedupeStrategy,
  type ResolvedFeedItem,
} from '@/dedupe';
import { ConfigurationError } from '@/errors';
import { matchesTitleIncludes, normalizeStringListInput } from '@/feed-filters';
import { parseFeedItems } from '@/feed-parser';
import { parseHtmlItems } from '@/html-parser';
import { logger } from '@/logger';
import { sanitizeErrorForLog, sanitizeFeedConfigItem } from '@/redaction';
import { toSqsFifoId } from '@/sqs';
import { normalizeWebhookUrls } from '@/webhooks';

type SourceType = 'rss' | 'html';

type FeedConfig = {
  baselineItemKey?: string;
  baselineTitle?: string;
  dateField?: DateField;
  dedupeStrategy?: DedupeStrategy;
  feedUrl: string;
  htmlItemSelector?: string;
  htmlLinkSelector?: string;
  htmlTitleSelector?: string;
  lastPublishedAt?: string;
  latestTitle?: string;
  processedItemKeys?: string[];
  categoryTerm?: string;
  sourceType?: SourceType;
  titleIncludes?: string[];
  webhookUrl?: string;
  webhookUrls?: string[];
};

const STATE_TABLE = process.env.STATE_TABLE;
const QUEUE_URL = process.env.QUEUE_URL;

const MAX_POSTS_PER_FEED = 20;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
});

const feedConfigSchema = z
  .object({
    baselineItemKey: z.string().min(1).optional(),
    baselineTitle: z.string().min(1).optional(),
    dateField: z
      .enum(['published', 'updated', 'pubDate', 'dc:date'])
      .optional(),
    dedupeStrategy: z
      .enum(['auto', 'link_only', 'date_only', 'id_only'])
      .optional(),
    feedUrl: z.string().min(1),
    htmlItemSelector: z.string().min(1).optional(),
    htmlLinkSelector: z.string().min(1).optional(),
    htmlTitleSelector: z.string().min(1).optional(),
    lastPublishedAt: z.string().min(1).optional(),
    latestTitle: z.string().min(1).optional(),
    processedItemKeys: z.preprocess(
      normalizeStringListInput,
      z.array(z.string().min(1)).optional()
    ),
    webhookUrl: z.string().min(1).optional(),
    webhookUrls: z.preprocess(
      normalizeStringListInput,
      z.array(z.string().min(1)).optional()
    ),
    categoryTerm: z.string().min(1).optional(),
    sourceType: z.enum(['rss', 'html']).optional(),
    titleIncludes: z.preprocess(
      normalizeStringListInput,
      z.array(z.string().min(1)).optional()
    ),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType !== 'html') {
      return;
    }

    if (!value.htmlItemSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'htmlItemSelector is required when sourceType is html',
        path: ['htmlItemSelector'],
      });
    }

    if (!value.htmlLinkSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'htmlLinkSelector is required when sourceType is html',
        path: ['htmlLinkSelector'],
      });
    }

    if (!value.htmlTitleSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'htmlTitleSelector is required when sourceType is html',
        path: ['htmlTitleSelector'],
      });
    }
  });

const envSchema = z.object({
  QUEUE_URL: z.string().min(1),
  STATE_TABLE: z.string().min(1),
});

const getEnv = (): { queueUrl: string; stateTable: string } => {
  const env = envSchema.parse({
    QUEUE_URL,
    STATE_TABLE,
  });

  return { queueUrl: env.QUEUE_URL, stateTable: env.STATE_TABLE };
};

/**
 * 新着記事を SQS へ投入する。
 *
 * @param items - 投入対象の記事一覧
 * @param cfg - フィード設定
 * @throws {ZodError} 必須環境変数が不足している場合
 * @throws {Error} SQS 送信に失敗した場合
 */
const enqueueItems = async (items: ResolvedFeedItem[], cfg: FeedConfig) => {
  const { queueUrl } = getEnv();

  for (const item of items) {
    const payload = {
      dedupeStrategy: cfg.dedupeStrategy ?? 'auto',
      feedUrl: cfg.feedUrl,
      itemKey: item.itemKey,
      publishedAt: item.publishedAt?.toISOString(),
      sourceType: cfg.sourceType ?? 'rss',
      stateLatestTitle: cfg.sourceType === 'html' ? items[0]?.title : undefined,
      webhookUrl: cfg.webhookUrl,
      webhookUrls: cfg.webhookUrls,
      title: item.title,
      link: item.link,
    };
    // SQS FIFO の MessageDeduplicationId は英数字と一部記号のみ許容されるためサニタイズする
    const dedupRaw = `${cfg.feedUrl}-${item.itemKey}-${item.publishedAt?.toISOString() ?? item.link}`;
    const dedupId = toSqsFifoId(dedupRaw);
    const messageGroupId = toSqsFifoId(cfg.feedUrl);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageGroupId: messageGroupId,
        MessageDeduplicationId: dedupId,
        MessageBody: JSON.stringify(payload),
      })
    );
  }
};

const shouldProcessItem = (
  item: ResolvedFeedItem,
  cfg: FeedConfig
): boolean => {
  const dedupeStrategy = cfg.dedupeStrategy ?? 'auto';
  const processedItemKeys = new Set(cfg.processedItemKeys ?? []);
  const lastProcessed = cfg.lastPublishedAt
    ? new Date(cfg.lastPublishedAt)
    : null;

  if (dedupeStrategy === 'date_only') {
    if (!item.publishedAt) {
      return false;
    }

    if (!lastProcessed || Number.isNaN(lastProcessed.getTime())) {
      return true;
    }

    return item.publishedAt > lastProcessed;
  }

  if (processedItemKeys.has(item.itemKey)) {
    return false;
  }

  if (
    !item.publishedAt ||
    !lastProcessed ||
    Number.isNaN(lastProcessed.getTime())
  ) {
    return true;
  }

  return item.publishedAt > lastProcessed;
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

const applyHtmlTitleBaseline = (
  items: ResolvedFeedItem[],
  cfg: FeedConfig
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
    logger.info(
      'HTML title baseline was not found in the current fetch result; skipping candidates',
      {
        baselineTitle: cfg.baselineTitle,
        feedUrl: cfg.feedUrl,
        latestTitle: cfg.latestTitle,
      }
    );
    return [];
  }

  return items.slice(0, titleIndex);
};

const applyBaselineItemKey = (
  items: ResolvedFeedItem[],
  cfg: FeedConfig
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
    logger.info(
      'baselineItemKey was not found in the current fetch result; processing all candidates',
      {
        baselineItemKey,
        feedUrl: cfg.feedUrl,
      }
    );
    return items;
  }

  return items.slice(0, baselineIndex);
};

/**
 * DynamoDB からフィード設定を読み込む。
 *
 * @returns 検証済みのフィード設定一覧
 * @throws {ZodError} 必須環境変数や取得データの形式が不正な場合
 * @throws {Error} DynamoDB 走査に失敗した場合
 */
const loadFeedConfigs = async (): Promise<FeedConfig[]> => {
  const { stateTable } = getEnv();
  const configs: FeedConfig[] = [];
  let lastKey: Record<string, unknown> | undefined;
  try {
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: stateTable,
          ProjectionExpression:
            'feedUrl, webhookUrl, webhookUrls, categoryTerm, titleIncludes, lastPublishedAt, latestTitle, processedItemKeys, baselineItemKey, baselineTitle, dedupeStrategy, dateField, sourceType, htmlItemSelector, htmlLinkSelector, htmlTitleSelector',
          ExclusiveStartKey: lastKey,
        })
      );
      for (const item of res.Items ?? []) {
        const parsedConfig = feedConfigSchema.safeParse(item);
        if (!parsedConfig.success) {
          logger.error(
            'DynamoDB item validation failed; skipping feed config',
            {
              issues: parsedConfig.error.issues,
              item: sanitizeFeedConfigItem(item),
            }
          );
          continue;
        }

        configs.push(parsedConfig.data);
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
  } catch (err) {
    logger.error('Failed to scan STATE_TABLE for feed configs', {
      err: sanitizeErrorForLog(err),
    });
    throw err;
  }
  return configs;
};

/**
 * 単一フィードを処理し、新着記事を抽出して SQS に投入する。
 *
 * @param cfg - 処理対象のフィード設定
 * @throws {Error} RSS 取得や SQS 投入に失敗した場合
 */
const processFeed = async (cfg: FeedConfig): Promise<void> => {
  const feedUrl = cfg.feedUrl;
  const sourceType = cfg.sourceType ?? 'rss';
  const webhookUrls = normalizeWebhookUrls(cfg);
  if (webhookUrls.length === 0) {
    logger.error('No webhook configured for feed; skipping', { feedUrl });
    return;
  }
  const categoryTerm = cfg.categoryTerm;
  const titleIncludes = cfg.titleIncludes;

  logger.info('Processing feed', {
    dedupeStrategy: cfg.dedupeStrategy ?? 'auto',
    feedUrl,
    lastProcessedAt: cfg.lastPublishedAt ?? 'never',
    sourceType,
  });

  const response = await axios.get(feedUrl, { timeout: 15000 });
  const parsedItems =
    sourceType === 'html'
      ? parseHtmlItems(
          response.data,
          feedUrl,
          cfg.htmlItemSelector ?? '',
          cfg.htmlLinkSelector ?? '',
          cfg.htmlTitleSelector ?? ''
        )
      : parseFeedItems(response.data, parser);
  const items = parsedItems
    .map((item) => resolveFeedItem(item, cfg.dedupeStrategy, cfg.dateField))
    .filter((item): item is ResolvedFeedItem => item !== null);

  const filteredByTitle = applyHtmlTitleBaseline(items, cfg);
  const filteredByBaseline = applyBaselineItemKey(filteredByTitle, cfg);
  const newItems = filteredByBaseline
    .filter((item) => shouldProcessItem(item, cfg))
    .filter((item) => {
      if (categoryTerm) {
        return item.categories.includes(categoryTerm);
      }
      return true;
    })
    .filter((item) => {
      return matchesTitleIncludes(item.title, titleIncludes);
    })
    .sort((a, b) => {
      if (sourceType === 'html') {
        return 0;
      }

      return (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0);
    })
    .slice(0, MAX_POSTS_PER_FEED);

  logger.info('Found new feed items', {
    feedUrl,
    count: newItems.length,
  });

  await enqueueItems(newItems, { ...cfg, webhookUrls });
  logger.info('Enqueued feed items', {
    feedUrl,
    count: newItems.length,
  });
};

/**
 * RSS 取得 Lambda のエントリーポイント。
 *
 * DynamoDB から設定済みフィードを読み込み、新着記事を SQS へ投入する。
 *
 * @returns 実行結果
 * @throws {Error} フィード設定の読み込みに失敗した場合
 */
export const rssHandler = async (): Promise<APIGatewayProxyResult> => {
  getEnv();

  const configs = await loadFeedConfigs();
  if (configs.length === 0) {
    throw new ConfigurationError('No RSS feeds configured in DynamoDB');
  }

  for (const cfg of configs) {
    try {
      await processFeed(cfg);
    } catch (err) {
      logger.error('Error processing feed', {
        err: sanitizeErrorForLog(err),
        feedUrl: cfg.feedUrl,
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'RSS processing completed' }),
  };
};
