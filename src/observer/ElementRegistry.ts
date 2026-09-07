import type { Page, Frame, Locator } from 'playwright-core';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';
import type { ElementResolver } from '../actions/ActionExecutionContext.js';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegisteredElement {
  id: string; // e.g. "el_001"
  role: string; // e.g. "button", "textbox", "link", "checkbox"
  name: string; // accessible name
  value?: string; // current input value
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  frameName?: string;
  frameUrl?: string;
  isIframe?: boolean;
  boundingBox?: BoundingBox;
  isInViewport?: boolean;
  locatorStrategy: {
    type: 'role' | 'text' | 'testid' | 'css';
    selector: string;
    options?: Record<string, unknown>;
  };
}

/**
 * Manages transient stable IDs (el_001, el_002) mapped to resilient Playwright locator strategies.
 * Reset on every page navigation / DOM snapshot update.
 */
export class ElementRegistry implements ElementResolver {
  private elements = new Map<string, RegisteredElement>();
  private page: Page | null = null;

  /**
   * Resets the registry and associates it with the active page.
   */
  public reset(page: Page): void {
    this.elements.clear();
    this.page = page;
  }

  /**
   * Registers a new interactive element and allocates a monotonic ID (el_001, el_002, ...).
   */
  public register(element: Omit<RegisteredElement, 'id'>): string {
    const id = `el_${String(this.elements.size + 1).padStart(3, '0')}`;
    const registered: RegisteredElement = { ...element, id };
    this.elements.set(id, registered);
    return id;
  }

  /**
   * Retrieves a registered element by its transient ID.
   */
  public get(id: string): RegisteredElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Resolves a Playwright Locator for a registered element ID.
   * Seamlessly resolves within nested iframes if element belongs to a subframe.
   * Throws BrowserError(ELEMENT_NOT_FOUND) if not found or page is missing.
   */
  public resolveLocator(id: string, pageOverride?: Page): Locator {
    const el = this.elements.get(id);
    const activePage = pageOverride || this.page;

    if (!el || !activePage) {
      throw new BrowserError(
        ErrorCodes.ELEMENT_NOT_FOUND,
        `Element ${id} not found in current snapshot registry`,
        { elementId: id }
      );
    }

    // Determine target context: main page or subframe
    let targetContext: Page | Frame = activePage;
    if (el.frameUrl || el.frameName) {
      const matched = activePage.frames().find(
        (f) =>
          (el.frameName && f.name() === el.frameName) ||
          (el.frameUrl && f.url() && (f.url() === el.frameUrl || f.url().includes(el.frameUrl)))
      );
      if (matched) {
        targetContext = matched;
      }
    }

    const { type, selector, options } = el.locatorStrategy;
    switch (type) {
      case 'role':
        return targetContext.getByRole(selector as Parameters<Page['getByRole']>[0], options);
      case 'text':
        return targetContext.getByText(selector, options);
      case 'testid':
        return targetContext.getByTestId(selector);
      case 'css':
      default:
        return targetContext.locator(selector);
    }
  }

  /**
   * Returns all registered elements in the current snapshot.
   */
  public getAll(): RegisteredElement[] {
    return Array.from(this.elements.values());
  }

  /**
   * Returns registered elements that are within the current viewport.
   * If isInViewport is undefined, elements default to in-viewport.
   */
  public getInViewport(): RegisteredElement[] {
    return Array.from(this.elements.values()).filter((el) => el.isInViewport !== false);
  }

  /**
   * Returns registered elements that are strictly outside the current viewport.
   */
  public getOutOfViewport(): RegisteredElement[] {
    return Array.from(this.elements.values()).filter((el) => el.isInViewport === false);
  }

  /**
   * Clears all registered elements and disassociates the page.
   */
  public clear(): void {
    this.elements.clear();
    this.page = null;
  }

  /**
   * Current number of registered elements.
   */
  public get size(): number {
    return this.elements.size;
  }
}
