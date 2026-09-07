import type { DomainPlaybookRecord } from './types.js';

export interface PlaybookRankerOptions {
  maxPlaybooks?: number;
  maxTokens?: number;
  currentUrl?: string;
}

export interface RankedPlaybook {
  record: DomainPlaybookRecord;
  score: number;
  category: string;
  ruleText: string;
  formattedText: string;
  matchedKeywords: string[];
}

const STOPWORDS = new Set([
  'the', 'and', 'with', 'from', 'this', 'that', 'should', 'have', 'been',
  'about', 'then', 'into', 'what', 'where', 'which', 'when', 'will', 'would',
  'could', 'does', 'your', 'their', 'there', 'here', 'some', 'than', 'such',
  'each', 'page', 'user', 'site', 'task', 'step', 'also', 'over', 'only',
]);

export class PlaybookRanker {
  private readonly defaultMaxPlaybooks = 4;
  private readonly defaultMaxTokens = 450;

  /**
   * Ranks domain playbooks according to relevance to the active task goal and current context.
   */
  public rankPlaybooks(
    playbooks: DomainPlaybookRecord[],
    goal: string,
    options?: PlaybookRankerOptions
  ): RankedPlaybook[] {
    if (!playbooks || playbooks.length === 0) {
      return [];
    }

    const maxPlaybooks = options?.maxPlaybooks ?? this.defaultMaxPlaybooks;
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const maxChars = Math.floor(maxTokens * 3.5);

    const goalLower = goal.toLowerCase();
    const goalTokens = this.tokenize(goalLower);
    const goalIntentCategories = this.inferIntentCategories(goalLower);

    const scoredList: RankedPlaybook[] = [];

    for (const record of playbooks) {
      const parsedData = this.parsePlaybookData(record);
      const category = parsedData.category || this.inferCategoryFromPatternType(record.pattern_type);
      const ruleText = parsedData.rule || record.pattern_key;

      let score = 0;
      const matchedKeywords: string[] = [];

      // 1. Goal Category Alignment (+3.0 points per match)
      if (goalIntentCategories.has(category)) {
        score += 3.0;
      }

      // Universal heuristics (e.g. modal dismissal) get a baseline boost if modal keywords exist
      if (category === 'modal_handling' && (goalLower.includes('cookie') || goalLower.includes('modal') || goalLower.includes('popup'))) {
        score += 2.0;
      }

      // 2. Lexical Keyword Overlap (+1.5 points per matching keyword)
      const playbookContent = `${record.pattern_key} ${ruleText} ${record.playbook_data}`.toLowerCase();
      const playbookTokens = this.tokenize(playbookContent);
      for (const token of goalTokens) {
        const matches = playbookTokens.some(
          (pt) => pt === token || (pt.length >= 4 && token.length >= 4 && (pt.startsWith(token) || token.startsWith(pt)))
        );
        if (matches) {
          score += 1.5;
          matchedKeywords.push(token);
        }
      }

      // 3. Current URL / Path Alignment (+1.2 points if path tokens match)
      if (options?.currentUrl) {
        try {
          const pathname = new URL(options.currentUrl).pathname.toLowerCase();
          const pathSegments = pathname.split('/').filter((s) => s.length > 2);
          for (const seg of pathSegments) {
            if (playbookContent.includes(seg)) {
              score += 1.2;
              break;
            }
          }
        } catch {
          // Ignore invalid URL
        }
      }

      // 4. Historical Confidence & Reinforcement (+0.1 to +1.0 points)
      if (record.success_count > 0) {
        score += Math.min(1.0, 0.2 * Math.log2(1 + record.success_count));
      }
      if (parsedData.confidence !== undefined) {
        score += parsedData.confidence * 0.5;
      }

      const formattedText = this.formatSinglePlaybook(record, parsedData);

      scoredList.push({
        record,
        score,
        category,
        ruleText,
        formattedText,
        matchedKeywords,
      });
    }

    // Sort descending by score, tie-break by success_count
    scoredList.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.record.success_count - a.record.success_count;
    });

    // Enforce maxPlaybooks and token budget
    const selected: RankedPlaybook[] = [];
    let currentChars = 0;

    for (const item of scoredList) {
      if (selected.length >= maxPlaybooks) {
        break;
      }
      const itemLength = item.formattedText.length + 1; // +1 for newline
      if (currentChars + itemLength > maxChars && selected.length > 0) {
        break; // Stop if exceeding budget (unless first item)
      }

      selected.push(item);
      currentChars += itemLength;
    }

    return selected;
  }

  /**
   * Convenience method that ranks playbooks and returns an array of formatted strings ready for prompt inclusion.
   */
  public rankAndFormat(
    playbooks: DomainPlaybookRecord[],
    goal: string,
    options?: PlaybookRankerOptions
  ): string[] {
    const ranked = this.rankPlaybooks(playbooks, goal, options);
    return ranked.map((r) => r.formattedText);
  }

  private tokenize(text: string): string[] {
    return text
      .split(/[^a-zA-Z0-9_\-]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  }

  private inferIntentCategories(goalLower: string): Set<string> {
    const categories = new Set<string>();

    if (/search|find|lookup|browse|catalog|query|explore/.test(goalLower)) {
      categories.add('search');
    }
    if (/cart|buy|purchase|order|checkout|pay|payment|price/.test(goalLower)) {
      categories.add('checkout');
      categories.add('form_fill');
    }
    if (/login|sign\s?in|sign\s?up|register|form|fill|submit|input/.test(goalLower)) {
      categories.add('form_fill');
    }
    if (/modal|cookie|consent|banner|overlay|popup|dismiss/.test(goalLower)) {
      categories.add('modal_handling');
    }
    if (/navigate|visit|go\s?to|open|link/.test(goalLower)) {
      categories.add('navigation');
    }

    if (categories.size === 0) {
      categories.add('general');
    }

    return categories;
  }

  private inferCategoryFromPatternType(patternType: string): string {
    const lower = patternType.toLowerCase();
    if (lower.includes('search')) return 'search';
    if (lower.includes('form') || lower.includes('input')) return 'form_fill';
    if (lower.includes('modal') || lower.includes('cookie')) return 'modal_handling';
    if (lower.includes('nav')) return 'navigation';
    if (lower.includes('checkout') || lower.includes('cart')) return 'checkout';
    return 'general';
  }

  private parsePlaybookData(record: DomainPlaybookRecord): {
    category?: string;
    rule?: string;
    confidence?: number;
  } {
    if (record.pattern_type === 'reflexion_heuristic') {
      try {
        const data = JSON.parse(record.playbook_data) as {
          category?: string;
          rule?: string;
          confidence?: number;
        };
        return data;
      } catch {
        return {};
      }
    }
    return {};
  }

  private formatSinglePlaybook(
    record: DomainPlaybookRecord,
    parsedData: { category?: string; rule?: string; confidence?: number }
  ): string {
    if (record.pattern_type === 'reflexion_heuristic') {
      const category = parsedData.category || 'general';
      const rule = parsedData.rule || record.pattern_key;
      const confidence = parsedData.confidence !== undefined ? parsedData.confidence : 0.8;
      return `[Learned Rule (${category})]: ${rule} (confidence: ${confidence.toFixed(2)})`;
    }
    return `[${record.pattern_type}] ${record.pattern_key}: ${record.playbook_data}`;
  }
}
