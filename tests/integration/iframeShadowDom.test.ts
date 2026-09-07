import { describe, it, expect, vi } from 'vitest';
import type { Page, Frame } from 'playwright-core';
import { ElementRegistry } from '../../src/observer/ElementRegistry.js';
import { AccessibilityObserver } from '../../src/observer/AccessibilityObserver.js';
import { DOMObserver } from '../../src/observer/DOMObserver.js';

describe('Phase 16: Deep Iframe & Shadow DOM Traversal Subsystem', () => {
  describe('ElementRegistry Frame-Aware Locator Resolution', () => {
    it('should resolve locator within matched subframe context when frameName is set', () => {
      const registry = new ElementRegistry();

      const mockMainFrameLocator = { click: vi.fn() };
      const mockSubframeLocator = { click: vi.fn() };

      const mockSubframe = {
        name: vi.fn().mockReturnValue('stripe-frame'),
        url: vi.fn().mockReturnValue('https://js.stripe.com/v3/elements-inner-card.html'),
        getByRole: vi.fn().mockReturnValue(mockSubframeLocator),
      } as unknown as Frame;

      const mockMainFrame = {
        name: vi.fn().mockReturnValue(''),
        url: vi.fn().mockReturnValue('https://shop.example.com/checkout'),
        getByRole: vi.fn().mockReturnValue(mockMainFrameLocator),
      } as unknown as Frame;

      const mockPage = {
        frames: vi.fn().mockReturnValue([mockMainFrame, mockSubframe]),
        mainFrame: vi.fn().mockReturnValue(mockMainFrame),
        getByRole: vi.fn().mockReturnValue(mockMainFrameLocator),
      } as unknown as Page;

      registry.reset(mockPage);

      const elId = registry.register({
        role: 'textbox',
        name: '[Frame: stripe-frame] Card Number',
        frameName: 'stripe-frame',
        isIframe: true,
        locatorStrategy: {
          type: 'role',
          selector: 'textbox',
          options: { name: 'Card Number' },
        },
      });

      const locator = registry.resolveLocator(elId);

      expect(mockSubframe.getByRole).toHaveBeenCalledWith('textbox', { name: 'Card Number' });
      expect(mockPage.getByRole).not.toHaveBeenCalled();
      expect(locator).toBe(mockSubframeLocator);
    });

    it('should resolve locator within matched subframe context when frameUrl is set', () => {
      const registry = new ElementRegistry();
      const mockSubframeLocator = { fill: vi.fn() };

      const mockSubframe = {
        name: vi.fn().mockReturnValue(''),
        url: vi.fn().mockReturnValue('https://auth.google.com/embedded-login'),
        locator: vi.fn().mockReturnValue(mockSubframeLocator),
      } as unknown as Frame;

      const mockMainFrame = {
        name: vi.fn().mockReturnValue(''),
        url: vi.fn().mockReturnValue('https://app.example.com'),
      } as unknown as Frame;

      const mockPage = {
        frames: vi.fn().mockReturnValue([mockMainFrame, mockSubframe]),
        mainFrame: vi.fn().mockReturnValue(mockMainFrame),
        locator: vi.fn(),
      } as unknown as Page;

      registry.reset(mockPage);

      const elId = registry.register({
        role: 'textbox',
        name: 'Email or phone',
        frameUrl: 'https://auth.google.com/embedded-login',
        isIframe: true,
        locatorStrategy: {
          type: 'css',
          selector: '#identifierId',
        },
      });

      const locator = registry.resolveLocator(elId);

      expect(mockSubframe.locator).toHaveBeenCalledWith('#identifierId');
      expect(locator).toBe(mockSubframeLocator);
    });
  });

  describe('AccessibilityObserver Multi-Frame Traversal', () => {
    it('should observe elements across main frame and child iframes', async () => {
      const observer = new AccessibilityObserver();
      const registry = new ElementRegistry();

      const mockMainFrame = {
        evaluate: vi.fn().mockResolvedValue([
          { role: 'button', name: 'Submit Order', tag: 'button' },
        ]),
        url: vi.fn().mockReturnValue('https://shop.example.com/checkout'),
      } as unknown as Frame;

      const mockChildFrame = {
        name: vi.fn().mockReturnValue('payment-widget'),
        url: vi.fn().mockReturnValue('https://pay.gateway.com/form'),
        evaluate: vi.fn().mockResolvedValue([
          { role: 'textbox', name: 'CVV', tag: 'input', type: 'password' },
        ]),
      } as unknown as Frame;

      const mockPage = {
        frames: vi.fn().mockReturnValue([mockMainFrame, mockChildFrame]),
        mainFrame: vi.fn().mockReturnValue(mockMainFrame),
      } as unknown as Page;

      registry.reset(mockPage);
      const elements = await observer.observe(mockPage, registry);

      expect(elements.length).toBe(2);

      // Main frame element
      expect(elements[0].name).toBe('Submit Order');
      expect(elements[0].isIframe).toBeFalsy();

      // Child frame element
      expect(elements[1].name).toBe('[Frame: payment-widget] CVV');
      expect(elements[1].isIframe).toBe(true);
      expect(elements[1].frameName).toBe('payment-widget');
    });
  });

  describe('DOMObserver Multi-Frame Traversal', () => {
    it('should combine headings and forms across all active frames', async () => {
      const observer = new DOMObserver();

      const mockMainFrame = {
        evaluate: vi.fn().mockResolvedValue({
          headings: ['Checkout'],
          forms: [{ formId: 'billing-form', fields: ['address', 'zip'] }],
          links: [{ text: 'Terms', href: '/terms' }],
          notices: [],
          tables: [],
        }),
        url: vi.fn().mockReturnValue('https://shop.example.com'),
      } as unknown as Frame;

      const mockChildFrame = {
        name: vi.fn().mockReturnValue('secure-auth'),
        url: vi.fn().mockReturnValue('https://auth.example.com'),
        evaluate: vi.fn().mockResolvedValue({
          headings: ['Verify Identity'],
          forms: [{ formId: 'auth-code-form', fields: ['code'] }],
          links: [],
          notices: ['SMS code sent'],
          tables: [],
        }),
      } as unknown as Frame;

      const mockPage = {
        frames: vi.fn().mockReturnValue([mockMainFrame, mockChildFrame]),
        mainFrame: vi.fn().mockReturnValue(mockMainFrame),
      } as unknown as Page;

      const summary = await observer.observe(mockPage);

      expect(summary.headings).toContain('Checkout');
      expect(summary.headings).toContain('[Frame: secure-auth] Verify Identity');

      expect(summary.forms).toHaveLength(2);
      expect(summary.forms[0].formId).toBe('billing-form');
      expect(summary.forms[1].formId).toBe('[Frame: secure-auth] auth-code-form');

      expect(summary.notices).toContain('[Frame: secure-auth] SMS code sent');
    });
  });
});
