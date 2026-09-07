import type { HarvestNetworkPayloadAction } from '../Action.js';
import type { ActionExecutionContext } from '../ActionExecutionContext.js';
import { NetworkPayloadHarvester } from '../../research/NetworkPayloadHarvester.js';
import { BrowserError, ErrorCodes } from '../../browser/BrowserError.js';

export class HarvestPayloadHandler {
  private harvester = new NetworkPayloadHarvester();

  public async execute(
    action: HarvestNetworkPayloadAction,
    context: ActionExecutionContext
  ): Promise<{ observationDelta?: unknown }> {
    const { page, tabId, browserManager, networkObserver, memoryManager, researchRepo, taskId, logger } = context;

    const observer = networkObserver || (browserManager ? browserManager.getNetworkObserver() : undefined);
    if (!observer) {
      throw new BrowserError(
        ErrorCodes.UNKNOWN_ERROR,
        'NetworkObserver is not available in execution context'
      );
    }

    const payloadRecord = observer.findPayloadByUrl(action.urlPattern, tabId || page);

    if (!payloadRecord) {
      throw new BrowserError(
        ErrorCodes.ELEMENT_NOT_FOUND,
        `No captured network payload matched pattern "${action.urlPattern}" for tab ${tabId}`
      );
    }

    const harvestResult = this.harvester.harvest(payloadRecord.data, {
      url: payloadRecord.url,
      jsonPath: action.jsonPath,
      topic: action.topic,
      maxItems: action.maxItems,
    });

    logger.info('HarvestPayloadHandler', `Harvested ${harvestResult.facts.length} facts from payload: ${payloadRecord.url}`, {
      urlPattern: action.urlPattern,
      matchedUrl: payloadRecord.url,
      destination: action.destination,
      jsonPath: action.jsonPath,
      factsCount: harvestResult.facts.length,
    });

    // 1. Inject into WorkingMemory
    if (action.destination === 'working' || action.destination === 'both') {
      if (memoryManager) {
        for (const fact of harvestResult.facts) {
          memoryManager.getWorkingMemory().addFact(fact, {
            category: action.topic || 'network_payload',
          });
        }
      }
    }

    // 2. Inject into ResearchMemory & SQLite ResearchRepository
    if (action.destination === 'research' || action.destination === 'both') {
      if (memoryManager) {
        memoryManager.getResearchMemory().addSource({
          url: payloadRecord.url,
          relevance: 0.95,
        });

        for (const finding of harvestResult.findings) {
          memoryManager.getResearchMemory().addFinding({
            claim: finding.claim,
            sourceUrls: finding.sourceUrls,
            confidence: finding.confidence,
            notes: finding.notes,
          });
        }
      }

      if (researchRepo && taskId) {
        try {
          const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          let domain = 'unknown';
          try {
            domain = new URL(payloadRecord.url).hostname;
          } catch {
            // Soft fail
          }

          researchRepo.saveSource({
            id: sourceId,
            task_id: taskId,
            url: payloadRecord.url,
            title: action.topic ? `API: ${action.topic}` : `Payload: ${payloadRecord.url}`,
            domain,
            accessed_at: new Date().toISOString(),
            relevance: 0.95,
          });

          for (const finding of harvestResult.findings) {
            researchRepo.saveFinding({
              id: `find_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              task_id: taskId,
              claim: finding.claim,
              source_ids: JSON.stringify([sourceId]),
              confidence: finding.confidence,
              notes: finding.notes || null,
              created_at: new Date().toISOString(),
            });
          }
        } catch (err: unknown) {
          logger.warn('HarvestPayloadHandler', `Failed to persist research finding to SQLite repository: ${String(err)}`);
        }
      }
    }

    return {
      observationDelta: {
        harvestedUrl: payloadRecord.url,
        status: payloadRecord.status,
        method: payloadRecord.method,
        destination: action.destination,
        jsonPath: action.jsonPath,
        factsCount: harvestResult.facts.length,
        findingsCount: harvestResult.findings.length,
        sampleFacts: harvestResult.facts.slice(0, 3),
      },
    };
  }
}
