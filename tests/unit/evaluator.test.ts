import { describe, it, expect } from 'vitest';
import { Evaluator } from '../../src/agent/Evaluator.js';
import type { PageSnapshot } from '../../src/observer/PageSnapshot.js';

describe('Evaluator Subsystem (Empirical Verification)', () => {
  const evaluator = new Evaluator();

  const baseSnapshot: PageSnapshot = {
    timestamp: '2026-09-06T00:00:00.000Z',
    url: 'https://store.example.com/login',
    title: 'Login Page',
    activeTabId: 'tab_001',
    interactiveElements: [
      { id: 'el_001', role: 'textbox', name: 'Email', value: '', locatorStrategy: { type: 'css', selector: '#email' } },
      { id: 'el_002', role: 'textbox', name: 'Password', value: '', locatorStrategy: { type: 'css', selector: '#pwd' } },
      { id: 'el_003', role: 'button', name: 'Sign In', locatorStrategy: { type: 'role', selector: 'button' } },
    ],
    pageSummary: {
      headings: ['Heading 1: "Login"'],
      forms: [{ formId: 'login-form', fields: ['Email', 'Password'] }],
      links: [],
    },
    compressedObservationText: '[Page: "Login Page"] [URL: https://store.example.com/login]\n- [el_001] textbox "Email"\n- [el_002] textbox "Password"\n- [el_003] button "Sign In"',
  };

  it('should evaluate success when URL navigates to expected dashboard', () => {
    const afterSnapshot: PageSnapshot = {
      ...baseSnapshot,
      url: 'https://store.example.com/dashboard',
      title: 'Customer Dashboard',
      pageSummary: {
        headings: ['Heading 1: "Welcome, Agent"'],
        forms: [],
        links: [],
      },
      compressedObservationText: '[Page: "Customer Dashboard"] [URL: https://store.example.com/dashboard]\n- Heading 1: "Welcome, Agent"',
    };

    const result = evaluator.evaluate(baseSnapshot, afterSnapshot, 'Redirect to dashboard page');

    expect(result.status).toBe('success');
    expect(result.observedChanges.some((c) => c.includes('URL navigated'))).toBe(true);
    expect(result.reason).toContain('dashboard');
  });

  it('should detect error banner and mark failure when unexpected error appears', () => {
    const errorSnapshot: PageSnapshot = {
      ...baseSnapshot,
      pageSummary: {
        ...baseSnapshot.pageSummary,
        notices: ['Invalid credentials provided. Please try again.'],
      },
      compressedObservationText: `${baseSnapshot.compressedObservationText}\n- Notice: "Invalid credentials provided. Please try again."`,
    };

    const result = evaluator.evaluate(baseSnapshot, errorSnapshot, 'Login succeeds and redirects');

    expect(result.status).toBe('failure');
    expect(result.reason).toContain('Error banner detected');
    expect(result.observedChanges.some((c) => c.includes('Notice appeared'))).toBe(true);
  });

  it('should evaluate success if expected outcome anticipated the error banner', () => {
    const errorSnapshot: PageSnapshot = {
      ...baseSnapshot,
      pageSummary: {
        ...baseSnapshot.pageSummary,
        notices: ['Invalid credentials provided. Please try again.'],
      },
      compressedObservationText: `${baseSnapshot.compressedObservationText}\n- Notice: "Invalid credentials provided. Please try again."`,
    };

    const result = evaluator.evaluate(baseSnapshot, errorSnapshot, 'An error message is displayed indicating invalid credentials');

    expect(result.status).toBe('success');
  });

  it('should evaluate failure when expected state change did not occur', () => {
    const identicalSnapshot: PageSnapshot = { ...baseSnapshot };

    const result = evaluator.evaluate(baseSnapshot, identicalSnapshot, 'Page redirects to settings');

    expect(result.status).toBe('failure');
    expect(result.observedChanges).toHaveLength(0);
    expect(result.reason).toContain('No state change observed on page');
  });

  it('should evaluate unknown when no changes occur and no expected outcome is provided', () => {
    const identicalSnapshot: PageSnapshot = { ...baseSnapshot };

    const result = evaluator.evaluate(baseSnapshot, identicalSnapshot);

    expect(result.status).toBe('unknown');
  });

  it('should detect input value modifications', () => {
    const filledSnapshot: PageSnapshot = {
      ...baseSnapshot,
      interactiveElements: [
        { ...baseSnapshot.interactiveElements[0], value: 'agent@example.com' },
        baseSnapshot.interactiveElements[1],
        baseSnapshot.interactiveElements[2],
      ],
    };

    const result = evaluator.evaluate(baseSnapshot, filledSnapshot, 'Email field filled with agent email');

    expect(result.status).toBe('success');
    expect(result.observedChanges.some((c) => c.includes('form input value(s) updated'))).toBe(true);
  });
});
