import type { DomainArchetype } from '../graph/types.js';

export type AffordanceType =
  | 'search'
  | 'form'
  | 'auth'
  | 'navigation'
  | 'table'
  | 'cart'
  | 'pagination'
  | 'action_button';

export interface RouteAffordance {
  type: AffordanceType;
  elementId: string;
  role?: string;
  name?: string;
  selector?: string;
}

export interface RouteNode {
  id: string; // Format: `${domain}:${path}`
  domain: string;
  path: string; // Normalized route path, e.g. "/catalog" or "/product/:id"
  pattern: string; // Route classification pattern
  title?: string;
  archetype: DomainArchetype;
  affordances: RouteAffordance[];
  depth: number;
  visitedAt: number;
  createdAt: number;
}

export type TransitionType =
  | 'link_click'
  | 'form_submit'
  | 'navigation_menu'
  | 'pagination';

export interface RouteEdge {
  id: string; // Format: `${domain}:${sourcePath}->${targetPath}`
  domain: string;
  sourcePath: string;
  targetPath: string;
  transitionType: TransitionType;
  triggerSelector: string;
  triggerRole?: string;
  triggerName?: string;
  weight: number; // 0.0 to 1.0 confidence / transition frequency
  createdAt: number;
}

export interface SiteTopology {
  domain: string;
  rootUrl: string;
  nodes: Map<string, RouteNode>;
  edges: RouteEdge[];
  coverageScore: number;
}

export interface CuriosityCandidate {
  elementId: string;
  actionType: 'click' | 'fill';
  fillValue?: string;
  targetUrl?: string;
  targetPath?: string;
  targetRole?: string;
  targetName?: string;
  targetSelector?: string;
  curiosityScore: number;
  isSafe: boolean;
  reasoning: string;
}

export interface ExplorationBudget {
  maxSteps: number;
  maxDepth: number;
  maxDurationMs: number;
  sameOriginOnly: boolean;
}

export interface ExplorationReport {
  domain: string;
  routesDiscovered: number;
  edgesMapped: number;
  affordancesFound: number;
  macrosSynthesized: number;
  durationMs: number;
  nodes: RouteNode[];
}
