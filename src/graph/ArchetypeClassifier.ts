import type { PageSnapshot } from '../observer/PageSnapshot.js';
import type { DomainArchetype, ArchetypeClassificationResult } from './types.js';

interface ArchetypeRule {
  archetype: DomainArchetype;
  keywords: RegExp[];
  urlPatterns: RegExp[];
  elementPatterns: RegExp[];
}

const ARCHETYPE_RULES: ArchetypeRule[] = [
  {
    archetype: 'ecommerce',
    keywords: [
      /\b(?:add to cart|buy now|checkout|shopping cart|product details|in stock|out of stock|subtotal|shipping fee)\b/i,
      /[$€£¥]\s*\d+(?:\.\d{2})?|\b(?:idr|rp)\s*\d+/i,
    ],
    urlPatterns: [
      /[/?&](?:cart|checkout|products?|shop|catalog|item)\b/i,
      /(?:shopify|woocommerce|store|mall)/i,
    ],
    elementPatterns: [
      /\b(?:cart|checkout|buy|bag|basket|order)\b/i,
    ],
  },
  {
    archetype: 'documentation',
    keywords: [
      /\b(?:documentation|api reference|getting started|quickstart|developer guide|sdk|installation guide|table of contents)\b/i,
      /\b(?:next page|previous page|edit on github|api endpoints?)\b/i,
    ],
    urlPatterns: [
      /[/?&](?:docs?|reference|guides?|manual|api-docs)\b/i,
      /(?:gitbook|docusaurus|mkdocs|readme\.io)/i,
    ],
    elementPatterns: [
      /\b(?:sidebar|nav|toc|version|copy code)\b/i,
    ],
  },
  {
    archetype: 'code_repository',
    keywords: [
      /\b(?:pull requests?|commits?|branches?|repositories|fork|clone repository|releases|contributors)\b/i,
    ],
    urlPatterns: [
      /(?:github\.com|gitlab\.com|bitbucket\.org|gitea)/i,
      /[/?&](?:pulls|commits|tree|blob|issues)\b/i,
    ],
    elementPatterns: [
      /\b(?:code|clone|fork|star|branch)\b/i,
    ],
  },
  {
    archetype: 'saas_app',
    keywords: [
      /\b(?:dashboard|workspace|organization|team members|billing & plans|usage analytics|api keys|integrations)\b/i,
    ],
    urlPatterns: [
      /[/?&](?:dashboard|app|workspace|settings|billing|analytics|console)\b/i,
    ],
    elementPatterns: [
      /\b(?:profile|settings|workspace|invite|export)\b/i,
    ],
  },
  {
    archetype: 'auth_portal',
    keywords: [
      /\b(?:sign in|log in|enter your password|forgot password|create an account|single sign-on|remember me|two-factor)\b/i,
    ],
    urlPatterns: [
      /[/?&](?:login|signin|auth|session|register|signup)\b/i,
    ],
    elementPatterns: [
      /\b(?:password|submit|sign in|log in|continue with google)\b/i,
    ],
  },
  {
    archetype: 'content_blog',
    keywords: [
      /\b(?:published on|read time|author|leave a comment|related articles|share this post|newsletter)\b/i,
    ],
    urlPatterns: [
      /[/?&](?:blog|articles?|posts?|news|stories)\b/i,
    ],
    elementPatterns: [
      /\b(?:article|author|comments|tags)\b/i,
    ],
  },
];

export class ArchetypeClassifier {
  /**
   * Classifies a webpage observation snapshot into a canonical Domain Archetype.
   */
  public classify(snapshot: PageSnapshot): ArchetypeClassificationResult {
    const url = snapshot.url || '';
    const textCorpus = [
      url,
      snapshot.title || '',
      snapshot.compressedObservationText || '',
      ...(snapshot.pageSummary?.headings || []),
    ].join(' ');

    const interactiveNames = (snapshot.interactiveElements || [])
      .map((el) => `${el.role} ${el.name}`)
      .join(' ');

    const scores: Record<DomainArchetype, { score: number; indicators: string[] }> = {
      ecommerce: { score: 0, indicators: [] },
      documentation: { score: 0, indicators: [] },
      code_repository: { score: 0, indicators: [] },
      saas_app: { score: 0, indicators: [] },
      auth_portal: { score: 0, indicators: [] },
      content_blog: { score: 0, indicators: [] },
      general_web: { score: 0, indicators: [] },
    };

    for (const rule of ARCHETYPE_RULES) {
      // 1. Check URL patterns
      for (const pattern of rule.urlPatterns) {
        if (pattern.test(url)) {
          scores[rule.archetype].score += 2.0;
          scores[rule.archetype].indicators.push(`URL matches ${pattern.toString()}`);
        }
      }

      // 2. Check keyword patterns
      for (const pattern of rule.keywords) {
        if (pattern.test(textCorpus)) {
          scores[rule.archetype].score += 1.5;
          scores[rule.archetype].indicators.push(`Text contains keyword: ${pattern.toString()}`);
        }
      }

      // 3. Check interactive element patterns
      for (const pattern of rule.elementPatterns) {
        if (pattern.test(interactiveNames)) {
          scores[rule.archetype].score += 1.0;
          scores[rule.archetype].indicators.push(`Interactive elements match: ${pattern.toString()}`);
        }
      }
    }

    // Determine top scoring archetype
    let topArchetype: DomainArchetype = 'general_web';
    let maxScore = 0;

    for (const [arch, entry] of Object.entries(scores) as [DomainArchetype, { score: number; indicators: string[] }][]) {
      if (entry.score > maxScore) {
        maxScore = entry.score;
        topArchetype = arch;
      }
    }

    if (maxScore < 2.0) {
      return {
        archetype: 'general_web',
        confidence: 0.3,
        matchedIndicators: ['Default general_web classification (insufficient specific indicators)'],
      };
    }

    const confidence = Math.min(0.98, Number((0.5 + Math.min(0.48, maxScore * 0.08)).toFixed(2)));

    return {
      archetype: topArchetype,
      confidence,
      matchedIndicators: scores[topArchetype].indicators.slice(0, 5),
    };
  }
}
