import type { Page, Frame } from 'playwright-core';
import { ElementRegistry, type RegisteredElement } from './ElementRegistry.js';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';

export interface RawInteractiveElement {
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  testId?: string;
  id?: string;
  cssSelector?: string;
  text?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isInViewport?: boolean;
}

export class AccessibilityObserver {
  /**
   * Observes the active page, extracts visible interactive elements,
   * registers them into the ElementRegistry with resilient locator strategies,
   * and returns the registered elements.
   */
  public async observe(page: Page, registry: ElementRegistry): Promise<RegisteredElement[]> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot observe page: page is null');
    }

    try {
      const fnStr = this.extractRawElementsInPage.toString();
      const fnExpr = fnStr.startsWith('function') || fnStr.startsWith('async function')
        ? fnStr
        : `function ${fnStr}`;
      const evaluateScript = `(() => {
        if (typeof window.__name === 'undefined') {
          window.__name = function(t, v) { return t; };
        }
        return (${fnExpr})();
      })()`;
      const frames: Frame[] = typeof page.frames === 'function' ? page.frames() : [];
      const framesToInspect: Array<Page | Frame> = frames.length > 0 ? frames : [page];
      const registeredElements: RegisteredElement[] = [];

      for (let frameIdx = 0; frameIdx < framesToInspect.length; frameIdx++) {
        const frame = framesToInspect[frameIdx];
        const isMain = typeof page.mainFrame === 'function' ? frame === page.mainFrame() : frameIdx === 0;

        let rawElements: RawInteractiveElement[] = [];
        try {
          rawElements = await frame.evaluate<RawInteractiveElement[]>(evaluateScript);
        } catch (err) {
          if (isMain) {
            throw err;
          }
          // Subframe might be navigating, detached, or inaccessible: skip safely
          continue;
        }

        const elementsToProcess = Array.isArray(rawElements) ? rawElements : [];

        for (const item of elementsToProcess) {
          const locatorStrategy = this.buildLocatorStrategy(item);
          const frameUrl = !isMain && typeof frame.url === 'function' ? frame.url() : undefined;
          const frameName =
            !isMain && 'name' in frame && typeof (frame as Frame).name === 'function'
              ? (frame as Frame).name()
              : undefined;

          let frameLabel = '';
          if (!isMain) {
            if (frameName && frameName.trim()) {
              frameLabel = `[Frame: ${frameName}] `;
            } else if (frameUrl && frameUrl !== 'about:blank') {
              try {
                frameLabel = `[Frame: ${new URL(frameUrl).hostname}] `;
              } catch {
                frameLabel = `[Frame: ${frameIdx}] `;
              }
            } else {
              frameLabel = `[Frame: ${frameIdx}] `;
            }
          }

          const id = registry.register({
            role: item.role,
            name: `${frameLabel}${item.name}`.trim(),
            value: item.value,
            placeholder: item.placeholder,
            disabled: item.disabled,
            checked: item.checked,
            frameName: frameName || undefined,
            frameUrl: frameUrl || undefined,
            isIframe: !isMain,
            boundingBox: item.boundingBox,
            isInViewport: item.isInViewport,
            locatorStrategy,
          });

          const registered = registry.get(id);
          if (registered) {
            registeredElements.push(registered);
          }
        }
      }

      return registeredElements;
    } catch (err: unknown) {
      if (err instanceof BrowserError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(
        ErrorCodes.PAGE_TIMEOUT,
        `Failed to observe accessibility elements from page: ${message}`,
        { error: message }
      );
    }
  }

  /**
   * Determines the most resilient locator strategy for a detected element.
   */
  public buildLocatorStrategy(item: RawInteractiveElement): RegisteredElement['locatorStrategy'] {
    // 1. Prioritize data-testid / data-test attribute
    if (item.testId) {
      return {
        type: 'testid',
        selector: item.testId,
      };
    }

    // 2. Playwright accessible role + name (e.g. getByRole('button', { name: 'Sign In' }))
    const validAriaRoles = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
      'listbox', 'option', 'tab', 'menuitem', 'searchbox', 'switch',
      'slider', 'spinbutton'
    ]);

    if (validAriaRoles.has(item.role) && item.name.trim().length > 0) {
      return {
        type: 'role',
        selector: item.role,
        options: { name: item.name.trim(), exact: false },
      };
    }

    // 3. Exact text match for buttons or links if text is descriptive
    if ((item.role === 'button' || item.role === 'link') && item.text && item.text.trim().length > 0) {
      return {
        type: 'text',
        selector: item.text.trim(),
        options: { exact: true },
      };
    }

    // 4. Element ID selector
    if (item.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(item.id)) {
      return {
        type: 'css',
        selector: `#${item.id}`,
      };
    }

    // 5. CSS selector fallback
    return {
      type: 'css',
      selector: item.cssSelector || item.tag,
    };
  }

  /**
   * Browser-evaluated function to inspect visible interactive DOM nodes.
   */
  private extractRawElementsInPage(): RawInteractiveElement[] {
    const isVisible = (el: Element): boolean => {
      const htmlEl = el as HTMLElement;
      if (!htmlEl) return false;
      const style = window.getComputedStyle(htmlEl);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = htmlEl.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const getAccessibleName = (el: Element): string => {
      const htmlEl = el as HTMLElement;
      const ariaLabel = htmlEl.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

      const ariaLabelledBy = htmlEl.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl && labelEl.textContent) return labelEl.textContent.trim();
      }

      if (htmlEl.id) {
        const label = document.querySelector(`label[for="${CSS.escape(htmlEl.id)}"]`);
        if (label && label.textContent) return label.textContent.trim();
      }

      const parentLabel = htmlEl.closest('label');
      if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();

      const placeholder = htmlEl.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();

      const title = htmlEl.getAttribute('title');
      if (title && title.trim()) return title.trim();

      const alt = htmlEl.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();

      if (htmlEl.innerText && htmlEl.innerText.trim()) return htmlEl.innerText.trim();

      return '';
    };

    const query = [
      'button',
      'input',
      'select',
      'textarea',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="switch"]',
      '[role="searchbox"]',
      '[data-testid]',
      '[data-test]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const collectFromRoot = (root: Document | ShadowRoot): Element[] => {
      const results: Element[] = [];
      try {
        const queryFound = root.querySelectorAll(query);
        for (let i = 0; i < queryFound.length; i++) {
          results.push(queryFound[i]);
        }
        const allDescendants = root.querySelectorAll('*');
        for (let i = 0; i < allDescendants.length; i++) {
          const shadow = (allDescendants[i] as HTMLElement).shadowRoot;
          if (shadow) {
            results.push(...collectFromRoot(shadow));
          }
        }
      } catch {
        // Ignore cross-origin shadow access if any
      }
      return results;
    };

    const elements: RawInteractiveElement[] = [];
    const found = collectFromRoot(document);

    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      if (!isVisible(el)) continue;

      const htmlEl = el as HTMLElement;
      const inputEl = el as HTMLInputElement;
      const tag = htmlEl.tagName.toLowerCase();
      const type = (htmlEl.getAttribute('type') || '').toLowerCase();
      const testId = htmlEl.getAttribute('data-testid') || htmlEl.getAttribute('data-test') || undefined;
      const name = getAccessibleName(htmlEl);

      let role = htmlEl.getAttribute('role') || '';
      if (!role) {
        if (tag === 'button' || (tag === 'input' && (type === 'submit' || type === 'button' || type === 'reset'))) {
          role = 'button';
        } else if (tag === 'a') {
          role = 'link';
        } else if (tag === 'input' && type === 'checkbox') {
          role = 'checkbox';
        } else if (tag === 'input' && type === 'radio') {
          role = 'radio';
        } else if (tag === 'select') {
          role = 'combobox';
        } else if (tag === 'textarea' || (tag === 'input' && ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(type || 'text'))) {
          role = 'textbox';
        } else {
          role = tag;
        }
      }

      // Skip non-interactive container tags if role is not interactive
      if (['div', 'span', 'section', 'header', 'footer'].includes(tag) && !htmlEl.hasAttribute('role') && !testId && !htmlEl.hasAttribute('tabindex')) {
        continue;
      }

      const value = 'value' in htmlEl && typeof (htmlEl as { value: unknown }).value === 'string' ? (htmlEl as { value: string }).value : undefined;
      const placeholder = htmlEl.getAttribute('placeholder') || undefined;
      const disabled = ('disabled' in htmlEl && typeof (htmlEl as { disabled: unknown }).disabled === 'boolean' && (htmlEl as { disabled: boolean }).disabled)
        || htmlEl.getAttribute('aria-disabled') === 'true'
        || undefined;
      const checked = ('checked' in htmlEl && typeof (htmlEl as { checked: unknown }).checked === 'boolean' && (type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio'))
        ? (htmlEl as { checked: boolean }).checked
        : undefined;

      const text = htmlEl.innerText ? htmlEl.innerText.trim() : undefined;

      const rect = htmlEl.getBoundingClientRect();
      const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 1280);
      const vh = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 720);
      const isInViewport = (
        rect.top < vh &&
        rect.bottom > 0 &&
        rect.left < vw &&
        rect.right > 0
      );
      const boundingBox = {
        x: Math.round(rect.left + (window.scrollX || 0)),
        y: Math.round(rect.top + (window.scrollY || 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      elements.push({
        role,
        name,
        tag,
        type: type || undefined,
        value,
        placeholder,
        disabled,
        checked,
        testId,
        id: htmlEl.id || undefined,
        cssSelector: htmlEl.id ? `#${CSS.escape(htmlEl.id)}` : undefined,
        text,
        boundingBox,
        isInViewport,
      });
    }

    return elements;
  }
}
