/**
 * SQS FIFO 制約に収まる MessageGroupId / MessageDeduplicationId を生成する。
 * 許可されない文字を除去し、空になる場合はハッシュで代替する。
 */
import { createHash } from 'node:crypto';

export const toSqsFifoId = (value: string): string => {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 128);

  if (sanitized.length > 0) {
    return sanitized;
  }

  return createHash('sha256').update(value).digest('hex').slice(0, 128);
};
