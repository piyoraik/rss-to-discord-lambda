/**
 * Webhook 設定を正規化し、送信先 URL 配列へ変換する。
 * 単一 URL と複数 URL の両方を吸収し、通知送信側で扱いやすい形にする。
 */
export type WebhookConfig = {
  webhookUrl?: string;
  webhookUrls?: string[];
};

export const normalizeWebhookUrls = (config: WebhookConfig): string[] => {
  if (config.webhookUrls?.length) {
    return config.webhookUrls.filter(Boolean);
  }

  return config.webhookUrl ? [config.webhookUrl] : [];
};
