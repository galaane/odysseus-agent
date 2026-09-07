export type NodeType = 'archetype' | 'domain' | 'concept' | 'action_pattern';

export type EdgeRelation =
  | 'belongs_to_archetype'
  | 'uses_concept'
  | 'generalizes_to'
  | 'has_affordance';

export type DomainArchetype =
  | 'ecommerce'
  | 'documentation'
  | 'saas_app'
  | 'code_repository'
  | 'auth_portal'
  | 'content_blog'
  | 'general_web';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number; // 0.0 to 1.0 empirical reliability
  sampleCount: number;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

export interface ArchetypeClassificationResult {
  archetype: DomainArchetype;
  confidence: number;
  matchedIndicators: string[];
}

export interface TransferableConcept {
  name: string;
  archetype: DomainArchetype;
  typicalRoles: string[];
  typicalNamePatterns: string[];
  strategyHint: string;
  reliability: number;
}

export interface CrossDomainTransferRecommendation {
  domain: string;
  archetype: DomainArchetype;
  confidence: number;
  matchedConcepts: TransferableConcept[];
  recommendedStrategies: string[];
  promptSummary: string;
}
