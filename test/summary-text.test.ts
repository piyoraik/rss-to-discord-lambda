import assert from 'node:assert/strict';
import test from 'node:test';

const MAX_ARTICLE_TEXT_LEN = 8000;
const BEDROCK_MIN_TOKENS = 500;

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
