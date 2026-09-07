import type { Page } from 'playwright-core';
import type { RegisteredElement } from './ElementRegistry.js';

export interface SetOfMarksItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SetOfMarksAnnotator {
  public static readonly OVERLAY_CONTAINER_ID = '__odysseus_som_root__';

  /**
   * Filters in-viewport elements that possess valid non-zero bounding box dimensions.
   */
  public filterAnnotatableElements(elements: RegisteredElement[]): SetOfMarksItem[] {
    const items: SetOfMarksItem[] = [];

    for (const el of elements) {
      if (el.isInViewport === false) continue;
      if (!el.boundingBox) continue;
      const { x, y, width, height } = el.boundingBox;
      if (width > 0 && height > 0) {
        items.push({
          id: el.id,
          x,
          y,
          width,
          height,
        });
      }
    }

    return items;
  }

  /**
   * Injects the Set-of-Marks visual overlay with colored bounding outlines and ID badges.
   */
  public async inject(page: Page, elements: RegisteredElement[]): Promise<number> {
    if (!page || typeof page.evaluate !== 'function') {
      return 0;
    }

    const items = this.filterAnnotatableElements(elements);
    if (items.length === 0) {
      return 0;
    }

    try {
      await page.evaluate(
        ({ containerId, items }) => {
          const existing = document.getElementById(containerId);
          if (existing) {
            existing.remove();
          }

          const container = document.createElement('div');
          container.id = containerId;
          container.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 2147483647;
            overflow: visible;
          `;

          const colors = [
            '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#6366f1'
          ];

          items.forEach((item, index) => {
            const color = colors[index % colors.length];

            const box = document.createElement('div');
            box.style.cssText = `
              position: absolute;
              left: ${item.x}px;
              top: ${item.y}px;
              width: ${item.width}px;
              height: ${item.height}px;
              border: 2px solid ${color};
              box-sizing: border-box;
              pointer-events: none;
              border-radius: 2px;
            `;

            const badge = document.createElement('div');
            badge.textContent = item.id;
            badge.style.cssText = `
              position: absolute;
              left: 0;
              top: -16px;
              background: ${color};
              color: #ffffff;
              font-size: 10px;
              font-weight: 700;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              padding: 1px 3px;
              border-radius: 2px;
              line-height: 12px;
              white-space: nowrap;
              box-shadow: 0 1px 2px rgba(0,0,0,0.3);
              pointer-events: none;
            `;

            if (item.y < 18) {
              badge.style.top = '0px';
            }

            box.appendChild(badge);
            container.appendChild(box);
          });

          document.body?.appendChild(container);
        },
        { containerId: SetOfMarksAnnotator.OVERLAY_CONTAINER_ID, items }
      );

      return items.length;
    } catch {
      return 0;
    }
  }

  /**
   * Removes the Set-of-Marks overlay from the active page DOM.
   */
  public async remove(page: Page): Promise<void> {
    if (!page || typeof page.evaluate !== 'function') {
      return;
    }

    try {
      await page.evaluate((containerId) => {
        const el = document.getElementById(containerId);
        if (el) {
          el.remove();
        }
      }, SetOfMarksAnnotator.OVERLAY_CONTAINER_ID);
    } catch {
      // Soft fail if page is navigating or closed
    }
  }

  /**
   * Injects the Set-of-Marks visual overlay, executes the capture callback,
   * and deterministically removes the overlay in a finally block.
   */
  public async annotateAndCapture<T>(
    page: Page,
    elements: RegisteredElement[],
    captureFn: () => Promise<T>
  ): Promise<T> {
    let annotated = false;
    try {
      const count = await this.inject(page, elements);
      annotated = count > 0;
      return await captureFn();
    } finally {
      if (annotated) {
        await this.remove(page);
      }
    }
  }
}
