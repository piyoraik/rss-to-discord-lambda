/**
 * SQS 経由で受信した通知候補を要約し、Discord Webhook へ投稿する。
 * 記事本文の取得、Bedrock による要約、DynamoDB 状態更新までを担当する。
 * Discord の文字数制限を考慮しつつ、1 投稿に収まる要約本文へ整形する。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  UpdateCommand,
  GetCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import axios from 'axios';
import { load } from 'cheerio';
import { z } from 'zod';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

import type { DedupeStrategy } from '@/dedupe';
import { ConfigurationError } from '@/errors';
import { logger } from '@/logger';
import { sanitizeErrorForLog } from '@/redaction';
import { normalizeWebhookUrls } from '@/webhooks';

type QueuePayload = {
  dedupeStrategy: DedupeStrategy;
  feedUrl: string;
  itemKey: string;
  publishedAt?: string;
  sourceType: 'rss' | 'html';
  stateLatestTitle?: string;
  webhookUrl?: string;
  webhookUrls?: string[];
  title: string;
  link: string;
};

const STATE_TABLE = process.env.STATE_TABLE;
const BEDROCK_REGION = process.env.BEDROCK_REGION;
const MODEL_ID_RAW = process.env.MODEL_ID;
const MODEL_ID = MODEL_ID_RAW?.trim();
const MODEL_DISPLAY_NAME = process.env.MODEL_DISPLAY_NAME?.trim() || MODEL_ID;
const MAX_ARTICLE_TEXT_LEN = 8000;
const BEDROCK_MIN_TOKENS = 500;
const BEDROCK_MAX_CONTINUATIONS = 2;
const DISCORD_CONTENT_LIMIT = 2000;
const LOG_PREVIEW_LEN = 200;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const queuePayloadSchema = z.object({
  dedupeStrategy: z.enum(['auto', 'link_only', 'date_only', 'id_only']),
  feedUrl: z.string().min(1),
  itemKey: z.string().min(1),
  publishedAt: z.string().datetime().optional(),
  sourceType: z.enum(['rss', 'html']),
  stateLatestTitle: z.string().min(1).optional(),
  webhookUrl: z.string().min(1).optional(),
  webhookUrls: z.array(z.string().min(1)).optional(),
  title: z.string().min(1),
  link: z.string().url(),
});
const sqsRecordSchema = z.object({
  body: z.string().min(1),
  messageId: z.string().min(1),
});
const sqsEventSchema = z.object({
  Records: z.array(sqsRecordSchema),
});

const envSchema = z.object({
  BEDROCK_REGION: z.string().min(1),
  MODEL_ID: z.string().min(1),
  STATE_TABLE: z.string().min(1),
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const parseQueuePayload = (body: string): QueuePayload => {
  return queuePayloadSchema.parse(JSON.parse(body));
};

const parseSqsEvent = (event: unknown): SQSEvent | null => {
  const result = sqsEventSchema.safeParse(event);

  if (!result.success) {
    logger.error('Received non-SQS event; skipping summary handler execution', {
      issues: result.error.issues,
    });
    return null;
  }

  return result.data as SQSEvent;
};

const isConditionalCheckFailedError = (
  value: unknown
): value is { name: string } => {
  return isRecord(value) && typeof value.name === 'string';
};

const getEnv = (): {
  bedrockRegion: string;
  modelId: string;
  stateTable: string;
} => {
  const env = envSchema.parse({
    BEDROCK_REGION,
    MODEL_ID,
    STATE_TABLE,
  });

  const looksLikeInferenceProfileArn = env.MODEL_ID.includes(
    ':inference-profile/'
  );
  const looksLikeInferenceProfileId = /^[a-z]+\.[a-z0-9\-\.]+-v\d+:\d+$/.test(
    env.MODEL_ID
  );
  // Nova Lite 系の foundation model ID を受け付ける
  const looksLikeFoundationModelId = /^amazon\.nova(-\d+)?-lite-v\d+:\d+$/.test(
    env.MODEL_ID
  );

  if (
    !looksLikeInferenceProfileArn &&
    !looksLikeInferenceProfileId &&
    !looksLikeFoundationModelId
  ) {
    throw new ConfigurationError(
      'MODEL_ID must be an inference profile ARN/ID (e.g. arn:aws:bedrock:...:inference-profile/... or apac.amazon.nova-lite-v1:0) ' +
        'or a foundation model ID (e.g. amazon.nova-2-lite-v1:0)'
    );
  }

  return {
    bedrockRegion: env.BEDROCK_REGION,
    modelId: env.MODEL_ID,
    stateTable: env.STATE_TABLE,
  };
};

const getBedrockClient = (): BedrockRuntimeClient => {
  const { bedrockRegion } = getEnv();
  return new BedrockRuntimeClient({ region: bedrockRegion });
};

const extractTextBlocks = (content: ContentBlock[] | undefined): string => {
  if (!content) {
    return '';
  }

  return content
    .flatMap((block) => ('text' in block ? [block.text] : []))
    .join('\n')
    .trim();
};

/**
 * DynamoDB の最終処理時刻を更新する。
 *
 * @param feedUrl - 状態更新対象のフィード URL
 * @param itemKey - 保存する記事キー
 * @param isoTimestamp - 保存する公開日時
 * @throws {ZodError} 必須環境変数が不足している場合
 * @throws {Error} 条件付き更新以外の DynamoDB エラーが発生した場合
 */
