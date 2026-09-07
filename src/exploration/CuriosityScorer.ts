import type { RegisteredElement } from '../observer/ElementRegistry.js';
import type { CuriosityCandidate, RouteNode } from './types.js';

export interface CuriosityScorerOptions {
  domain: string;
  visitedPaths?: Set<string>;
  knownNodes?: Map<string, RouteNode>;
  allowExternalDomains?: boolean;
}

export class CuriosityScorer {
  private static readonly DESTRUCTIVE_KEYWORDS = [
    'logout',
    'log-out',
    'signout',
    'sign-out',
    'delete',
    'destroy',
    'remove',
    'cancel',
    'terminate',
    'wipe',
    'purge',
    'reset',
    'buy-now',
    'pay',
    'checkout',
    'confirm-order',
    'place-order',
    'unsubscribe',
    'deactivate',
  ];

  public scoreCandidate(
    element: RegisteredElement,
    currentPath: string,
    options: CuriosityScorerOptions
  ): CuriosityCandidate {
    const role = element.role.toLowerCase();
    const name = (element.name || '').toLowerCase();
    const val = (element.value || '').toLowerCase();
    const ph = (element.placeholder || '').toLowerCase();
    const selector = element.locatorStrategy.selector.toLowerCase();

    // 1. Safety Filter Check
    const combinedContent = `${name} ${val} ${ph} ${selector}`;
    for (const kw of CuriosityScorer.DESTRUCTIVE_KEYWORDS) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(combinedContent) || combinedContent.includes(kw)) {
        return {
          elementId: element.id,
          actionType: 'click',
          targetRole: element.role,
          targetName: element.name,
          targetSelector: element.locatorStrategy.selector,
          curiosityScore: -Infinity,
          isSafe: false,
          reasoning: `Unsafe action: matches destructive pattern "${kw}" (Safety Filter triggered)`,
        };
      }
    }

    let score = 0;
    let reasoning = '';
    let actionType: 'click' | 'fill' = 'click';
    let fillValue: string | undefined = undefined;

    // 2. Element Type & Affordance Value
    const isSearchInput =
      role === 'searchbox' ||
      (role === 'textbox' &&
        (name.includes('search') ||
          ph.includes('search') ||
          selector.includes('search') ||
          selector.includes('query')));

    if (isSearchInput) {
      score += 18;
      actionType = 'fill';
      fillValue = 'laptop'; // Default benign exploratory probe query
      reasoning = 'Search affordance with high information gain potential';
    } else if (role === 'link') {
      score += 8;
      reasoning = 'Navigation link affordance';

      // Check if it's within a nav landmark
      if (selector.includes('nav') || selector.includes('menu') || selector.includes('header')) {
        score += 4;
        reasoning += ' (in navigation structure)';
      }
    } else if (role === 'button') {
      score += 6;
      reasoning = 'Interactive button affordance';
      if (name.includes('view') || name.includes('detail') || name.includes('more')) {
        score += 3;
      }
    } else if (role === 'textbox' || role === 'combobox') {
      score += 5;
      actionType = 'fill';
      fillValue = 'test';
      reasoning = 'Form input affordance';
    }

    // 3. Novelty Evaluation (Target Path Prediction)
    let predictedPath = this.extractPathFromSelector(element.locatorStrategy.selector);
    if (!predictedPath && element.locatorStrategy.type === 'role') {
      predictedPath = `/${name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    }

    if (predictedPath) {
      if (options.visitedPaths && options.visitedPaths.has(predictedPath)) {
        score -= 6;
        reasoning += ' (already visited route)';
      } else {
        score += 8;
        reasoning += ' (novel unexplored route)';
      }
    }

    // Ensure benign positive score if safe
    const finalScore = Math.max(1, score);

    return {
      elementId: element.id,
      actionType,
      fillValue,
      targetPath: predictedPath || undefined,
      targetRole: element.role,
      targetName: element.name,
      targetSelector: element.locatorStrategy.selector,
      curiosityScore: finalScore,
      isSafe: true,
      reasoning,
    };
  }

  public rankCandidates(
    elements: RegisteredElement[],
    currentPath: string,
    options: CuriosityScorerOptions
  ): CuriosityCandidate[] {
    const candidates: CuriosityCandidate[] = [];

    for (const el of elements) {
      const candidate = this.scoreCandidate(el, currentPath, options);
      if (candidate.isSafe && candidate.curiosityScore > 0) {
        candidates.push(candidate);
      }
    }

    // Sort descending by curiosity score
    return candidates.sort((a, b) => b.curiosityScore - a.curiosityScore);
  }

  private extractPathFromSelector(selector: string): string | null {
    // Check href attribute in CSS selectors, e.g. a[href="/catalog"]
    const hrefMatch = selector.match(/href=["']?([^"'>\s]+)["']?/i);
    if (hrefMatch && hrefMatch[1]) {
      const rawHref = hrefMatch[1];
      if (rawHref.startsWith('/')) {
        return rawHref.split('?')[0].split('#')[0];
      }
      try {
        const parsed = new URL(rawHref);
        return parsed.pathname;
      } catch {
        return null;
      }
    }
    return null;
  }
}
