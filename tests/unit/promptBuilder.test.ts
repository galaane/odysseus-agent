import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../src/llm/PromptBuilder.js';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  it('should build comprehensive system prompt matching Spec Section 43', () => {
    const systemPrompt = builder.buildSystemPrompt();

    // Verify persona & directives
    expect(systemPrompt).toContain('autonomous browser agent');
    expect(systemPrompt).toContain('Observe before acting');
    expect(systemPrompt).toContain('Strictly typed actions');
    expect(systemPrompt).toContain('Empirical verification');
    expect(systemPrompt).toContain('Never emit plaintext credentials');
    expect(systemPrompt).toContain('Transparent reasoning');

    // Verify 12 action types catalog
    expect(systemPrompt).toContain('navigate');
    expect(systemPrompt).toContain('click');
    expect(systemPrompt).toContain('fill');
    expect(systemPrompt).toContain('type');
    expect(systemPrompt).toContain('press');
    expect(systemPrompt).toContain('scroll');
    expect(systemPrompt).toContain('wait');
    expect(systemPrompt).toContain('screenshot');
    expect(systemPrompt).toContain('new_tab');
    expect(systemPrompt).toContain('switch_tab');
    expect(systemPrompt).toContain('close_tab');
    expect(systemPrompt).toContain('extract');

    // Verify JSON format requirement
    expect(systemPrompt).toContain('"status": "continue" | "complete" | "blocked"');
    expect(systemPrompt).toContain('"reasoning_summary"');
    expect(systemPrompt).toContain('"expectedOutcome"');
  });

  it('should build user prompt with complete working context and observation', () => {
    const userPrompt = builder.buildUserPrompt({
      goal: 'Find the registration form and create an account.',
      activeTabId: 'tab_001',
      activeUrl: 'https://example.com/signup',
      openTabs: [
        { tabId: 'tab_001', url: 'https://example.com/signup', title: 'Sign Up Page' },
        { tabId: 'tab_002', url: 'https://mail.example.com', title: 'Agent Mailbox' },
      ],
      recentActions: [
        { step: 1, actionType: 'navigate', targetId: undefined, outcome: 'Loaded signup page' },
      ],
      workingMemoryFacts: [
        'Agent email is agent@example.com',
      ],
      currentObservationText: `[Page: "Sign Up"] [URL: https://example.com/signup]
Interactive Elements:
- [el_001] textbox "Email" (current: "")
- [el_002] button "Continue"`,
    });

    expect(userPrompt).toContain('## Task Goal\nFind the registration form and create an account.');
    expect(userPrompt).toContain('- Active Tab: tab_001');
    expect(userPrompt).toContain('- Active URL: https://example.com/signup');
    expect(userPrompt).toContain('tab_001 (https://example.com/signup - "Sign Up Page")');
    expect(userPrompt).toContain('- Step 1: navigate -> Loaded signup page');
    expect(userPrompt).toContain('## Working Memory Facts\n- Agent email is agent@example.com');
    expect(userPrompt).toContain('## Current Browser Observation');
    expect(userPrompt).toContain('- [el_001] textbox "Email"');
  });

  it('should include custom instructions when provided', () => {
    const systemPrompt = builder.buildSystemPrompt({
      customInstructions: 'Prioritize checking the footer links first.',
    });

    expect(systemPrompt).toContain('Special Task Instructions:\nPrioritize checking the footer links first.');
  });

  it('should assemble system and user messages correctly with buildMessages', () => {
    const messages = builder.buildMessages({
      goal: 'Test goal',
      currentObservationText: 'Blank page',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('autonomous browser agent');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('## Task Goal\nTest goal');
  });
});