const updateState = async (
  payload: Pick<
    QueuePayload,
    'feedUrl' | 'itemKey' | 'publishedAt' | 'sourceType' | 'stateLatestTitle'
  >
): Promise<void> => {
  const { stateTable } = getEnv();
  const {
    feedUrl,
    itemKey,
    publishedAt: isoTimestamp,
    sourceType,
    stateLatestTitle,
  } = payload;

  if (sourceType === 'html') {
    await dynamo.send(
      new UpdateCommand({
        TableName: stateTable,
        Key: { feedUrl },
        UpdateExpression: stateLatestTitle
          ? 'SET latestTitle = :latestTitle'
          : undefined,
        ExpressionAttributeValues: stateLatestTitle
          ? { ':latestTitle': stateLatestTitle }
          : undefined,
      })
    );
    return;
  }

  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: stateTable,
        Key: { feedUrl },
        UpdateExpression: isoTimestamp
          ? 'ADD processedItemKeys :itemKeySet SET lastPublishedAt = :ts'
          : 'ADD processedItemKeys :itemKeySet',
        ConditionExpression: isoTimestamp
          ? 'attribute_not_exists(lastPublishedAt) OR lastPublishedAt < :ts'
          : undefined,
        ExpressionAttributeValues: {
          ...(isoTimestamp ? { ':ts': isoTimestamp } : {}),
          ':itemKeySet': new Set([itemKey]),
        },
      })
    );
  } catch (err: unknown) {
    if (
      isConditionalCheckFailedError(err) &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      await dynamo.send(
        new UpdateCommand({
          TableName: stateTable,
          Key: { feedUrl },
          UpdateExpression: 'ADD processedItemKeys :itemKeySet',
          ExpressionAttributeValues: {
            ':itemKeySet': new Set([itemKey]),
          },
        })
      );
      return;
    }

    logger.error('Failed to update state', {
      err: sanitizeErrorForLog(err),
      feedUrl,
      itemKey,
      isoTimestamp,
    });
    throw err;
  }
};

/**
 * 同一またはより新しい記事が処理済みかを確認する。
 *
 * @param feedUrl - フィード URL
 * @param itemKey - 判定対象の記事キー
 * @param isoTimestamp - 判定対象の記事公開日時
 * @returns 既処理なら `true`
 */
const isAlreadyProcessed = async (
  payload: Pick<
    QueuePayload,
    'feedUrl' | 'itemKey' | 'publishedAt' | 'sourceType' | 'title'
  >
): Promise<boolean> => {
  const { stateTable } = getEnv();
  const {
    feedUrl,
    itemKey,
    publishedAt: isoTimestamp,
    sourceType,
    title,
  } = payload;

  try {
    const res = await dynamo.send(
      new GetCommand({
        TableName: stateTable,
        Key: { feedUrl },
        ProjectionExpression: 'lastPublishedAt, latestTitle, processedItemKeys',
      })
    );
    if (sourceType === 'html') {
      return res.Item?.latestTitle === title;
    }

    const processedItemKeys = res.Item?.processedItemKeys;
    if (processedItemKeys instanceof Set && processedItemKeys.has(itemKey)) {
      return true;
    }
    if (
      Array.isArray(processedItemKeys) &&
      processedItemKeys.includes(itemKey)
    ) {
      return true;
    }

    if (!isoTimestamp) {
      return false;
    }

    const last = res.Item?.lastPublishedAt;
    if (!last) return false;
    const lastDate = new Date(last);
    const incoming = new Date(isoTimestamp);
    if (Number.isNaN(lastDate.getTime()) || Number.isNaN(incoming.getTime()))
      return false;
    return lastDate.getTime() >= incoming.getTime();
  } catch (err) {
    logger.error('Failed to load state', {
      err: sanitizeErrorForLog(err),
      feedUrl,
      itemKey,
      isoTimestamp,
    });
    // フェイルクローズで再処理してしまうよりは処理継続しつつ状態更新に任せる
    return false;
  }
};

