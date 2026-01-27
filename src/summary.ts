import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

interface QueuePayload {
  feedUrl: string;
  webhookUrl: string;
  title: string;
  link: string;
  publishedAt: string;
}

const STATE_TABLE = process.env.STATE_TABLE;
const BEDROCK_REGION = process.env.BEDROCK_REGION;
const MODEL_ID_RAW = process.env.MODEL_ID;
const MODEL_ID = MODEL_ID_RAW?.trim();
const MODEL_DISPLAY_NAME = process.env.MODEL_DISPLAY_NAME?.trim() || MODEL_ID;
const LOG_PREVIEW_LEN = 200;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

/** 環境変数の存在チェックを行う */
const validateEnv = () => {
  if (!STATE_TABLE) throw new Error('STATE_TABLE is not set');
  if (!BEDROCK_REGION) throw new Error('BEDROCK_REGION is not set');
  if (!MODEL_ID) throw new Error('MODEL_ID is not set');

  const looksLikeInferenceProfileArn = MODEL_ID.includes(':inference-profile/');
  const looksLikeInferenceProfileId = /^[a-z]+\.[a-z0-9\-\.]+-v\d+:\d+$/.test(MODEL_ID);
  // Accept Nova Lite foundation model IDs (current and future minor variants)
  const looksLikeFoundationModelId = /^amazon\.nova(-\d+)?-lite-v\d+:\d+$/.test(MODEL_ID);

  if (!looksLikeInferenceProfileArn && !looksLikeInferenceProfileId && !looksLikeFoundationModelId) {
    throw new Error(
      'MODEL_ID must be an inference profile ARN/ID (e.g. arn:aws:bedrock:...:inference-profile/... or apac.amazon.nova-lite-v1:0) ' +
      'or a foundation model ID (e.g. amazon.nova-2-lite-v1:0)'
    );
  }
};

/** DynamoDB に lastPublishedAt を保存する（既存より新しい場合のみ上書き） */
const updateState = async (feedUrl: string, isoTimestamp: string): Promise<void> => {
  try {
    await dynamo.send(
      new UpdateCommand({
        TableName: STATE_TABLE!,
        Key: { feedUrl },
        UpdateExpression: 'SET lastPublishedAt = :ts',
        ConditionExpression: 'attribute_not_exists(lastPublishedAt) OR lastPublishedAt < :ts',
        ExpressionAttributeValues: {
          ':ts': isoTimestamp,
        },
      })
    );
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return;
    console.error(`Failed to update state for ${feedUrl}`, err);
    throw err;
  }
};

/** 既に同じ/より新しい記事を処理済みかを DynamoDB で確認する */
const isAlreadyProcessed = async (feedUrl: string, isoTimestamp: string): Promise<boolean> => {
  try {
    const res = await dynamo.send(
      new GetCommand({
        TableName: STATE_TABLE!,
        Key: { feedUrl },
        ProjectionExpression: 'lastPublishedAt',
      })
    );
    const last = res.Item?.lastPublishedAt;
    if (!last) return false;
    const lastDate = new Date(last);
    const incoming = new Date(isoTimestamp);
    if (Number.isNaN(lastDate.getTime()) || Number.isNaN(incoming.getTime())) return false;
    return lastDate.getTime() >= incoming.getTime();
  } catch (err) {
    console.error(`Failed to load state for ${feedUrl}`, err);
    // フェイルクローズで再処理してしまうよりは処理継続しつつ状態更新に任せる
    return false;
  }
};

/** Date を JST の文字列表現へ変換する */
const formatDateTimeJst = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jstDate.getFullYear()}-${pad(jstDate.getMonth() + 1)}-${pad(jstDate.getDate())} ` +
    `${pad(jstDate.getHours())}:${pad(jstDate.getMinutes())}:${pad(jstDate.getSeconds())}`;
};

/** 記事本文を取得しテキスト化する */
const fetchArticleText = async (url: string): Promise<string> => {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; rss-to-discord-bot)',
    },
  });
  const $ = cheerio.load(res.data);
  const articleText =
    $('article').text() ||
    $('.news__detail').text() ||
    $('body').text() ||
    '';
  return articleText.replace(/\s+/g, ' ').trim().slice(0, 4000); // 長すぎる本文をトリム
};

/** Bedrock (Nova Lite / Nova 2 Lite) で要約を生成する */
const summarize = async (title: string, body: string): Promise<string> => {
  const prompt = [
    '以下の記事を日本語で要約してください。',
    '・簡潔に事実ベースでまとめる',
    '・URLは付けない',
    `タイトル: ${title}`,
    `本文: ${body}`,
  ].join('\n');

  const res = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 512, // 400 だと長文が途中切れするケースがあるため少し余裕を持たせる
        temperature: 0.3,
        topP: 0.9,
      },
    })
  );

  const stopReason = (res as any).stopReason ?? (res.output as any)?.stopReason;
  console.log('Bedrock summary meta', {
    stopReason,
    usage: (res as any).usage,
  });

  const output =
    res.output?.message?.content
      ?.map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n') ?? '';

  return output.trim();
};

/** Discord Webhook へメッセージを送信する */
const postToDiscord = async (content: string, webhookUrl: string) => {
  await axios.post(
    webhookUrl,
    { content },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    }
  );
};

/** SQS レコードを処理する */
const handleRecord = async (record: SQSRecord): Promise<void> => {
  const payload = JSON.parse(record.body) as QueuePayload;
  const publishedAt = new Date(payload.publishedAt);

  if (await isAlreadyProcessed(payload.feedUrl, payload.publishedAt)) {
    console.log(`Skip already processed item for ${payload.feedUrl}: ${payload.link}`);
    return;
  }

  const bodyText = await fetchArticleText(payload.link);
  const summary = await summarize(payload.title, bodyText);

  const summaryPreview = summary.slice(0, LOG_PREVIEW_LEN);
  const content = [
    `**${payload.title}**`,
    `投稿日時(JST): ${formatDateTimeJst(publishedAt)}`,
    payload.link,
    '',
    `AIによる要約(${MODEL_DISPLAY_NAME ?? MODEL_ID}):`,
    '```',
    summary,
    '```',
  ].join('\n');

  console.log('Debug summary payload', {
    feedUrl: payload.feedUrl,
    link: payload.link,
    modelId: MODEL_ID,
    modelDisplayName: MODEL_DISPLAY_NAME,
    promptLength: bodyText.length,
    summaryLength: summary.length,
    contentLength: content.length,
    summaryPreview,
  });

  await postToDiscord(content, payload.webhookUrl);
  await updateState(payload.feedUrl, publishedAt.toISOString());
};

// エントリーポイント: キューのメッセージを要約し Discord に投稿、状態を更新する
export const handler = async (event: SQSEvent): Promise<void> => {
  validateEnv();
  for (const record of event.Records) {
    try {
      await handleRecord(record);
    } catch (err) {
      console.error('Failed to process record', { messageId: record.messageId, err });
      throw err;
    }
  }
};
