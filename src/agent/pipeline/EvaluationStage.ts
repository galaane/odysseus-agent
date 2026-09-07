import type { BrowserManager } from '../../browser/BrowserManager.js';
import type { Evaluator } from '../Evaluator.js';
import type { Planner } from '../Planner.js';
import type { LLMProvider } from '../../llm/LLM.js';
import type { DocumentParser } from '../../research/DocumentParser.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { Logger } from '../../logging/Logger.js';
import { MicroReflector } from '../MicroReflector.js';
import type { IEvaluationStage, LoopIterationContext } from './types.js';

export interface EvaluationStageOptions {
  browserManager: BrowserManager;
  evaluator: Evaluator;
  planner: Planner;
  llmProvider: LLMProvider;
  documentParser: DocumentParser;
  memoryManager: MemoryManager;
  microReflector?: MicroReflector;
  logger: Logger;
}

export class EvaluationStage implements IEvaluationStage {
  private browserManager: BrowserManager;
  private evaluator: Evaluator;
  private planner: Planner;
  private llmProvider: LLMProvider;
  private documentParser: DocumentParser;
  private memoryManager: MemoryManager;
  private microReflector: MicroReflector;
  private logger: Logger;

  constructor(options: EvaluationStageOptions) {
    this.browserManager = options.browserManager;
    this.evaluator = options.evaluator;
    this.planner = options.planner;
    this.llmProvider = options.llmProvider;
    this.documentParser = options.documentParser;
    this.memoryManager = options.memoryManager;
    this.microReflector = options.microReflector || new MicroReflector(options.logger);
    this.logger = options.logger;
  }

  public async execute(context: LoopIterationContext): Promise<void> {
    const { previousSnapshot, currentSnapshot, previousExpectedOutcome, plan, task, stepCount } = context;

    // 1. Empirical State Delta Evaluation
    if (previousSnapshot && currentSnapshot) {
      let evalResult = this.evaluator.evaluate(
        previousSnapshot,
        currentSnapshot,
        previousExpectedOutcome || undefined
      );

      // Phase 20: Doubt-Driven Self-Correction
      // If heuristic evaluation is uncertain or fails, explicitly ask the LLM to verify
      // critical state transitions against the DOM before failing or replanning.
      if (previousExpectedOutcome && evalResult.status !== 'success') {
        this.logger.debug('EvaluationStage', 'Heuristics uncertain. Triggering Doubt-Driven Critical Evaluation via LLM...');
        evalResult = await this.evaluator.evaluateCritically(
          previousExpectedOutcome,
          currentSnapshot,
          this.llmProvider
        );
      }

      this.logger.debug('EvaluationStage', `Step ${stepCount} evaluation: ${evalResult.status}`, {
        reason: evalResult.reason,
        changes: evalResult.observedChanges,
      });

      this.planner.advanceMilestone(plan, evalResult.status === 'success');
      if (evalResult.status === 'failure') {
        this.planner.replan(plan, evalResult.reason);
      }

      // Phase 28: In-Flight Micro-Reflexion
      if (evalResult.status === 'failure' || (evalResult.status === 'unknown' && previousExpectedOutcome)) {
        const lastAction = context.recentActions.length > 0
          ? context.recentActions[context.recentActions.length - 1]
          : undefined;

        const critique = this.microReflector.critiqueStep({
          step: stepCount,
          lastAction,
          expectedOutcome: previousExpectedOutcome,
          previousSnapshot,
          currentSnapshot,
          evalResult,
        });

        context.lastStepCritique = critique;
        this.logger.warn('EvaluationStage', `In-flight micro-critique generated for step ${stepCount}: ${critique.summaryText}`);
      } else {
        context.lastStepCritique = null;
      }
    }

    // 2. Autonomous File Download & Document Verification (Phase 17)
    const downloadManager = typeof this.browserManager.getDownloadManager === 'function'
      ? this.browserManager.getDownloadManager()
      : undefined;

    if (downloadManager) {
      const completedDownloads = downloadManager.getCompletedDownloads(task.id);
      for (const dl of completedDownloads) {
        if (!context.processedDownloadIds.has(dl.id)) {
          context.processedDownloadIds.add(dl.id);
          try {
            const parsed = await this.documentParser.parse(dl.savePath);
            const snippet = parsed.rawText.slice(0, 1500).replace(/\r?\n+/g, ' ').trim();
            const verificationFact = `[Downloaded Document Verified]: "${dl.filename}" (Type: ${parsed.fileType.toUpperCase()}, Size: ${dl.fileSize || 0} bytes). Extracted Content: ${snippet}`;
            this.memoryManager.getWorkingMemory().addFact(verificationFact);
            this.memoryManager.getTaskMemory().addVisitedUrl(`file://${dl.savePath}`);
            this.logger.info('EvaluationStage', `Autonomous document verification succeeded for ${dl.filename}`, {
              downloadId: dl.id,
              fileType: parsed.fileType,
              fileSize: dl.fileSize,
            });
          } catch (err) {
            this.logger.warn('EvaluationStage', `Failed to parse downloaded document ${dl.filename}: ${String(err)}`);
          }
        }
      }
    }
  }

  public getMicroReflector(): MicroReflector {
    return this.microReflector;
  }
}
