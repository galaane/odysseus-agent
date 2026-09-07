export interface HarvestedPayloadResult {
  sourceUrl: string;
  matchedPath?: string;
  extractedData: unknown;
  facts: string[];
  findings: Array<{
    claim: string;
    sourceUrls: string[];
    confidence: number;
    notes?: string;
  }>;
}

export class NetworkPayloadHarvester {
  /**
   * Safely queries a nested path in JSON data using dot and bracket notation (e.g. "data.items[0].title", "products.*.id").
   * Zero arbitrary JS execution, fully deterministic and safe.
   */
  public queryPath(data: unknown, path?: string): unknown {
    if (!path || path.trim() === '' || path === '.') {
      return data;
    }

    if (data === null || data === undefined) {
      return undefined;
    }

    // Normalize bracket syntax: foo[0].bar -> foo.0.bar
    const normalized = path.replace(/\[(\w+)\]/g, '.$1');
    const segments = normalized.split('.').filter(Boolean);

    let current: unknown = data;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (current === null || current === undefined) {
        return undefined;
      }

      if (seg === '*') {
        if (Array.isArray(current)) {
          const remainingPath = segments.slice(i + 1).join('.');
          if (!remainingPath) {
            return current;
          }
          return current
            .map((item) => this.queryPath(item, remainingPath))
            .filter((val) => val !== undefined);
        }
        return undefined;
      }

      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Formats extracted payload data into concise human-readable facts suitable for WorkingMemory.
   */
  public formatAsFacts(
    extractedData: unknown,
    sourceUrl: string,
    topic?: string,
    maxItems = 20
  ): string[] {
    const facts: string[] = [];
    const prefix = topic ? `[${topic}] ` : '';

    if (extractedData === null || extractedData === undefined) {
      return [`${prefix}[Payload from ${sourceUrl}]: <empty or null>`];
    }

    if (Array.isArray(extractedData)) {
      if (extractedData.length === 0) {
        return [`${prefix}[Payload from ${sourceUrl}]: Empty list []`];
      }

      const totalCount = extractedData.length;
      const slice = extractedData.slice(0, maxItems);

      slice.forEach((item, index) => {
        const itemStr = this.serializeItem(item);
        facts.push(`${prefix}[Payload from ${sourceUrl}] Item #${index + 1}/${totalCount}: ${itemStr}`);
      });

      if (totalCount > maxItems) {
        facts.push(`${prefix}[Payload from ${sourceUrl}] ... (${totalCount - maxItems} additional items omitted)`);
      }
    } else if (typeof extractedData === 'object') {
      const entries = Object.entries(extractedData as Record<string, unknown>);
      if (entries.length === 0) {
        return [`${prefix}[Payload from ${sourceUrl}]: Empty object {}`];
      }

      const slice = entries.slice(0, maxItems);
      for (const [key, value] of slice) {
        const valStr = this.serializeItem(value);
        facts.push(`${prefix}[Payload from ${sourceUrl}] ${key}: ${valStr}`);
      }

      if (entries.length > maxItems) {
        facts.push(`${prefix}[Payload from ${sourceUrl}] ... (${entries.length - maxItems} additional fields omitted)`);
      }
    } else {
      facts.push(`${prefix}[Payload from ${sourceUrl}]: ${String(extractedData)}`);
    }

    return facts;
  }

  /**
   * Converts extracted payload data into structured research findings.
   */
  public formatAsFindings(
    extractedData: unknown,
    sourceUrl: string,
    topic?: string,
    maxItems = 20
  ): Array<{ claim: string; sourceUrls: string[]; confidence: number; notes?: string }> {
    const findings: Array<{ claim: string; sourceUrls: string[]; confidence: number; notes?: string }> = [];
    const facts = this.formatAsFacts(extractedData, sourceUrl, topic, maxItems);

    for (const fact of facts) {
      // Avoid creating findings from informational omission notes
      if (fact.includes('additional items omitted') || fact.includes('additional fields omitted')) {
        continue;
      }
      findings.push({
        claim: fact,
        sourceUrls: [sourceUrl],
        confidence: 0.95, // Direct network payload has high empirical corroboration
        notes: `Direct network harvest from API response (${sourceUrl})`,
      });
    }

    return findings;
  }

  /**
   * High-level harvest operation that queries the path and produces both facts and findings.
   */
  public harvest(
    data: unknown,
    options: {
      url: string;
      jsonPath?: string;
      topic?: string;
      maxItems?: number;
    }
  ): HarvestedPayloadResult {
    const extractedData = this.queryPath(data, options.jsonPath);
    const facts = this.formatAsFacts(extractedData, options.url, options.topic, options.maxItems ?? 20);
    const findings = this.formatAsFindings(extractedData, options.url, options.topic, options.maxItems ?? 20);

    return {
      sourceUrl: options.url,
      matchedPath: options.jsonPath,
      extractedData,
      facts,
      findings,
    };
  }

  private serializeItem(item: unknown): string {
    if (item === null) return 'null';
    if (item === undefined) return 'undefined';
    if (typeof item === 'object') {
      try {
        const json = JSON.stringify(item);
        if (json.length > 250) {
          return `${json.slice(0, 250)}... [truncated]`;
        }
        return json;
      } catch {
        return '[Object]';
      }
    }
    const str = String(item);
    return str.length > 250 ? `${str.slice(0, 250)}... [truncated]` : str;
  }
}
