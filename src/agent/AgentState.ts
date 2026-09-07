export type AgentState =
  | 'idle'
  | 'starting'
  | 'observing'
  | 'thinking'
  | 'acting'
  | 'evaluating'
  | 'waiting'
  | 'waiting_human_intervention'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped';

export type StateChangeListener = (from: AgentState, to: AgentState) => void;

export class AgentStateMachine {
  private state: AgentState = 'idle';
  private listeners: StateChangeListener[] = [];

  constructor(initialState: AgentState = 'idle') {
    this.state = initialState;
  }

  public getState(): AgentState {
    return this.state;
  }

  public transitionTo(nextState: AgentState): void {
    if (this.state === nextState) return;

    const previous = this.state;
    this.state = nextState;

    for (const listener of this.listeners) {
      listener(previous, nextState);
    }
  }

  public onStateChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public isTerminal(): boolean {
    return ['completed', 'failed', 'stopped'].includes(this.state);
  }
}
