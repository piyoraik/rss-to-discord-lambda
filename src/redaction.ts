/**
 * ログ出力時に機密情報や過剰な詳細を除去する補助関数群。
 * Webhook URL や AxiosError の設定値をそのまま記録しないように正規化する。
 */
import axios from 'axios';

const WEBHOOK_PATH_PATTERN = /(\/api\/webhooks\/[^/]+\/).+$/;

export const maskWebhookUrl = (value: string): string => {
  return value.replace(WEBHOOK_PATH_PATTERN, '$1***');
};

export const sanitizeFeedConfigItem = (
  item: Record<string, unknown>
): Record<string, unknown> => {
  const sanitized = { ...item };

  if (typeof sanitized.webhookUrl === 'string') {
    sanitized.webhookUrl = maskWebhookUrl(sanitized.webhookUrl);
  }

  if (Array.isArray(sanitized.webhookUrls)) {
    sanitized.webhookUrls = sanitized.webhookUrls.map((entry) => {
      return typeof entry === 'string' ? maskWebhookUrl(entry) : entry;
    });
  }

  return sanitized;
};

export const sanitizeErrorForLog = (
  error: unknown
): Record<string, unknown> => {
  if (axios.isAxiosError(error)) {
    return {
      code: error.code,
      message: error.message,
      method: error.config?.method,
      name: error.name,
      status: error.response?.status,
      url:
        typeof error.config?.url === 'string'
          ? maskWebhookUrl(error.config.url)
          : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return { error };
};
