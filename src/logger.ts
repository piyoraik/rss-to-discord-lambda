/**
 * Lambda 実行ログを JSON 形式で出力する簡易 logger。
 * info は stdout、error は stderr へ分けて書き込み、CloudWatch で追いやすくする。
 */
type LogLevel = 'error' | 'info';

type LogContext = Record<string, unknown>;

const writeLog = (
  level: LogLevel,
  message: string,
  context?: LogContext
): void => {
  const logEntry = {
    level,
    message,
    ...(context ? { context } : {}),
  };
  const line = `${JSON.stringify(logEntry)}\n`;

  if (level === 'error') {
    process.stderr.write(line);
    return;
  }

  process.stdout.write(line);
};

export const logger = {
  error: (message: string, context?: LogContext): void => {
    writeLog('error', message, context);
  },
  info: (message: string, context?: LogContext): void => {
    writeLog('info', message, context);
  },
};
