import type { Page } from 'playwright-core';
import type { WatcherJob } from './types.js';
import type { Logger } from '../logging/Logger.js';

export interface ConditionEvaluation {
  conditionMet: boolean;
  observedValue: unknown;
  error?: string;
}

export class ConditionEvaluator {
  constructor(private readonly logger?: Logger) {}

  /**
   * Extracts a numeric price from arbitrary text containing currencies and separators.
   */
  public extractPrice(text: string): number | null {
    if (!text) return null;
    const cleaned = text.trim();
    // Match common price patterns like $1,299.99, € 49,99, Rp 150.000, 399.00
    const match = cleaned.match(
      /(?:[\$€£¥₹]|Rp\.?|USD|EUR|GBP)?\s*([0-9]{1,3}(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i
    );
    if (!match || !match[1]) return null;

    let numStr = match[1].replace(/\s+/g, '');
    if (numStr.includes(',') && numStr.includes('.')) {
      if (numStr.indexOf('.') < numStr.indexOf(',')) {
        // 1.234,56 format
        numStr = numStr.replace(/\./g, '').replace(',', '.');
      } else {
        // 1,234.56 format
        numStr = numStr.replace(/,/g, '');
      }
    } else if (numStr.includes(',')) {
      const parts = numStr.split(',');
      if (parts[1] && parts[1].length === 2) {
        numStr = numStr.replace(',', '.');
      } else if (parts[1] && parts[1].length === 3) {
        numStr = numStr.replace(',', '');
      } else {
        numStr = numStr.replace(',', '.');
      }
    } else if (numStr.includes('.')) {
      const parts = numStr.split('.');
      if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) {
        numStr = numStr.replace(/\./g, '');
      }
    }

    const val = parseFloat(numStr);
    return isNaN(val) ? null : val;
  }

  /**
   * Evaluates a watcher condition on a live Playwright page.
   */
  public async evaluateOnPage(page: Page, job: WatcherJob): Promise<ConditionEvaluation> {
    try {
      switch (job.conditionType) {
        case 'element_present': {
          const locator = page.locator(job.conditionTarget);
          const count = await locator.count();
          return {
            conditionMet: count > 0,
            observedValue: count,
          };
        }

        case 'element_missing': {
          const locator = page.locator(job.conditionTarget);
          const count = await locator.count();
          return {
            conditionMet: count === 0,
            observedValue: count,
          };
        }

        case 'text_contains': {
          let text = '';
          if (job.conditionTarget && job.conditionTarget.trim() !== '') {
            const locator = page.locator(job.conditionTarget).first();
            text = (await locator.innerText().catch(() => '')) || '';
          } else {
            text = (await page.innerText('body').catch(() => '')) || '';
          }

          const targetStr = String(job.conditionValue).toLowerCase();
          const contains = text.toLowerCase().includes(targetStr);
          return {
            conditionMet: contains,
            observedValue: text.trim().slice(0, 150),
          };
        }

        case 'regex_match': {
          let text = '';
          if (job.conditionTarget && job.conditionTarget.trim() !== '') {
            const locator = page.locator(job.conditionTarget).first();
            text = (await locator.innerText().catch(() => '')) || '';
          } else {
            text = (await page.innerText('body').catch(() => '')) || '';
          }

          const regex = new RegExp(String(job.conditionValue), 'i');
          const isMatch = regex.test(text);
          return {
            conditionMet: isMatch,
            observedValue: text.trim().slice(0, 150),
          };
        }

        case 'price_below':
        case 'price_above': {
          let text = '';
          if (job.conditionTarget && job.conditionTarget.trim() !== '') {
            const locator = page.locator(job.conditionTarget).first();
            text = (await locator.innerText().catch(() => '')) || '';
          } else {
            text = (await page.innerText('body').catch(() => '')) || '';
          }

          const observedPrice = this.extractPrice(text);
          if (observedPrice === null) {
            return {
              conditionMet: false,
              observedValue: null,
              error: `Could not parse price from text: "${text.slice(0, 80)}"`,
            };
          }

          const targetThreshold = Number(job.conditionValue);
          const met =
            job.conditionType === 'price_below'
              ? observedPrice <= targetThreshold
              : observedPrice >= targetThreshold;

          return {
            conditionMet: met,
            observedValue: observedPrice,
          };
        }

        default:
          return {
            conditionMet: false,
            observedValue: null,
            error: `Unknown condition type: ${String(job.conditionType)}`,
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn('ConditionEvaluator', `Evaluation failed for job [${job.id}]: ${msg}`);
      return {
        conditionMet: false,
        observedValue: null,
        error: msg,
      };
    }
  }

  /**
   * Evaluates text directly (useful for testing or cached snapshot evaluation).
   */
  public evaluateText(text: string, job: WatcherJob): ConditionEvaluation {
    switch (job.conditionType) {
      case 'text_contains': {
        const targetStr = String(job.conditionValue).toLowerCase();
        return {
          conditionMet: text.toLowerCase().includes(targetStr),
          observedValue: text.slice(0, 150),
        };
      }
      case 'regex_match': {
        const regex = new RegExp(String(job.conditionValue), 'i');
        return {
          conditionMet: regex.test(text),
          observedValue: text.slice(0, 150),
        };
      }
      case 'price_below':
      case 'price_above': {
        const price = this.extractPrice(text);
        if (price === null) {
          return { conditionMet: false, observedValue: null, error: 'No price found' };
        }
        const target = Number(job.conditionValue);
        const met = job.conditionType === 'price_below' ? price <= target : price >= target;
        return { conditionMet: met, observedValue: price };
      }
      default:
        return {
          conditionMet: false,
          observedValue: null,
          error: `Condition type ${job.conditionType} requires live DOM`,
        };
    }
  }
}
