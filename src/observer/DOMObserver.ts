import type { Page, Frame } from 'playwright-core';
import type { ElementRegistry } from './ElementRegistry.js';
import type { PageSummary } from './PageSnapshot.js';
import { BrowserError, ErrorCodes } from '../browser/BrowserError.js';

interface RawPageSummary {
  headings: string[];
  forms: Array<{ formId?: string; fields: string[] }>;
  links: Array<{ text: string; href?: string; testId?: string; id?: string }>;
  notices: string[];
  tables: Array<{ headers: string[]; rowCount: number }>;
}

export class DOMObserver {
  /**
   * Observes structural DOM content: headings, forms, links, notices, and tables.
   * Recursively traverses child frames and associates links with transient IDs from the ElementRegistry.
   */
  public async observe(page: Page, registry?: ElementRegistry): Promise<PageSummary> {
    if (!page) {
      throw new BrowserError(ErrorCodes.BROWSER_NOT_CONNECTED, 'Cannot observe DOM: page is null');
    }

    try {
      const fnStr = this.extractDOMStructureInPage.toString();
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

      const combinedHeadings: string[] = [];
      const combinedForms: Array<{ formId?: string; fields: string[] }> = [];
      const combinedNotices: string[] = [];
      const combinedTables: Array<{ headers: string[]; rowCount: number }> = [];
      const linksWithIds: Array<{ id: string; text: string; href?: string }> = [];

      for (let frameIdx = 0; frameIdx < framesToInspect.length; frameIdx++) {
        const frame = framesToInspect[frameIdx];
        const isMain = typeof page.mainFrame === 'function' ? frame === page.mainFrame() : frameIdx === 0;

        let raw: RawPageSummary | null = null;
        try {
          raw = await frame.evaluate<RawPageSummary>(evaluateScript);
        } catch (err) {
          if (isMain) {
            throw err;
          }
          // Subframe navigating, detached, or inaccessible: skip safely
          continue;
        }

        const safeRaw: RawPageSummary = {
          headings: raw?.headings || [],
          forms: raw?.forms || [],
          links: raw?.links || [],
          notices: raw?.notices || [],
          tables: raw?.tables || [],
        };

        const frameUrl = !isMain && typeof frame.url === 'function' ? frame.url() : undefined;
        const frameName =
          !isMain && 'name' in frame && typeof (frame as Frame).name === 'function'
            ? (frame as Frame).name()
            : undefined;

        let frameTag = '';
        if (!isMain) {
          if (frameName && frameName.trim()) {
            frameTag = frameName.trim();
          } else if (frameUrl && frameUrl !== 'about:blank') {
            try {
              frameTag = new URL(frameUrl).hostname;
            } catch {
              frameTag = `frame_${frameIdx}`;
            }
          } else {
            frameTag = `frame_${frameIdx}`;
          }
        }

        for (const h of safeRaw.headings) {
          combinedHeadings.push(frameTag ? `[Frame: ${frameTag}] ${h}` : h);
        }
        for (const n of safeRaw.notices) {
          combinedNotices.push(frameTag ? `[Frame: ${frameTag}] ${n}` : n);
        }
        for (const f of safeRaw.forms) {
          combinedForms.push({
            formId: frameTag ? `[Frame: ${frameTag}] ${f.formId || 'form'}` : f.formId,
            fields: f.fields,
          });
        }
        for (const t of safeRaw.tables) {
          combinedTables.push(t);
        }

        for (const link of safeRaw.links) {
          let elId = '';
          const linkText = frameTag ? `[Frame: ${frameTag}] ${link.text}` : link.text;

          if (registry) {
            const existing = registry.getAll().find(
              (el) => el.role === 'link' && (el.name === linkText || (link.id && el.id === link.id))
            );

            if (existing) {
              elId = existing.id;
            } else {
              elId = registry.register({
                role: 'link',
                name: linkText || link.href || 'Link',
                frameName,
                frameUrl,
                isIframe: !isMain,
                locatorStrategy: link.testId
                  ? { type: 'testid', selector: link.testId }
                  : link.text
                  ? { type: 'text', selector: link.text, options: { exact: true } }
                  : { type: 'css', selector: link.id ? `#${link.id}` : `a[href="${link.href}"]` },
              });
            }
          } else {
            elId = `link_${linksWithIds.length + 1}`;
          }

          linksWithIds.push({
            id: elId,
            text: linkText,
            href: link.href,
          });
        }
      }

      return {
        headings: combinedHeadings,
        forms: combinedForms,
        links: linksWithIds,
        notices: combinedNotices.length > 0 ? combinedNotices : undefined,
        tables: combinedTables.length > 0 ? combinedTables : undefined,
      };
    } catch (err: unknown) {
      if (err instanceof BrowserError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserError(
        ErrorCodes.PAGE_TIMEOUT,
        `Failed to observe DOM structure from page: ${message}`,
        { error: message }
      );
    }
  }

  /**
   * Evaluated inside browser to extract structural summary.
   */
  private extractDOMStructureInPage(): RawPageSummary {
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

    // 1. Headings
    const headingElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const headings: string[] = [];
    for (const h of headingElements) {
      if (!isVisible(h)) continue;
      const text = (h.textContent || '').trim();
      if (text) {
        const level = h.tagName.substring(1);
        headings.push(`Heading ${level}: "${text}"`);
      }
    }

    // 2. Forms
    const formElements = Array.from(document.querySelectorAll('form'));
    const forms: Array<{ formId?: string; fields: string[] }> = [];
    for (let i = 0; i < formElements.length; i++) {
      const form = formElements[i];
      if (!isVisible(form)) continue;
      const formId = form.id || form.getAttribute('name') || `form_${i + 1}`;
      const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
      const fields: string[] = [];

      for (const input of inputs) {
        if (!isVisible(input)) continue;
        const htmlInput = input as HTMLElement;
        const inputId = htmlInput.id;
        let fieldName = '';

        if (inputId) {
          const label = document.querySelector(`label[for="${CSS.escape(inputId)}"]`);
          if (label && label.textContent) fieldName = label.textContent.trim();
        }
        if (!fieldName) {
          const parentLabel = htmlInput.closest('label');
          if (parentLabel && parentLabel.textContent) fieldName = parentLabel.textContent.trim();
        }
        if (!fieldName) {
          fieldName = htmlInput.getAttribute('placeholder') || htmlInput.getAttribute('name') || htmlInput.getAttribute('aria-label') || '';
        }
        if (fieldName) {
          fields.push(fieldName);
        }
      }

      forms.push({ formId, fields });
    }

    // 3. Links
    const linkElements = Array.from(document.querySelectorAll('a[href]'));
    const links: Array<{ text: string; href?: string; testId?: string; id?: string }> = [];
    const seenLinks = new Set<string>();

    for (const a of linkElements) {
      if (!isVisible(a)) continue;
      const text = (a.textContent || '').trim();
      const href = a.getAttribute('href') || undefined;
      const key = `${text}|${href}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);

      links.push({
        text: text || 'Link',
        href,
        testId: a.getAttribute('data-testid') || undefined,
        id: a.id || undefined,
      });
    }

    // 4. Notices / Alerts
    const noticeElements = Array.from(
      document.querySelectorAll('[role="alert"], [role="status"], .notice, .alert, .banner, .notification')
    );
    const notices: string[] = [];
    for (const notice of noticeElements) {
      if (!isVisible(notice)) continue;
      const text = (notice.textContent || '').trim();
      if (text && !notices.includes(text)) {
        notices.push(text);
      }
    }

    // 5. Tables
    const tableElements = Array.from(document.querySelectorAll('table'));
    const tables: Array<{ headers: string[]; rowCount: number }> = [];
    for (const table of tableElements) {
      if (!isVisible(table)) continue;
      const ths = Array.from(table.querySelectorAll('th')).map((th) => (th.textContent || '').trim()).filter(Boolean);
      const rows = table.querySelectorAll('tr').length;
      tables.push({
        headers: ths,
        rowCount: Math.max(0, rows - 1),
      });
    }

    return {
      headings,
      forms,
      links,
      notices,
      tables,
    };
  }
}
