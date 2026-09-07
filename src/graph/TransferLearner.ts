import type { KnowledgeGraph } from './KnowledgeGraph.js';
import { ArchetypeClassifier } from './ArchetypeClassifier.js';
import type { PageSnapshot } from '../observer/PageSnapshot.js';
import type {
  DomainArchetype,
  CrossDomainTransferRecommendation,
  TransferableConcept,
} from './types.js';
import type { Logger } from '../logging/Logger.js';

export interface TransferLearnerOptions {
  knowledgeGraph: KnowledgeGraph;
  classifier?: ArchetypeClassifier;
  logger?: Logger;
  maxConceptsPerRecommendation?: number;
}

export class TransferLearner {
  private knowledgeGraph: KnowledgeGraph;
  private classifier: ArchetypeClassifier;
  private maxConcepts: number;

  constructor(private readonly options: TransferLearnerOptions) {
    this.knowledgeGraph = options.knowledgeGraph;
    this.classifier = options.classifier || new ArchetypeClassifier();
    this.maxConcepts = options.maxConceptsPerRecommendation || 4;
  }

  /**
   * Generates cross-domain heuristic recommendations for a page based on structural archetype classification.
   */
  public getRecommendationsForPage(
    domain: string,
    snapshot: PageSnapshot
  ): CrossDomainTransferRecommendation {
    const cleanDomain = domain.toLowerCase().trim();

    // 1. Check if domain archetype is already established in KnowledgeGraph
    const existing = this.knowledgeGraph.getDomainArchetype(cleanDomain);
    let archetype: DomainArchetype;
    let confidence: number;

    if (existing && existing.confidence >= 0.5) {
      archetype = existing.archetype;
      confidence = existing.confidence;
    } else {
      // 2. Classify via real-time page structure observation
      const classification = this.classifier.classify(snapshot);
      archetype = classification.archetype;
      confidence = classification.confidence;

      if (confidence >= 0.4 && archetype !== 'general_web') {
        this.knowledgeGraph.associateDomain(cleanDomain, archetype, confidence);
      }
    }

    // 3. Retrieve empirical transferable concepts for archetype
    const allConcepts = this.knowledgeGraph.getArchetypeConcepts(archetype);
    const matchedConcepts = allConcepts.slice(0, this.maxConcepts);

    // 4. Synthesize concrete recommendations
    const recommendedStrategies = matchedConcepts.map((c) => c.strategyHint);
    const promptSummary = this.formatRecommendationPrompt(archetype, confidence, matchedConcepts);

    return {
      domain: cleanDomain,
      archetype,
      confidence,
      matchedConcepts,
      recommendedStrategies,
      promptSummary,
    };
  }

  /**
   * Reinforces or penalizes an archetype concept's empirical weight after action execution.
   */
  public reinforceConceptOutcome(
    archetype: DomainArchetype,
    conceptName: string,
    success: boolean
  ): void {
    this.knowledgeGraph.reinforceConcept(archetype, conceptName, success);
  }

  /**
   * Formats transfer recommendations into a token-efficient prompt string (< 250 tokens).
   */
  private formatRecommendationPrompt(
    archetype: DomainArchetype,
    confidence: number,
    concepts: TransferableConcept[]
  ): string {
    if (archetype === 'general_web' || concepts.length === 0) {
      return '';
    }

    const conceptSummary = concepts
      .map((c) => `${c.name} [roles: ${c.typicalRoles.join(', ')}]`)
      .join(' | ');

    const strategyBullets = concepts
      .map((c) => `- ${c.strategyHint}`)
      .join('\n');

    return `[CROSS-DOMAIN TRANSFER HEURISTIC (${archetype.toUpperCase()}, confidence: ${(confidence * 100).toFixed(0)}%)]:
Key Affordances: ${conceptSummary}
Standard Archetype Strategies:
${strategyBullets}`;
  }
}
