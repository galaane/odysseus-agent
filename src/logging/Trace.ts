import { Logger, type LogContext } from './Logger.js';

export interface TraceSpan {
  name: string;
  startedAt: number;
  end(metadata?: Record<string, unknown>): number;
}

export class Trace {
  constructor(private logger: Logger) {}

  public startSpan(name: string, initialMetadata?: Record<string, unknown>, context?: LogContext): TraceSpan {
    const startedAt = Date.now();
    const component = 'Trace';

    this.logger.debug(component, `Span started: ${name}`, initialMetadata, context);

    return {
      name,
      startedAt,
      end: (metadata?: Record<string, unknown>): number => {
        const durationMs = Date.now() - startedAt;
        this.logger.info(
          component,
          `Span finished: ${name} (${durationMs}ms)`,
          {
            span: name,
            durationMs,
            ...metadata,
          },
          context
        );
        return durationMs;
      },
    };
  }
}
