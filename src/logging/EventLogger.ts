import { EventEmitter } from 'node:events';
import { Logger, type LogContext } from './Logger.js';

export type DomainEvent =
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.state_changed'
  | 'agent.deliberation'
  | 'agent.risk_assessed'
  | 'agent.intervention_required'
  | 'agent.intervention_resolved'
  | 'llm.request'
  | 'llm.response'
  | 'llm.invalid_response'
  | 'browser.started'
  | 'browser.connected'
  | 'browser.disconnected'
  | 'browser.crashed'
  | 'observation.created'
  | 'action.started'
  | 'action.completed'
  | 'action.failed'
  | 'task.created'
  | 'task.checkpoint'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled';

export interface EventPayload {
  event: DomainEvent;
  payload: Record<string, unknown>;
  timestamp: string;
  context?: LogContext;
  [key: string]: unknown;
}

export class EventLogger extends EventEmitter {
  constructor(private logger: Logger) {
    super();
  }

  public emit(event: DomainEvent, payload: Record<string, unknown> = {}, context?: LogContext): boolean {
    const level = event.endsWith('.failed') || event === 'browser.crashed' ? 'error' : 'info';
    
    this.logger.log(
      level,
      'EventLogger',
      `Event emitted: ${event}`,
      {
        event,
        ...payload,
      },
      context
    );

    const eventData: EventPayload = {
      event,
      payload,
      timestamp: new Date().toISOString(),
      context,
    };

    // Emit specific event and wildcard event for global observers (SSE)
    super.emit(event, eventData);
    return super.emit('*', eventData);
  }
}
