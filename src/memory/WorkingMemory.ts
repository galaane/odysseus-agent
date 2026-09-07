import type { WorkingFact } from './types.js';

export class WorkingMemory {
  private facts: Map<string, WorkingFact> = new Map();
  private factCounter = 0;

  /**
   * Adds a transient fact to working memory.
   */
  public addFact(fact: string, options?: { domain?: string; category?: string }): string {
    this.factCounter++;
    const id = `fact_${String(this.factCounter).padStart(3, '0')}`;
    const record: WorkingFact = {
      id,
      text: fact.trim(),
      domain: options?.domain,
      category: options?.category,
      createdAt: new Date().toISOString(),
    };
    this.facts.set(id, record);
    return id;
  }

  /**
   * Returns list of all current fact texts.
   */
  public getFacts(): string[] {
    return Array.from(this.facts.values()).map((f) => f.text);
  }

  /**
   * Returns all full fact records.
   */
  public getFactRecords(): WorkingFact[] {
    return Array.from(this.facts.values());
  }

  /**
   * Clears all facts in working memory.
   */
  public clear(): void {
    this.facts.clear();
  }

  /**
   * When navigating to a different domain, clear domain-specific facts from the previous domain,
   * while keeping global or matching-domain facts intact.
   */
  public clearForDomainChange(newDomain: string): void {
    for (const [id, fact] of this.facts.entries()) {
      if (fact.domain && fact.domain !== newDomain) {
        this.facts.delete(id);
      }
    }
  }

  /**
   * Returns a concise textual summary of current working memory facts.
   */
  public summarize(): string {
    if (this.facts.size === 0) return 'Working memory is empty.';
    return Array.from(this.facts.values())
      .map((f, i) => `${i + 1}. ${f.text}${f.category ? ` [${f.category}]` : ''}`)
      .join('\n');
  }

  /**
   * Serializes working memory facts for checkpointing.
   */
  public serialize(): WorkingFact[] {
    return Array.from(this.facts.values());
  }

  /**
   * Restores working memory from a serialized snapshot.
   */
  public deserialize(records: WorkingFact[]): void {
    this.facts.clear();
    for (const record of records) {
      this.facts.set(record.id, record);
      const num = parseInt(record.id.replace('fact_', ''), 10);
      if (!isNaN(num) && num > this.factCounter) {
        this.factCounter = num;
      }
    }
  }
}
