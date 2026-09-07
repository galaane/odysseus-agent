import type { Source } from './Source.js';

export interface Finding {
  id: string;
  claim: string;
  sourceIds: string[];
  confidence?: number;
  notes?: string;
  createdAt?: string;
}

/**
 * Calculates a multi-source confidence score based on the number of distinct
 * top-level domains corroborating the claim.
 */
export function calculateDomainCorroboration(sources: Source[]): number {
  if (sources.length === 0) return 0.5;

  const uniqueDomains = new Set(sources.map((s) => s.domain.toLowerCase()));
  const domainCount = uniqueDomains.size;

  if (domainCount >= 3) return 0.99;
  if (domainCount === 2) return 0.95;
  if (sources.length >= 2) return 0.88;
  return 0.80;
}
