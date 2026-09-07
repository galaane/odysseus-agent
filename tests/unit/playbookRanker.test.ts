import { describe, it, expect } from 'vitest';
import { PlaybookRanker } from '../../src/persistence/PlaybookRanker.js';
import type { DomainPlaybookRecord } from '../../src/persistence/types.js';

describe('Phase 29: Goal-Conditioned Semantic Playbook Ranking Subsystem', () => {
  const ranker = new PlaybookRanker();

  function makePlaybook(options: {
    id: string;
    domain?: string;
    pattern_type?: string;
    pattern_key: string;
    category?: string;
    rule?: string;
    confidence?: number;
    success_count?: number;
  }): DomainPlaybookRecord {
    const isReflexion = options.pattern_type === undefined || options.pattern_type === 'reflexion_heuristic';
    const playbookData = isReflexion
      ? JSON.stringify({
          category: options.category || 'general',
          rule: options.rule || options.pattern_key,
          confidence: options.confidence ?? 0.8,
        })
      : options.rule || 'Plain playbook text';

    return {
      id: options.id,
      domain: options.domain || 'shop.test',
      pattern_type: options.pattern_type || 'reflexion_heuristic',
      pattern_key: options.pattern_key,
      playbook_data: playbookData,
      success_count: options.success_count ?? 1,
      last_applied_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
  }

  it('should rank checkout and form-fill playbooks higher for checkout goals', () => {
    const playbooks: DomainPlaybookRecord[] = [
      makePlaybook({
        id: 'pb_search',
        pattern_key: 'Use search query parameter directly',
        category: 'search',
        rule: 'Type query into #search-input and press enter',
        success_count: 5,
      }),
      makePlaybook({
        id: 'pb_checkout',
        pattern_key: 'Handle checkout modal overlay',
        category: 'checkout',
        rule: 'Dismiss newsletter modal before clicking place order button',
        success_count: 2,
      }),
      makePlaybook({
        id: 'pb_nav',
        pattern_key: 'Homepage navigation',
        category: 'navigation',
        rule: 'Click home logo to reset state',
        success_count: 1,
      }),
    ];

    const ranked = ranker.rankPlaybooks(playbooks, 'Buy running shoes and checkout cart');

    expect(ranked).toHaveLength(3);
    // The checkout playbook should be ranked #1 despite having lower success_count than search
    expect(ranked[0].record.id).toBe('pb_checkout');
    expect(ranked[0].category).toBe('checkout');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('should prioritize keyword overlap with task goal', () => {
    const playbooks: DomainPlaybookRecord[] = [
      makePlaybook({
        id: 'pb_laptops',
        pattern_key: 'Filter by gaming laptop category',
        category: 'search',
        rule: 'Select gaming checkbox in sidebar filters',
      }),
      makePlaybook({
        id: 'pb_shoes',
        pattern_key: 'Select shoe size from dropdown',
        category: 'search',
        rule: 'Open size picker and select US 10',
      }),
    ];

    const ranked = ranker.rankPlaybooks(playbooks, 'Find running shoes in size 10');

    expect(ranked[0].record.id).toBe('pb_shoes');
    expect(ranked[0].matchedKeywords).toContain('shoes');
  });

  it('should boost score when current URL path matches playbook context', () => {
    const playbooks: DomainPlaybookRecord[] = [
      makePlaybook({
        id: 'pb_general',
        pattern_key: 'Generic site footer interaction',
        rule: 'Footer links require scrolling',
      }),
      makePlaybook({
        id: 'pb_billing',
        pattern_key: 'Billing address autofill',
        rule: 'Fill billing postal code accurately',
      }),
    ];

    const ranked = ranker.rankPlaybooks(playbooks, 'Complete user form', {
      currentUrl: 'https://shop.test/account/billing',
    });

    expect(ranked[0].record.id).toBe('pb_billing');
  });

  it('should enforce maxPlaybooks and token budget constraints', () => {
    const playbooks: DomainPlaybookRecord[] = Array.from({ length: 10 }, (_, i) =>
      makePlaybook({
        id: `pb_${i}`,
        pattern_key: `Rule number ${i}`,
        category: 'search',
        rule: `Search rule detail for item ${i} with extended explanation text to test token limits`,
      })
    );

    const ranked = ranker.rankPlaybooks(playbooks, 'Search for products', {
      maxPlaybooks: 3,
      maxTokens: 100,
    });

    expect(ranked.length).toBeLessThanOrEqual(3);
  });

  it('should format ranked playbooks properly for prompt injection', () => {
    const playbooks: DomainPlaybookRecord[] = [
      makePlaybook({
        id: 'pb_01',
        pattern_key: 'Close newsletter popup',
        category: 'modal_handling',
        rule: 'Click #close-btn on dialog',
        confidence: 0.9,
      }),
      makePlaybook({
        id: 'pb_02',
        pattern_type: 'action_sequence',
        pattern_key: 'Login sequence',
        rule: 'enter username -> enter password -> click submit',
      }),
    ];

    const formatted = ranker.rankAndFormat(playbooks, 'Dismiss modal and login');

    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toContain('[Learned Rule (modal_handling)]: Click #close-btn on dialog (confidence: 0.90)');
    expect(formatted[1]).toContain('[action_sequence] Login sequence: enter username -> enter password -> click submit');
  });

  it('should handle empty lists or invalid data gracefully', () => {
    expect(ranker.rankPlaybooks([], 'Goal')).toEqual([]);
    expect(ranker.rankAndFormat([], 'Goal')).toEqual([]);

    const badPlaybook: DomainPlaybookRecord = {
      id: 'pb_bad',
      domain: 'shop.test',
      pattern_type: 'reflexion_heuristic',
      pattern_key: 'Corrupted data',
      playbook_data: '{ invalid json ...',
      success_count: 0,
      last_applied_at: '2026-09-07',
      created_at: '2026-09-07',
    };

    const ranked = ranker.rankPlaybooks([badPlaybook], 'Test');
    expect(ranked).toHaveLength(1);
    expect(ranked[0].category).toBe('general');
  });
});
