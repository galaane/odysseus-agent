import type { SqliteDatabase } from './Database.js';
import type { DomainHyperparameters } from '../optimization/types.js';

interface RawHyperparameterRow {
  id: string;
  domain_or_archetype: string;
  risk_aversion: number;
  max_retries: number;
  token_budget: number;
  frustration_threshold: number;
  prompt_directives: string;
  sample_count: number;
  success_count: number;
  updated_at: string;
}

export const DEFAULT_HYPERPARAMETERS: DomainHyperparameters = {
  id: 'param_global',
  domainOrArchetype: 'global',
  riskAversionFactor: 0.5,
  maxRetries: 2,
  tokenBudget: 3000,
  frustrationThreshold: 3,
  promptDirectives: [],
  sampleCount: 0,
  successCount: 0,
  updatedAt: new Date(0).toISOString(),
};

export class HyperparameterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public saveParams(params: DomainHyperparameters): void {
    const stmt = this.db.prepare(`
      INSERT INTO domain_hyperparameters (
        id, domain_or_archetype, risk_aversion, max_retries, token_budget, frustration_threshold,
        prompt_directives, sample_count, success_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain_or_archetype) DO UPDATE SET
        risk_aversion = excluded.risk_aversion,
        max_retries = excluded.max_retries,
        token_budget = excluded.token_budget,
        frustration_threshold = excluded.frustration_threshold,
        prompt_directives = excluded.prompt_directives,
        sample_count = excluded.sample_count,
        success_count = excluded.success_count,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      params.id,
      params.domainOrArchetype,
      params.riskAversionFactor,
      params.maxRetries,
      params.tokenBudget,
      params.frustrationThreshold,
      JSON.stringify(params.promptDirectives),
      params.sampleCount,
      params.successCount,
      params.updatedAt
    );
  }

  public getParams(domainOrArchetype: string): DomainHyperparameters | null {
    const stmt = this.db.prepare(`
      SELECT * FROM domain_hyperparameters WHERE domain_or_archetype = ? LIMIT 1
    `);
    const row = stmt.get(domainOrArchetype) as unknown as RawHyperparameterRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Retrieves effective hyperparameters using the hierarchical fallback:
   * 1. Exact Domain Match (e.g. "store.local")
   * 2. Archetype Match (e.g. "ecommerce")
   * 3. Global SQLite Parameters
   * 4. System Default Fallback
   */
  public getEffectiveParams(domain?: string, archetype?: string): DomainHyperparameters {
    if (domain) {
      const domainMatch = this.getParams(domain);
      if (domainMatch && domainMatch.sampleCount > 0) {
        return domainMatch;
      }
    }

    if (archetype) {
      const archMatch = this.getParams(archetype);
      if (archMatch && archMatch.sampleCount > 0) {
        return archMatch;
      }
    }

    const globalMatch = this.getParams('global');
    if (globalMatch) {
      return globalMatch;
    }

    return { ...DEFAULT_HYPERPARAMETERS };
  }

  public getAllParams(): DomainHyperparameters[] {
    const stmt = this.db.prepare('SELECT * FROM domain_hyperparameters ORDER BY sample_count DESC');
    const rows = stmt.all() as unknown as RawHyperparameterRow[];
    return rows.map((r) => this.mapRow(r));
  }


  public recordTrial(domainOrArchetype: string, success: boolean): void {
    const existing = this.getParams(domainOrArchetype) || {
      ...DEFAULT_HYPERPARAMETERS,
      id: `param_${domainOrArchetype.replace(/[^a-z0-9]/gi, '_')}`,
      domainOrArchetype,
    };

    existing.sampleCount++;
    if (success) {
      existing.successCount++;
    }
    existing.updatedAt = new Date().toISOString();

    this.saveParams(existing);
  }

  public clearParams(domainOrArchetype?: string): void {
    if (domainOrArchetype) {
      this.db.prepare('DELETE FROM domain_hyperparameters WHERE domain_or_archetype = ?').run(domainOrArchetype);
    } else {
      this.db.prepare('DELETE FROM domain_hyperparameters').run();
    }
  }

  public deleteParams(domainOrArchetype: string): void {
    this.clearParams(domainOrArchetype);
  }

  private mapRow(row: RawHyperparameterRow): DomainHyperparameters {
    let promptDirectives: string[] = [];
    try {
      promptDirectives = JSON.parse(row.prompt_directives);
    } catch {
      promptDirectives = [];
    }

    return {
      id: row.id,
      domainOrArchetype: row.domain_or_archetype,
      riskAversionFactor: row.risk_aversion,
      maxRetries: row.max_retries,
      tokenBudget: row.token_budget,
      frustrationThreshold: row.frustration_threshold,
      promptDirectives,
      sampleCount: row.sample_count,
      successCount: row.success_count,
      updatedAt: row.updated_at,
    };
  }
}
