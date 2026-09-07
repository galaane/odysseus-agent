import { describe, it, expect } from 'vitest';
import {
  SourceTracker,
  extractDomain,
  calculateDomainCorroboration,
  ResearchEngine,
  type Source,
  type Finding,
  type Evidence,
} from '../../src/research/index.js';

describe('Phase 11: Autonomous Research Subsystem', () => {
  describe('extractDomain', () => {
    it('should extract lowercased hostname from standard URLs', () => {
      expect(extractDomain('https://www.example.com/path/to/page')).toBe('www.example.com');
      expect(extractDomain('http://API.Subdomain.Test.org:8080/query?foo=bar')).toBe('api.subdomain.test.org');
    });

    it('should handle URLs without protocol or malformed URLs gracefully', () => {
      expect(extractDomain('github.com/my-repo')).toBe('github.com');
      expect(extractDomain('localhost:3000')).toBe('localhost');
    });
  });

  describe('SourceTracker', () => {
    it('should record a valid source and assign an incremental id', () => {
      const tracker = new SourceTracker();
      const s1 = tracker.recordSource('https://developer.mozilla.org/en-US/', 'MDN Web Docs', 0.9);

      expect(s1.id).toBe('src_001');
      expect(s1.url).toBe('https://developer.mozilla.org/en-US/');
      expect(s1.domain).toBe('developer.mozilla.org');
      expect(s1.title).toBe('MDN Web Docs');
      expect(s1.relevance).toBe(0.9);
      expect(s1.accessedAt).toBeDefined();
      expect(tracker.size()).toBe(1);
    });

    it('should throw when attempting to record invalid or blank URLs', () => {
      const tracker = new SourceTracker();
      expect(() => tracker.recordSource('')).toThrow('Cannot record invalid or blank URL');
      expect(() => tracker.recordSource('about:blank')).toThrow('Cannot record invalid or blank URL');
    });

    it('should update existing source when same URL is recorded multiple times', () => {
      const tracker = new SourceTracker();
      const s1 = tracker.recordSource('https://example.com/news', undefined, 0.5);
      const initialAccessedAt = s1.accessedAt;

      const s2 = tracker.recordSource('https://example.com/news', 'Updated Title', 0.95);

      expect(tracker.size()).toBe(1);
      expect(s2.id).toBe(s1.id);
      expect(s2.title).toBe('Updated Title');
      expect(s2.relevance).toBe(0.95);
      expect(tracker.getSourceByUrl('https://example.com/news')?.title).toBe('Updated Title');
    });

    it('should retrieve sources by ID and URL', () => {
      const tracker = new SourceTracker();
      const s1 = tracker.recordSource('https://alpha.com');
      const s2 = tracker.recordSource('https://beta.com');

      expect(tracker.getSource(s1.id)).toEqual(s1);
      expect(tracker.getSource(s2.id)).toEqual(s2);
      expect(tracker.getSource('nonexistent')).toBeUndefined();

      expect(tracker.getSourceByUrl('https://alpha.com')).toEqual(s1);
      expect(tracker.getSourceByUrl('https://gamma.com')).toBeUndefined();
    });

    it('should collect unique domains and filter sources by domain', () => {
      const tracker = new SourceTracker();
      tracker.recordSource('https://docs.site.com/intro');
      tracker.recordSource('https://docs.site.com/advanced');
      tracker.recordSource('https://blog.site.com/news');

      const domains = tracker.getUniqueDomains();
      expect(domains).toHaveLength(2);
      expect(domains).toContain('docs.site.com');
      expect(domains).toContain('blog.site.com');

      const docsSources = tracker.getSourcesForDomain('docs.site.com');
      expect(docsSources).toHaveLength(2);
    });

    it('should clear all recorded sources', () => {
      const tracker = new SourceTracker();
      tracker.recordSource('https://example.com');
      expect(tracker.size()).toBe(1);
      tracker.clear();
      expect(tracker.size()).toBe(0);
      expect(tracker.getAllSources()).toEqual([]);
    });
  });

  describe('calculateDomainCorroboration', () => {
    const makeSource = (id: string, domain: string): Source => ({
      id,
      url: `https://${domain}/page`,
      domain,
      accessedAt: new Date().toISOString(),
    });

    it('should return default 0.5 for empty sources', () => {
      expect(calculateDomainCorroboration([])).toBe(0.5);
    });

    it('should score single source as 0.80', () => {
      const sources = [makeSource('1', 'alpha.com')];
      expect(calculateDomainCorroboration(sources)).toBe(0.80);
    });

    it('should score multiple sources from the same domain as 0.88', () => {
      const sources = [
        makeSource('1', 'alpha.com'),
        makeSource('2', 'alpha.com'),
      ];
      expect(calculateDomainCorroboration(sources)).toBe(0.88);
    });

    it('should score 2 distinct domains as 0.95', () => {
      const sources = [
        makeSource('1', 'alpha.com'),
        makeSource('2', 'beta.com'),
      ];
      expect(calculateDomainCorroboration(sources)).toBe(0.95);
    });

    it('should score 3 or more distinct domains as 0.99', () => {
      const sources = [
        makeSource('1', 'alpha.com'),
        makeSource('2', 'beta.com'),
        makeSource('3', 'gamma.org'),
      ];
      expect(calculateDomainCorroboration(sources)).toBe(0.99);
    });
  });

  describe('ResearchEngine', () => {
    it('should track sources and record findings with corroboration score', () => {
      const engine = new ResearchEngine();

      engine.recordSource('https://reuters.com/article1', 'Reuters News');
      engine.recordSource('https://bbc.com/news/123', 'BBC World News');

      const finding = engine.addFinding(
        'Global EV sales increased by 25% year-over-year.',
        ['https://reuters.com/article1', 'https://bbc.com/news/123'],
        {
          notes: 'Corroborated across two major international news outlets',
          snippet: 'Electric vehicle sales surged by 25 percent in the past calendar year.',
        }
      );

      expect(finding.id).toBe('find_001');
      expect(finding.claim).toBe('Global EV sales increased by 25% year-over-year.');
      expect(finding.sourceIds).toHaveLength(2);
      expect(finding.confidence).toBe(0.95); // 2 distinct domains
      expect(finding.notes).toBeDefined();

      const evidence = engine.getEvidenceForFinding(finding.id);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].snippet).toContain('Electric vehicle sales surged');

      const allFindings = engine.getFindings();
      expect(allFindings).toHaveLength(1);
    });

    it('should auto-register URLs in findings if not pre-recorded in tracker', () => {
      const engine = new ResearchEngine();

      const finding = engine.addFinding(
        'TypeScript 5.5 introduces type predicate inference.',
        ['https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/']
      );

      expect(finding.sourceIds).toHaveLength(1);
      expect(engine.getSourceTracker().size()).toBe(1);
      const src = engine.getSourceTracker().getSource(finding.sourceIds[0]);
      expect(src?.domain).toBe('devblogs.microsoft.com');
    });

    it('should generate a comprehensive structured research report', () => {
      const engine = new ResearchEngine();

      engine.addFinding('Fact 1', ['https://site1.org/fact1', 'https://site2.org/fact1']);
      engine.addFinding('Fact 2', ['https://site3.org/fact2']);

      const report = engine.generateReport('Renewable Energy Growth 2026');

      expect(report.topic).toBe('Renewable Energy Growth 2026');
      expect(report.totalSources).toBe(3);
      expect(report.uniqueDomains).toBe(3);
      expect(report.findings).toHaveLength(2);
      expect(report.summaryText).toContain('Renewable Energy Growth 2026');
      expect(report.summaryText).toContain('Fact 1');
      expect(report.summaryText).toContain('Fact 2');
    });
  });
});
