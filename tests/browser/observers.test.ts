import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright-core';
import { ElementRegistry } from '../../src/observer/ElementRegistry.js';
import { AccessibilityObserver } from '../../src/observer/AccessibilityObserver.js';
import { DOMObserver } from '../../src/observer/DOMObserver.js';
import { PageObserver } from '../../src/observer/PageObserver.js';
import { ScreenshotObserver } from '../../src/observer/ScreenshotObserver.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';
import path from 'node:path';
import fs from 'node:fs';

describe('Observer Subsystem', () => {
  describe('AccessibilityObserver', () => {
    let observer: AccessibilityObserver;
    let registry: ElementRegistry;
    let mockPage: Page;

    beforeEach(() => {
      observer = new AccessibilityObserver();
      registry = new ElementRegistry();

      mockPage = {
        evaluate: vi.fn(),
      } as unknown as Page;

      registry.reset(mockPage);
    });

    it('should build locator strategy prioritising testid', () => {
      const strategy = observer.buildLocatorStrategy({
        role: 'button',
        name: 'Login',
        tag: 'button',
        testId: 'submit-btn',
      });
      expect(strategy).toEqual({ type: 'testid', selector: 'submit-btn' });
    });

    it('should build locator strategy using ARIA role and accessible name', () => {
      const strategy = observer.buildLocatorStrategy({
        role: 'button',
        name: 'Sign In',
        tag: 'button',
      });
      expect(strategy).toEqual({
        type: 'role',
        selector: 'button',
        options: { name: 'Sign In', exact: false },
      });
    });

    it('should build locator strategy using exact text for links without testid', () => {
      const strategy = observer.buildLocatorStrategy({
        role: 'link',
        name: 'Privacy Policy',
        tag: 'a',
        text: 'Privacy Policy',
      });
      expect(strategy).toEqual({
        type: 'role',
        selector: 'link',
        options: { name: 'Privacy Policy', exact: false },
      });
    });

    it('should build locator strategy using element ID when role lacks name', () => {
      const strategy = observer.buildLocatorStrategy({
        role: 'custom-widget',
        name: '',
        tag: 'div',
        id: 'widget-container',
      });
      expect(strategy).toEqual({
        type: 'css',
        selector: '#widget-container',
      });
    });

    it('should extract and register elements from page', async () => {
      const mockRaw = [
        {
          role: 'textbox',
          name: 'Email address',
          tag: 'input',
          type: 'email',
          value: 'test@example.com',
          placeholder: 'name@example.com',
          id: 'email-input',
        },
        {
          role: 'button',
          name: 'Sign In',
          tag: 'button',
          disabled: false,
        },
        {
          role: 'checkbox',
          name: 'Remember me',
          tag: 'input',
          type: 'checkbox',
          checked: true,
        },
      ];

      (mockPage.evaluate as any).mockResolvedValue(mockRaw);

      const elements = await observer.observe(mockPage, registry);
      expect(elements).toHaveLength(3);
      expect(elements[0].id).toBe('el_001');
      expect(elements[0].role).toBe('textbox');
      expect(elements[0].name).toBe('Email address');
      expect(elements[0].value).toBe('test@example.com');

      expect(elements[1].id).toBe('el_002');
      expect(elements[1].role).toBe('button');

      expect(elements[2].id).toBe('el_003');
      expect(elements[2].role).toBe('checkbox');
      expect(elements[2].checked).toBe(true);

      expect(registry.size).toBe(3);
    });

    it('should throw BrowserError when page evaluation fails', async () => {
      (mockPage.evaluate as any).mockRejectedValue(new Error('Navigation occurred'));

      await expect(observer.observe(mockPage, registry)).rejects.toThrowError(BrowserError);
    });
  });

  describe('DOMObserver', () => {
    let observer: DOMObserver;
    let registry: ElementRegistry;
    let mockPage: Page;

    beforeEach(() => {
      observer = new DOMObserver();
      registry = new ElementRegistry();

      mockPage = {
        evaluate: vi.fn(),
      } as unknown as Page;

      registry.reset(mockPage);
    });

    it('should extract headings, forms, links, notices and tables', async () => {
      const mockDOM = {
        headings: ['Heading 1: "Product Catalog"', 'Heading 2: "Featured Items"'],
        forms: [
          {
            formId: 'search-form',
            fields: ['Search query', 'Category filter'],
          },
        ],
        links: [
          { text: 'Documentation', href: '/docs', testId: 'docs-link' },
          { text: 'Support', href: '/support' },
        ],
        notices: ['Maintenance scheduled for tonight at 10 PM.'],
        tables: [{ headers: ['Item', 'Price', 'Stock'], rowCount: 5 }],
      };

      (mockPage.evaluate as any).mockResolvedValue(mockDOM);

      const summary = await observer.observe(mockPage, registry);

      expect(summary.headings).toEqual(mockDOM.headings);
      expect(summary.forms).toHaveLength(1);
      expect(summary.forms[0].formId).toBe('search-form');
      expect(summary.links).toHaveLength(2);
      expect(summary.links[0].id).toBe('el_001');
      expect(summary.links[0].text).toBe('Documentation');
      expect(summary.notices).toEqual(mockDOM.notices);
      expect(summary.tables).toHaveLength(1);
      expect(summary.tables?.[0].rowCount).toBe(5);
    });
  });

  describe('PageObserver Orchestrator', () => {
    it('should coordinate all observer components into PageSnapshot', async () => {
      const pageObserver = new PageObserver();
      const mockPage = {
        url: vi.fn(() => 'https://example.com/checkout'),
        title: vi.fn(async () => 'Checkout Page'),
        evaluate: vi.fn()
          .mockResolvedValueOnce([
            { role: 'button', name: 'Place Order', tag: 'button' },
          ])
          .mockResolvedValueOnce({
            headings: ['Heading 1: "Order Summary"'],
            forms: [],
            links: [],
            notices: [],
            tables: [],
          }),
      } as unknown as Page;

      const snapshot = await pageObserver.observePage(mockPage, 'tab_001');

      expect(snapshot.url).toBe('https://example.com/checkout');
      expect(snapshot.title).toBe('Checkout Page');
      expect(snapshot.activeTabId).toBe('tab_001');
      expect(snapshot.interactiveElements).toHaveLength(1);
      expect(snapshot.interactiveElements[0].name).toBe('Place Order');
      expect(snapshot.pageSummary.headings).toEqual(['Heading 1: "Order Summary"']);
      expect(snapshot.compressedObservationText).toContain('[Page: "Checkout Page"]');
      expect(snapshot.compressedObservationText).toContain('- [el_001] button "Place Order"');
    });
  });

  describe('ScreenshotObserver', () => {
    it('should capture screenshot with taskId and stepNumber', async () => {
      const tempDir = path.resolve(process.cwd(), 'data', 'test-screenshots');
      const screenshotObserver = new ScreenshotObserver(tempDir);

      const mockPage = {
        screenshot: vi.fn(async ({ path: savePath }: { path: string }) => {
          // write dummy file
          fs.mkdirSync(path.dirname(savePath), { recursive: true });
          fs.writeFileSync(savePath, 'dummy-png-data');
        }),
      } as unknown as Page;

      const savedPath = await screenshotObserver.capture(mockPage, {
        taskId: 'task_001',
        stepNumber: 3,
        fullPage: true,
      });

      expect(savedPath).toContain(path.join('task_001', 'step_003.png'));
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: savedPath,
        fullPage: true,
      });
      expect(fs.existsSync(savedPath)).toBe(true);

      // cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
