import type { RegisteredElement } from './ElementRegistry.js';
import type { PageSummary } from './PageSnapshot.js';
import type { NetworkSummary } from './NetworkObserver.js';
import { SpatialAttentionFilter } from './SpatialAttentionFilter.js';

export interface CompressionInput {
  title: string;
  url: string;
  elements: RegisteredElement[];
  summary: PageSummary;
  networkSummary?: NetworkSummary;
  maxTokens?: number;
}

export class ObservationCompressor {
  private readonly defaultMaxTokens = 3000;
  private spatialFilter = new SpatialAttentionFilter();

  /**
   * Compresses page elements and summary into a concise, token-budgeted markdown representation
   * using Spatial Attention to prioritize in-viewport elements and cluster out-of-viewport elements.
   */
  public compress(input: CompressionInput): string {
    const maxTokens = input.maxTokens || this.defaultMaxTokens;
    // Rough estimation: 1 token ≈ 3.5 characters
    const maxChars = Math.floor(maxTokens * 3.5);

    const lines: string[] = [];

    // Header
    const cleanTitle = input.title ? input.title.replace(/\s+/g, ' ').trim() : 'Untitled Page';
    lines.push(`[Page: "${cleanTitle}"] [URL: ${input.url}]`);

    // Interactive Elements section with Spatial Attention
    lines.push('Interactive Elements:');

    if (input.elements.length === 0) {
      lines.push('- None detected');
    } else {
      const partition = this.spatialFilter.partition(input.elements);

      if (!partition.hasSpatialMetadata) {
        // Backward-compatible flat format when spatial metadata is absent
        for (const el of input.elements) {
          lines.push(`- ${this.formatElement(el)}`);
        }
      } else {
        // Spatial Attention format: in-viewport prioritized first
        if (partition.inViewport.length > 0) {
          lines.push('[In Viewport]:');
          for (const el of partition.inViewport) {
            lines.push(`- ${this.formatElement(el)}`);
          }
        }

        if (partition.outOfViewport.length > 0) {
          lines.push('[Outside Viewport - Scroll to Access]:');
          const clustered = this.spatialFilter.clusterOutOfViewport(partition.outOfViewport);

          for (const item of clustered) {
            if (item.type === 'single' && item.element) {
              const yHint = item.element.boundingBox?.y
                ? ` (Y: ${item.element.boundingBox.y}px)`
                : '';
              lines.push(`- ${this.formatElement(item.element)}${yHint}`);
            } else if (item.type === 'cluster') {
              const yHint = item.approximateY ? ` (Y: ~${item.approximateY}px)` : '';
              lines.push(
                `- [${item.clusterStartId} - ${item.clusterEndId}] ${item.clusterCount} links outside viewport${yHint} [Scroll down to inspect]`
              );
            }
          }
        }
      }
    }

    // Content Summary section
    const summaryLines: string[] = [];
    if (input.summary.headings && input.summary.headings.length > 0) {
      for (const h of input.summary.headings) {
        summaryLines.push(`- ${h}`);
      }
    }

    if (input.summary.notices && input.summary.notices.length > 0) {
      for (const n of input.summary.notices) {
        summaryLines.push(`- Notice: "${n}"`);
      }
    }

    if (input.summary.forms && input.summary.forms.length > 0) {
      for (const f of input.summary.forms) {
        const fieldStr = f.fields.length > 0 ? f.fields.join(', ') : 'none';
        summaryLines.push(`- Form "${f.formId || 'form'}": [${fieldStr}]`);
      }
    }

    if (input.summary.tables && input.summary.tables.length > 0) {
      for (const t of input.summary.tables) {
        const headersStr = t.headers.length > 0 ? t.headers.join(', ') : 'no-headers';
        summaryLines.push(`- Table: [${headersStr}] (${t.rowCount} rows)`);
      }
    }

    if (summaryLines.length > 0) {
      lines.push('Content Summary:');
      lines.push(...summaryLines);
    }

    // Recent Network Activity section
    if (input.networkSummary) {
      const { failedRequests, recentApiResponses } = input.networkSummary;
      const networkLines: string[] = [];

      // 1. Failed requests (e.g. connection drops, aborts)
      for (const req of failedRequests.slice(-3)) {
        networkLines.push(`- [FAILED REQUEST]: ${req.method} ${req.url} (${req.errorText})`);
      }

      // 2. Error API responses (HTTP 4xx / 5xx)
      const errorResponses = recentApiResponses.filter((r) => r.isError);
      for (const res of errorResponses.slice(-3)) {
        const bodySnippet = res.bodySummary ? ` -> ${res.bodySummary.replace(/\r?\n+/g, ' ').slice(0, 120)}` : '';
        networkLines.push(`- [API ERROR ${res.status}]: ${res.method} ${res.url}${bodySnippet}`);
      }

      // 3. Significant 2xx API responses (up to 2, if no errors or to show successful submission payload)
      if (errorResponses.length === 0) {
        const successResponses = recentApiResponses.filter((r) => !r.isError);
        for (const res of successResponses.slice(-2)) {
          const bodySnippet = res.bodySummary ? ` -> ${res.bodySummary.replace(/\r?\n+/g, ' ').slice(0, 100)}` : '';
          networkLines.push(`- [API ${res.status}]: ${res.method} ${res.url}${bodySnippet}`);
        }
      }

      if (networkLines.length > 0) {
        lines.push('Recent Network Activity:');
        lines.push(...networkLines);
      }
    }

    let fullText = lines.join('\n');

    // Enforce token budget
    if (fullText.length > maxChars) {
      fullText = this.pruneToBudget(lines, maxChars, maxTokens);
    }

    return fullText;
  }

  /**
   * Formats a single registered element into concise markdown line.
   */
  public formatElement(el: RegisteredElement): string {
    const role = el.role.toLowerCase();
    const name = el.name ? el.name.replace(/\s+/g, ' ').trim() : '';

    switch (role) {
      case 'textbox': {
        const val = el.value !== undefined ? el.value : '';
        return `[${el.id}] textbox "${name}" (current: "${val}")`;
      }
      case 'checkbox': {
        const state = el.checked ? 'checked' : 'unchecked';
        return `[${el.id}] checkbox "${name}" (${state})`;
      }
      case 'radio': {
        const state = el.checked ? 'selected' : 'unselected';
        return `[${el.id}] radio "${name}" (${state})`;
      }
      case 'button': {
        const disabled = el.disabled ? ' (disabled)' : '';
        return `[${el.id}] button "${name}"${disabled}`;
      }
      case 'link': {
        return `[${el.id}] link "${name}"`;
      }
      case 'combobox':
      case 'select': {
        const val = el.value !== undefined ? el.value : '';
        return `[${el.id}] combobox "${name}" (current: "${val}")`;
      }
      default: {
        return `[${el.id}] ${role} "${name}"`;
      }
    }
  }

  /**
   * Prunes lines to stay within the character/token budget while preserving structure.
   */
  private pruneToBudget(lines: string[], maxChars: number, maxTokens: number): string {
    const truncationNotice = `\n... [Observation truncated to fit token budget of ${maxTokens} tokens]`;
    const targetLength = maxChars - truncationNotice.length;

    let currentLength = 0;
    const keptLines: string[] = [];

    for (const line of lines) {
      if (currentLength + line.length + 1 > targetLength) {
        break;
      }
      keptLines.push(line);
      currentLength += line.length + 1;
    }

    return keptLines.join('\n') + truncationNotice;
  }

  /**
   * Estimates token count for a given text.
   */
  public estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }
}
