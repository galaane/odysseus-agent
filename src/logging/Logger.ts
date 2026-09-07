export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  taskId?: string;
  actionId?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  taskId?: string;
  actionId?: string;
  metadata?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry, jsonLine: string) => void;

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Patterns for sensitive string detection
const SENSITIVE_KEY_PATTERN = /^(password|pass|secret|token|authorization|cookie|apikey|api_key|access_token|private_key)$/i;
const BEARER_TOKEN_PATTERN = /Bearer\s+([a-zA-Z0-9_\-.~+/]+=*)/gi;
const COOKIE_SECRET_PATTERN = /(connect\.sid|auth_token|session_id|jwt)=([^;\s]+)/gi;
const OPENAI_API_KEY_PATTERN = /sk-[a-zA-Z0-9_-]{20,}/g;

/**
 * Deeply redacts secrets from strings, objects, and arrays.
 */
export function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    let sanitized = value.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(COOKIE_SECRET_PATTERN, '$1=[REDACTED]');
    sanitized = sanitized.replace(OPENAI_API_KEY_PATTERN, '[REDACTED_API_KEY]');
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (typeof value === 'object') {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactSecrets(value.message),
        stack: value.stack ? redactSecrets(value.stack) : undefined,
      };
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = redactSecrets(val);
      }
    }
    return sanitizedObj;
  }

  return value;
}

export class Logger {
  private minLevelPriority: number;
  private sinks: LogSink[] = [];

  constructor(
    private minLevel: LogLevel = 'info',
    private defaultSink: LogSink = (entry, jsonLine) => {
      if (entry.level === 'error') {
        process.stderr.write(jsonLine + '\n');
      } else {
        process.stdout.write(jsonLine + '\n');
      }
    }
  ) {
    this.minLevelPriority = LOG_LEVEL_PRIORITY[minLevel];
    this.sinks.push(this.defaultSink);
  }

  public setLevel(level: LogLevel): void {
    this.minLevel = level;
    this.minLevelPriority = LOG_LEVEL_PRIORITY[level];
  }

  public getLevel(): LogLevel {
    return this.minLevel;
  }

  public addSink(sink: LogSink): () => void {
    this.sinks.push(sink);
    return () => {
      this.sinks = this.sinks.filter((s) => s !== sink);
    };
  }

  public clearSinks(): void {
    this.sinks = [];
  }

  public log(
    level: LogLevel,
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogContext
  ): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevelPriority) {
      return;
    }

    const sanitizedMetadata = metadata ? (redactSecrets(metadata) as Record<string, unknown>) : undefined;
    const sanitizedMessage = typeof message === 'string' ? (redactSecrets(message) as string) : message;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message: sanitizedMessage,
      taskId: context?.taskId,
      actionId: context?.actionId,
      metadata: sanitizedMetadata,
    };

    const jsonLine = JSON.stringify(entry);

    for (const sink of this.sinks) {
      try {
        sink(entry, jsonLine);
      } catch {
        // Prevent logging sink failure from throwing unhandled error
      }
    }
  }

  public debug(component: string, message: string, metadata?: Record<string, unknown>, context?: LogContext): void {
    this.log('debug', component, message, metadata, context);
  }

  public info(component: string, message: string, metadata?: Record<string, unknown>, context?: LogContext): void {
    this.log('info', component, message, metadata, context);
  }

  public warn(component: string, message: string, metadata?: Record<string, unknown>, context?: LogContext): void {
    this.log('warn', component, message, metadata, context);
  }

  public error(component: string, message: string, metadata?: Record<string, unknown>, context?: LogContext): void {
    this.log('error', component, message, metadata, context);
  }
}
