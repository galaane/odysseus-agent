import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemory } from '../../src/memory/WorkingMemory.js';
import { TaskMemory } from '../../src/memory/TaskMemory.js';
import { ResearchMemory } from '../../src/memory/ResearchMemory.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';

describe('Memory Subsystem (3-Tier Decoupled Memory)', () => {
  describe('WorkingMemory (Tier 1: Transient Perception Context)', () => {
    let workingMemory: WorkingMemory;

    beforeEach(() => {
      workingMemory = new WorkingMemory();
    });

    it('should record, retrieve, and summarize transient facts', () => {
      workingMemory.addFact('Search input box is located at #search', { category: 'element' });
      workingMemory.addFact('Page requires user consent banner dismissal', { category: 'modal' });

      const facts = workingMemory.getFacts();
      expect(facts).toHaveLength(2);
      expect(facts[0]).toBe('Search input box is located at #search');
      expect(facts[1]).toBe('Page requires user consent banner dismissal');

      const summary = workingMemory.summarize();
      expect(summary).toContain('1. Search input box is located at #search [element]');
      expect(summary).toContain('2. Page requires user consent banner dismissal [modal]');
    });

    it('should clear domain-specific facts when navigating to a new domain', () => {
      workingMemory.addFact('Logged in to dashboard on alpha.com', { domain: 'alpha.com' });
      workingMemory.addFact('Global user requirement: extract pricing', {}); // global fact
      workingMemory.addFact('Checkout form present on beta.org', { domain: 'beta.org' });

      // Navigate to beta.org: alpha.com facts should be purged, global and beta.org facts kept
      workingMemory.clearForDomainChange('beta.org');

      const facts = workingMemory.getFacts();
      expect(facts).toContain('Global user requirement: extract pricing');
      expect(facts).toContain('Checkout form present on beta.org');
      expect(facts).not.toContain('Logged in to dashboard on alpha.com');
    });

    it('should serialize and restore working memory snapshot cleanly', () => {
      workingMemory.addFact('Fact 1');
      workingMemory.addFact('Fact 2');

      const serialized = workingMemory.serialize();
      expect(serialized).toHaveLength(2);

      const freshMemory = new WorkingMemory();
      freshMemory.deserialize(serialized);
      expect(freshMemory.getFacts()).toEqual(['Fact 1', 'Fact 2']);
    });
  });

  describe('TaskMemory (Tier 2: Goals, Progress & Milestones)', () => {
    let taskMemory: TaskMemory;

    beforeEach(() => {
      taskMemory = new TaskMemory('Find the cheapest laptop on techstore.local');
    });

    it('should track visited URLs without duplicates or about:blank', () => {
      taskMemory.addVisitedUrl('about:blank');
      taskMemory.addVisitedUrl('https://techstore.local/catalog');
      taskMemory.addVisitedUrl('https://techstore.local/catalog'); // duplicate
      taskMemory.addVisitedUrl('https://techstore.local/product/101');

      const visited = taskMemory.getVisitedUrls();
      expect(visited).toEqual([
        'https://techstore.local/catalog',
        'https://techstore.local/product/101',
      ]);
      expect(taskMemory.hasVisitedUrl('https://techstore.local/catalog')).toBe(true);
      expect(taskMemory.hasVisitedUrl('https://techstore.local/other')).toBe(false);
    });

    it('should track milestones and toggle completion status', () => {
      taskMemory.setMilestones([
        { id: 'm1', title: 'Open catalog page', completed: false },
        { id: 'm2', title: 'Filter by price ascending', completed: false },
      ]);

      taskMemory.updateMilestone('m1', true);

      const milestones = taskMemory.getMilestones();
      expect(milestones[0].completed).toBe(true);
      expect(milestones[1].completed).toBe(false);
    });

    it('should track and resolve open questions', () => {
      const qId = taskMemory.addQuestion('Is user logged in?');
      expect(taskMemory.getUnresolvedQuestions()).toHaveLength(1);

      taskMemory.resolveQuestion(qId, 'Yes, session avatar visible.');
      expect(taskMemory.getUnresolvedQuestions()).toHaveLength(0);
    });

    it('should serialize and deserialize task memory state', () => {
      taskMemory.addVisitedUrl('https://example.com/step1');
      taskMemory.recordAction({ actionType: 'click', targetId: 'el_001', success: true });
      const qId = taskMemory.addQuestion('What is price?');

      const serialized = taskMemory.serialize();
      const freshTaskMemory = new TaskMemory();
      freshTaskMemory.deserialize(serialized);

      expect(freshTaskMemory.getGoal()).toBe('Find the cheapest laptop on techstore.local');
      expect(freshTaskMemory.getVisitedUrls()).toEqual(['https://example.com/step1']);
      expect(freshTaskMemory.getAttemptedActions()).toHaveLength(1);
      expect(freshTaskMemory.getUnresolvedQuestions()).toHaveLength(1);
    });
  });

  describe('ResearchMemory (Tier 3: Structured Claims & Source Attribution)', () => {
    let researchMemory: ResearchMemory;

    beforeEach(() => {
      researchMemory = new ResearchMemory();
    });

    it('should record sources, extract domain automatically, and prevent URL duplicates', () => {
      const src1 = researchMemory.addSource({
        url: 'https://news.ycombinator.com/item?id=123',
        title: 'Hacker News Item',
      });
      expect(src1.domain).toBe('news.ycombinator.com');
      expect(src1.id).toBeDefined();

      const src2 = researchMemory.addSource({
        url: 'https://news.ycombinator.com/item?id=123',
        title: 'Duplicate Item',
      });
      expect(src2.id).toBe(src1.id);
      expect(researchMemory.getSources()).toHaveLength(1);
    });

    it('should record findings linked directly to source URLs with confidence', () => {
      const finding = researchMemory.addFinding({
        claim: 'Laptop Model X sells for $899 at Store A',
        sourceUrls: ['https://store-a.com/products/model-x'],
        confidence: 0.95,
        notes: 'Verified against promotional price',
      });

      expect(finding.id).toBeDefined();
      expect(finding.claim).toBe('Laptop Model X sells for $899 at Store A');
      expect(finding.confidence).toBe(0.95);
      expect(finding.sourceUrls).toContain('https://store-a.com/products/model-x');
      expect(researchMemory.getFindings()).toHaveLength(1);
    });

    it('should serialize and deserialize research memory', () => {
      researchMemory.addSource({ url: 'https://docs.site.com', title: 'Docs' });
      researchMemory.addFinding({ claim: 'Claim 1', sourceUrls: ['https://docs.site.com'] });

      const data = researchMemory.serialize();
      const fresh = new ResearchMemory();
      fresh.deserialize(data);

      expect(fresh.getSources()).toHaveLength(1);
      expect(fresh.getFindings()).toHaveLength(1);
    });
  });

  describe('MemoryManager Coordination & Secret Isolation (Invariants 9 & 11)', () => {
    let memoryManager: MemoryManager;

    beforeEach(() => {
      memoryManager = new MemoryManager('Investigate product features');
    });

    it('should sanitize credentials, passwords, and tokens before entering memory (Invariant 11)', () => {
      const sanitized1 = memoryManager.sanitize('User entered password: SuperSecretPassword123 into input');
      expect(sanitized1).not.toContain('SuperSecretPassword123');
      expect(sanitized1).toContain('password=[REDACTED]');

      const sanitized2 = memoryManager.sanitize('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(sanitized2).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(sanitized2).toContain('Bearer [REDACTED]');
    });

    it('should create complete serializable snapshot and restore cleanly across instances', () => {
      memoryManager.getWorkingMemory().addFact('Page heading says Welcome');
      memoryManager.getTaskMemory().addVisitedUrl('https://example.com/welcome');
      memoryManager.getTaskMemory().addQuestion('Is checkout button visible?');
      memoryManager.getResearchMemory().addSource({ url: 'https://example.com/welcome', title: 'Welcome' });
      memoryManager.getResearchMemory().addFinding({
        claim: 'Free shipping applies on orders over $50',
        sourceUrls: ['https://example.com/welcome'],
        confidence: 1.0,
      });

      const snapshot = memoryManager.createSnapshot();
      expect(snapshot.workingFacts).toHaveLength(1);
      expect(snapshot.visitedUrls).toEqual(['https://example.com/welcome']);
      expect(snapshot.findings).toHaveLength(1);

      // Create new instance and restore snapshot
      const restoredManager = new MemoryManager();
      restoredManager.restoreFromSnapshot(snapshot);

      expect(restoredManager.getWorkingMemory().getFacts()).toContain('Page heading says Welcome');
      expect(restoredManager.getTaskMemory().getVisitedUrls()).toContain('https://example.com/welcome');
      expect(restoredManager.getTaskMemory().getUnresolvedQuestions()).toHaveLength(1);
      expect(restoredManager.getResearchMemory().getFindings()[0].claim).toBe(
        'Free shipping applies on orders over $50'
      );
    });

    it('should format memory facts into structured context lines for LLM prompt', () => {
      memoryManager.getTaskMemory().addVisitedUrl('https://example.com/step1');
      memoryManager.getTaskMemory().addQuestion('Is discount code available?');
      memoryManager.getWorkingMemory().addFact('Modal pop-up closed successfully');
      memoryManager.getResearchMemory().addFinding({
        claim: 'Discount code SAVE10 provides 10% off',
        sourceUrls: ['https://example.com/step1'],
      });

      const promptLines = memoryManager.formatMemoryForPrompt();
      expect(promptLines.some((l) => l.includes('[Visited Pages (1)]'))).toBe(true);
      expect(promptLines.some((l) => l.includes('[Open Questions]'))).toBe(true);
      expect(promptLines.some((l) => l.includes('[Working Fact]: Modal pop-up closed successfully'))).toBe(true);
      expect(promptLines.some((l) => l.includes('[Established Findings (1)]'))).toBe(true);
    });
  });
});