/** Date を JST の文字列表現へ変換する */
const formatDateTimeJst = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return (
    `${jstDate.getFullYear()}-${pad(jstDate.getMonth() + 1)}-${pad(jstDate.getDate())} ` +
    `${pad(jstDate.getHours())}:${pad(jstDate.getMinutes())}:${pad(jstDate.getSeconds())}`
  );
};

const normalizeArticleText = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ARTICLE_TEXT_LEN);
};

const trimTextToLength = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const raw = text.slice(0, maxLength);
  const splitAt = Math.max(raw.lastIndexOf('\n'), raw.lastIndexOf(' '), 0);
  const trimmed = (splitAt > 0 ? raw.slice(0, splitAt) : raw).trim();

  return `${trimmed}\n...`;
};

const normalizeSummaryForReaders = (text: string): string => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*(.+)$/gm, '【$1】')
    .replace(/^---+\s*$/gm, '')
    .replace(/^\s*[-*]\s+/gm, '・')
    .replace(/^\s*\d+\.\s+/gm, '・')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const buildDiscordMessage = (
  payload: QueuePayload,
  summary: string,
  publishedAt: Date | null
): string => {
  const headerLines = [
    `タイトル: ${payload.title}`,
    ...(publishedAt
      ? [`投稿日時(JST): ${formatDateTimeJst(publishedAt)}`]
      : []),
    payload.link,
  ];
  const header = headerLines.join('\n');
  const summaryHeader = `要約(${MODEL_DISPLAY_NAME ?? MODEL_ID})`;
  const normalizedSummary = normalizeSummaryForReaders(summary);
  const wrapperLength = `${header}\n\n${summaryHeader}\n\`\`\`\n\n\`\`\``.length;
  const availableSummaryLength = DISCORD_CONTENT_LIMIT - wrapperLength;
  const trimmedSummary = trimTextToLength(
    normalizedSummary,
    availableSummaryLength
  );

  return [header, '', summaryHeader, '```', trimmedSummary, '```'].join('\n');
};

type SummaryPlan = {
  maxTokens: number;
  targetLengthText: string;
};

const buildSummaryPlan = (bodyLength: number): SummaryPlan => {
  if (bodyLength < 2000) {
    return {
      maxTokens: BEDROCK_MIN_TOKENS,
      targetLengthText: '全体で日本語400文字以上500文字以内を目安にする',
    };
  }

  if (bodyLength < 5000) {
    return {
      maxTokens: 700,
      targetLengthText: '全体で日本語600文字以上700文字以内を目安にする',
    };
  }

  return {
    maxTokens: 900,
    targetLengthText: '全体で日本語700文字以上800文字以内を目安にする',
  };
};

/**
 * 記事本文を取得し、要約対象のプレーンテキストへ変換する。
 *
 * @param url - 記事 URL
 * @returns 要約対象テキスト
 * @throws {Error} 記事取得に失敗した場合
 */
const fetchArticleText = async (url: string): Promise<string> => {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; rss-to-discord-bot)',
    },
  });
  const $ = load(res.data);
  const articleText =
    $('article').text() || $('.news__detail').text() || $('body').text() || '';
  return normalizeArticleText(articleText);
};

/**
 * Bedrock を使って記事本文を要約する。
 *
 * @param title - 記事タイトル
 * @param body - 記事本文
 * @returns 生成された要約
 * @throws {Error} Bedrock 呼び出しに失敗した場合
 */
