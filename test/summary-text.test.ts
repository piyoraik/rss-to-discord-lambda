import assert from 'node:assert/strict';
import test from 'node:test';

const MAX_ARTICLE_TEXT_LEN = 8000;
const BEDROCK_MIN_TOKENS = 500;
const DISCORD_CONTENT_LIMIT = 2000;

const normalizeArticleText = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ARTICLE_TEXT_LEN);
};

const buildSummaryPlan = (
  bodyLength: number
): { maxTokens: number; targetLengthText: string } => {
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

const buildDiscordMessage = (summary: string): string => {
  const header = [
    'タイトル: テストタイトル',
    '投稿日時(JST): 2026-03-12 10:00:00',
    'https://example.com/article',
  ].join('\n');
  const summaryHeader = '要約(test-model)';
  const normalizedSummary = normalizeSummaryForReaders(summary);
  const wrapperLength = `${header}\n\n${summaryHeader}\n\`\`\`\n\n\`\`\``.length;
  const availableSummaryLength = DISCORD_CONTENT_LIMIT - wrapperLength;
  const trimmedSummary = trimTextToLength(
    normalizedSummary,
    availableSummaryLength
  );

  return [header, '', summaryHeader, '```', trimmedSummary, '```'].join('\n');
};

test('normalizeArticleText trims whitespace and keeps up to 8000 characters', () => {
  const source = `  ${'a '.repeat(5000)}  `;
  const normalized = normalizeArticleText(source);

  assert.equal(normalized.includes('  '), false);
  assert.equal(normalized.length, MAX_ARTICLE_TEXT_LEN);
});

test('buildSummaryPlan chooses smaller limits for short text', () => {
  assert.deepEqual(buildSummaryPlan(1500), {
    maxTokens: 500,
    targetLengthText: '全体で日本語400文字以上500文字以内を目安にする',
  });
});

test('buildSummaryPlan chooses medium limits for medium text', () => {
  assert.deepEqual(buildSummaryPlan(3000), {
    maxTokens: 700,
    targetLengthText: '全体で日本語600文字以上700文字以内を目安にする',
  });
});

test('buildSummaryPlan chooses larger limits for long text', () => {
  assert.deepEqual(buildSummaryPlan(7000), {
    maxTokens: 900,
    targetLengthText: '全体で日本語700文字以上800文字以内を目安にする',
  });
});

test('trimTextToLength keeps the result within the requested length', () => {
  const trimmed = trimTextToLength(`見出し\n${'a'.repeat(3800)}`, 1800);

  assert.equal(trimmed.length <= 1804, true);
  assert.equal(trimmed.endsWith('...'), true);
});

test('normalizeSummaryForReaders removes markdown decorations', () => {
  const normalized = normalizeSummaryForReaders(
    [
      '### 見出し',
      '',
      '**重要なお知らせ**',
      '',
      '- 箇条書き1',
      '1. 箇条書き2',
      '',
      '---',
    ].join('\n')
  );

  assert.equal(normalized.includes('【見出し】'), true);
  assert.equal(normalized.includes('**'), false);
  assert.equal(normalized.includes('---'), false);
  assert.equal(normalized.includes('・箇条書き1'), true);
  assert.equal(normalized.includes('・箇条書き2'), true);
});

test('buildDiscordMessage keeps code block output within Discord limit', () => {
  const message = buildDiscordMessage(`# 見出し\n\n${'a'.repeat(3000)}`);

  assert.equal(message.startsWith('タイトル: テストタイトル'), true);
  assert.equal(message.includes('```'), true);
  assert.equal(message.length <= DISCORD_CONTENT_LIMIT, true);
});
