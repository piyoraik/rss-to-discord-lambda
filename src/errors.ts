/**
 * アプリケーション内で扱うエラー種別を定義する。
 * 上位層で意図を判断できるよう、汎用 Error ではなく責務ごとの型へ変換する。
 */
export class AppError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ConfigurationError extends AppError {
  public constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
  }
}