const summarize = async (title: string, body: string): Promise<string> => {
  const { modelId } = getEnv();
  const client = getBedrockClient();
  const summaryPlan = buildSummaryPlan(body.length);
  const prompt = [
    '以下の記事を日本語で要約してください。',
    '・簡潔に事実ベースでまとめる',
    '・非エンジニアでも読みやすい自然な日本語にする',
    '・Markdown記法は使わない',
    '・見出し記号、太字記号、コードブロック、表は使わない',
    '・見出しが必要な場合は「【概要】」「【要点】」「【注意点】」のように【】を使う',
    '・箇条書きが必要な場合は「・」だけを使う',
    `・${summaryPlan.targetLengthText}`,
    '・URLは付けない',
    `タイトル: ${title}`,
    `本文: ${body}`,
  ].join('\n');
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ text: prompt }],
    },
  ];
  const summaryParts: string[] = [];

  for (let attempt = 0; attempt <= BEDROCK_MAX_CONTINUATIONS; attempt += 1) {
    const res = await client.send(
      new ConverseCommand({
        modelId,
        messages,
        inferenceConfig: {
          maxTokens: summaryPlan.maxTokens,
          temperature: 0.3,
          topP: 0.9,
        },
      })
    );

    logger.info('Bedrock summary meta', {
      attempt,
      maxTokens: summaryPlan.maxTokens,
      stopReason: res.stopReason,
      usage: res.usage,
    });

    const content = res.output?.message?.content;
    const summaryText = extractTextBlocks(content);
    if (summaryText) {
      summaryParts.push(summaryText);
    }

    if (
      res.stopReason !== 'max_tokens' ||
      !content ||
      attempt === BEDROCK_MAX_CONTINUATIONS
    ) {
      if (res.stopReason === 'max_tokens') {
        logger.error('Bedrock response reached maxTokens before completion', {
          attempt,
          bodyLength: body.length,
          maxTokens: summaryPlan.maxTokens,
          title,
          usage: res.usage,
        });
      }
      break;
    }

    messages.push({
      role: 'assistant',
      content,
    });
    messages.push({
      role: 'user',
      content: [
        {
          text: `前回の続きを重複なく出力してください。途中で切れた箇所からそのまま続けてください。${summaryPlan.targetLengthText}。`,
        },
      ],
    });
  }

  return summaryParts.join('\n');
};

/**
 * Discord Webhook へメッセージを送信する。
 *
 * @param content - 投稿内容
 * @param webhookUrl - 送信先 Webhook URL
 * @throws {Error} Discord への送信に失敗した場合
 */
const postToDiscord = async (contents: string[], webhookUrl: string) => {
  for (const content of contents) {
    await axios.post(
      webhookUrl,
      { content },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
  }
};

/**
 * SQS レコードを処理し、要約を Discord へ配信する。
 *
 * @param record - 処理対象の SQS レコード
 * @throws {ZodError} キューペイロードが不正な場合
 * @throws {Error} 記事取得、要約、Discord 投稿、状態更新のいずれかに失敗した場合
 */
const handleRecord = async (record: SQSRecord): Promise<void> => {
  const payload = parseQueuePayload(record.body);
  const publishedAt = payload.publishedAt
    ? new Date(payload.publishedAt)
    : null;
  const webhookUrls = normalizeWebhookUrls(payload);

  if (webhookUrls.length === 0) {
    logger.error('No webhook configured in payload; skipping', {
      feedUrl: payload.feedUrl,
    });
    return;
  }

  if (await isAlreadyProcessed(payload)) {
    logger.info('Skip already processed item', {
      feedUrl: payload.feedUrl,
      itemKey: payload.itemKey,
      link: payload.link,
    });
    return;
  }

  const bodyText = await fetchArticleText(payload.link);
  const summary = await summarize(payload.title, bodyText);
  const summaryPreview = summary.slice(0, LOG_PREVIEW_LEN);
  const content = buildDiscordMessage(payload, summary, publishedAt);

  logger.info('Debug summary payload', {
    contentCount: 1,
    contentLength: content.length,
    dedupeStrategy: payload.dedupeStrategy,
    feedUrl: payload.feedUrl,
    itemKey: payload.itemKey,
    link: payload.link,
    modelId: MODEL_ID,
    modelDisplayName: MODEL_DISPLAY_NAME,
    promptLength: bodyText.length,
    summaryLength: summary.length,
    summaryPreview,
  });

  await Promise.all(
    webhookUrls.map((webhookUrl) => postToDiscord([content], webhookUrl))
  );
  await updateState({
    feedUrl: payload.feedUrl,
    itemKey: payload.itemKey,
    publishedAt: publishedAt?.toISOString(),
    sourceType: payload.sourceType,
    stateLatestTitle: payload.stateLatestTitle,
  });
};

/**
 * 要約 Lambda のエントリーポイント。
 *
 * SQS 経由で受信した記事を順に処理し、Discord 投稿成功時のみ状態を更新する。
 *
 * @param event - SQS イベント
 * @throws {Error} 個々のレコード処理に失敗した場合
 */
export const handler = async (event: unknown): Promise<void> => {
  const parsedEvent = parseSqsEvent(event);
  if (!parsedEvent) {
    return;
  }
  getEnv();

  for (const record of parsedEvent.Records) {
    try {
      await handleRecord(record);
    } catch (err) {
      logger.error('Failed to process record', {
        err: sanitizeErrorForLog(err),
        messageId: record.messageId,
      });
      throw err;
    }
  }
};
