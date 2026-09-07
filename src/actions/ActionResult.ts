export interface ActionResult {
  actionId: string;
  actionType: string;
  success: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: {
    code: string;
    message: string;
  };
  observationDelta?: unknown;
}
