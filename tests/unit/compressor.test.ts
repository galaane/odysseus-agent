import { describe, it, expect } from 'vitest';
import { ObservationCompressor } from '../../src/observer/ObservationCompressor.js';
import type { RegisteredElement } from '../../src/observer/ElementRegistry.js';
import type { PageSummary } from '../../src/observer/PageSnapshot.js';

describe('ObservationCompressor', () => {
  const compressor = new ObservationCompressor();

  it('should format elements and summary according to project spec', () => {
    const elements: RegisteredElement[] = [
      {
        id: 'el_001',
        role: 'textbox',
        name: 'Email address',
        value: '',
        locatorStrategy: { type: 'role', selector: 'textbox' },
      },
      {
        id: 'el_002',
        role: 'textbox',
        name: 'Password',
        value: '',
        locatorStrategy: { type: 'role', selector: 'textbox' },
      },
      {
        id: 'el_003',
        role: 'checkbox',
        name: 'Remember me',
        checked: false,
        locatorStrategy: { type: 'role', selector: 'checkbox' },
      },
      {
        id: 'el_004',
        role: 'button',
        name: 'Sign In',
        locatorStrategy: { type: 'role', selector: 'button' },
      },
      {
        id: 'el_005',
        role: 'link',
        name: 'Forgot your password?',
        locatorStrategy: { type: 'role', selector: 'link' },
      },
    ];

    const summary: PageSummary = {
      headings: ['Heading 1: "Welcome Back"'],
      forms: [
        {
          formId: 'login-form',
          fields: ['Email address', 'Password', 'Remember me'],
        },
      ],
      links: [
        { id: 'el_005', text: 'Forgot your password?', href: '/forgot' },
      ],
      notices: ['Free shipping on orders over $50'],
    };

    const text = compressor.compress({
      title: 'Sign in - Example Store',
      url: 'https://store.example.com/login',
      elements,
      summary,
    });

    expect(text).toContain('[Page: "Sign in - Example Store"] [URL: https://store.example.com/login]');
    expect(text).toContain('Interactive Elements:');
    expect(text).toContain('- [el_001] textbox "Email address" (current: "")');
    expect(text).toContain('- [el_002] textbox "Password" (current: "")');
    expect(text).toContain('- [el_003] checkbox "Remember me" (unchecked)');
    expect(text).toContain('- [el_004] button "Sign In"');
    expect(text).toContain('- [el_005] link "Forgot your password?"');
    expect(text).toContain('Content Summary:');
    expect(text).toContain('- Heading 1: "Welcome Back"');
    expect(text).toContain('- Notice: "Free shipping on orders over $50"');
  });

  it('should strictly enforce token budget on massive pages', () => {
    // Generate 500 interactive elements
    const elements: RegisteredElement[] = [];
    for (let i = 1; i <= 500; i++) {
      elements.push({
        id: `el_${String(i).padStart(3, '0')}`,
        role: i % 2 === 0 ? 'button' : 'link',
        name: `Product item ${i} with very detailed description and long accessible title`,
        locatorStrategy: { type: 'css', selector: `#item-${i}` },
      });
    }

    const summary: PageSummary = {
      headings: Array.from({ length: 50 }, (_, i) => `Heading 2: "Section Header ${i + 1}"`),
      forms: [],
      links: [],
      notices: ['Global banner notice repeating across the entire catalog.'],
    };

    const maxTokens = 1500;
    const maxChars = Math.floor(maxTokens * 3.5);

    const compressed = compressor.compress({
      title: 'Huge E-commerce Catalog Page',
      url: 'https://catalog.example.com/products',
      elements,
      summary,
      maxTokens,
    });

    expect(compressed.length).toBeLessThanOrEqual(maxChars + 100);
    expect(compressed).toContain('... [Observation truncated to fit token budget of 1500 tokens]');
    const estimated = compressor.estimateTokens(compressed);
    expect(estimated).toBeLessThanOrEqual(maxTokens + 30);
  });

  it('should handle empty elements and summary gracefully', () => {
    const compressed = compressor.compress({
      title: 'Blank Page',
      url: 'about:blank',
      elements: [],
      summary: { headings: [], forms: [], links: [] },
    });

    expect(compressed).toContain('[Page: "Blank Page"] [URL: about:blank]');
    expect(compressed).toContain('- None detected');
    expect(compressed).not.toContain('Content Summary:');
  });
});
